import type { Chain, Client, Transport } from 'viem'
import { estimateFeesPerGas, getFeeHistory } from 'viem/actions'

export const MIN_VAULT_PRIORITY_FEE_PER_GAS = 100_000_000n // 0.1 gwei
export const MAX_VAULT_PRIORITY_FEE_PER_GAS = 3_000_000_000n // 3 gwei
export const MAX_VAULT_TRANSACTION_GAS_COST = 15_000_000_000_000_000n // 0.015 ETH

const FEE_HISTORY_BLOCK_COUNT = 20
const FEE_HISTORY_REWARD_PERCENTILES = [90]
const BASE_FEE_BUFFER_NUMERATOR = 1_125n
const BASE_FEE_BUFFER_DENOMINATOR = 1_000n
const GAS_ESTIMATE_BUFFER_NUMERATOR = 3n
const GAS_ESTIMATE_BUFFER_DENOMINATOR = 2n

export type VaultTransactionFeeQuote = {
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
  minimumMaxFeePerGas: bigint
  source: 'fee_history' | 'viem_fallback'
}

export type VaultSignedTransactionFeeCaps = {
  gasLimit?: bigint | null
  maxFeePerGas: bigint | null
  maxPriorityFeePerGas: bigint | null
}

export type VaultSignedTransactionFeeValidationResult =
  | { valid: true }
  | {
      valid: false
      code:
        | 'MissingEip1559Fees'
        | 'InvalidFeeCaps'
        | 'PriorityFeeTooLow'
        | 'PriorityFeeTooHigh'
        | 'MaxFeeTooLow'
        | 'GasCostTooHigh'
      reason: string
    }

export class VaultTransactionFeeEstimationError extends Error {
  readonly feeHistoryError: unknown
  readonly fallbackError: unknown

  constructor({
    feeHistoryError,
    fallbackError,
  }: {
    feeHistoryError: unknown
    fallbackError: unknown
  }) {
    super('Unable to estimate EIP-1559 fees for vault transaction')
    this.name = 'VaultTransactionFeeEstimationError'
    this.feeHistoryError = feeHistoryError
    this.fallbackError = fallbackError
  }
}

export class VaultTransactionGasCostLimitError extends Error {
  readonly gasLimit: bigint
  readonly maximumAffordableFeePerGas: bigint
  readonly minimumRequiredFeePerGas: bigint

  constructor({
    gasLimit,
    maximumAffordableFeePerGas,
    minimumRequiredFeePerGas,
  }: {
    gasLimit: bigint
    maximumAffordableFeePerGas: bigint
    minimumRequiredFeePerGas: bigint
  }) {
    super(
      `Vault transaction cannot fit the ${MAX_VAULT_TRANSACTION_GAS_COST.toString()} wei gas-cost limit: ` +
        `gasLimit=${gasLimit.toString()}, maximumAffordableFeePerGas=${maximumAffordableFeePerGas.toString()}, ` +
        `minimumRequiredFeePerGas=${minimumRequiredFeePerGas.toString()}`,
    )
    this.name = 'VaultTransactionGasCostLimitError'
    this.gasLimit = gasLimit
    this.maximumAffordableFeePerGas = maximumAffordableFeePerGas
    this.minimumRequiredFeePerGas = minimumRequiredFeePerGas
  }
}

type FeeHistorySnapshot = {
  baseFeePerGas: readonly bigint[]
  reward?: readonly (readonly bigint[])[] | undefined
}

type FallbackFeeEstimate = {
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
}

function ceilMultiplyFraction(value: bigint, numerator: bigint, denominator: bigint): bigint {
  return (value * numerator + denominator - 1n) / denominator
}

function medianBigInt(values: readonly bigint[]): bigint | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
  const upperMiddleIndex = Math.floor(sorted.length / 2)
  const upperMiddle = sorted[upperMiddleIndex]
  if (upperMiddle === undefined) return undefined
  if (sorted.length % 2 === 1) return upperMiddle
  const lowerMiddle = sorted[upperMiddleIndex - 1]
  return lowerMiddle === undefined ? undefined : (lowerMiddle + upperMiddle) / 2n
}

function clampPriorityFee(priorityFee: bigint): bigint {
  if (priorityFee < MIN_VAULT_PRIORITY_FEE_PER_GAS) return MIN_VAULT_PRIORITY_FEE_PER_GAS
  if (priorityFee > MAX_VAULT_PRIORITY_FEE_PER_GAS) return MAX_VAULT_PRIORITY_FEE_PER_GAS
  return priorityFee
}

function resolveFeeHistoryQuote({
  baseFeePerGas,
  reward,
}: {
  baseFeePerGas: readonly bigint[]
  reward?: readonly (readonly bigint[])[] | undefined
}): VaultTransactionFeeQuote | null {
  // feeHistory includes one additional base fee for the next block. The
  // second-to-last entry is therefore the latest mined block's base fee.
  const latestBaseFeeIndex = baseFeePerGas.length - 2
  if (latestBaseFeeIndex < 0 || reward === undefined || reward.length === 0) return null

  const p90Rewards = reward.flatMap((blockRewards) => {
    const p90 = blockRewards[0]
    return p90 === undefined ? [] : [p90]
  })
  const sampledPriorityFee = medianBigInt(p90Rewards)
  if (sampledPriorityFee === undefined) return null

  const maxPriorityFeePerGas = clampPriorityFee(sampledPriorityFee)
  const bufferedBaseFee = ceilMultiplyFraction(
    baseFeePerGas[latestBaseFeeIndex],
    BASE_FEE_BUFFER_NUMERATOR,
    BASE_FEE_BUFFER_DENOMINATOR,
  )

  return {
    maxFeePerGas: bufferedBaseFee + maxPriorityFeePerGas,
    maxPriorityFeePerGas,
    minimumMaxFeePerGas: bufferedBaseFee + MIN_VAULT_PRIORITY_FEE_PER_GAS,
    source: 'fee_history',
  }
}

function resolveFallbackQuote({
  maxFeePerGas: estimatedMaxFeePerGas,
  maxPriorityFeePerGas: estimatedPriorityFeePerGas,
}: {
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
}): VaultTransactionFeeQuote {
  const maxPriorityFeePerGas = clampPriorityFee(estimatedPriorityFeePerGas)
  const estimatedBaseFeeAllowance =
    estimatedMaxFeePerGas > estimatedPriorityFeePerGas
      ? estimatedMaxFeePerGas - estimatedPriorityFeePerGas
      : 0n

  return {
    maxFeePerGas: estimatedBaseFeeAllowance + maxPriorityFeePerGas,
    maxPriorityFeePerGas,
    minimumMaxFeePerGas: estimatedBaseFeeAllowance + MIN_VAULT_PRIORITY_FEE_PER_GAS,
    source: 'viem_fallback',
  }
}

export function applyVaultTransactionGasCostLimit(
  quote: VaultTransactionFeeQuote,
  gasLimit: bigint,
): VaultTransactionFeeQuote {
  if (gasLimit <= 0n) {
    throw new Error(`Vault transaction gas limit must be positive, received ${gasLimit.toString()}`)
  }

  const maximumAffordableFeePerGas = MAX_VAULT_TRANSACTION_GAS_COST / gasLimit
  if (maximumAffordableFeePerGas < quote.minimumMaxFeePerGas) {
    throw new VaultTransactionGasCostLimitError({
      gasLimit,
      maximumAffordableFeePerGas,
      minimumRequiredFeePerGas: quote.minimumMaxFeePerGas,
    })
  }

  if (quote.maxFeePerGas <= maximumAffordableFeePerGas) return quote

  const bufferedBaseFee = quote.minimumMaxFeePerGas - MIN_VAULT_PRIORITY_FEE_PER_GAS
  const affordablePriorityFee = maximumAffordableFeePerGas - bufferedBaseFee
  return {
    ...quote,
    maxFeePerGas: maximumAffordableFeePerGas,
    maxPriorityFeePerGas:
      quote.maxPriorityFeePerGas < affordablePriorityFee
        ? quote.maxPriorityFeePerGas
        : affordablePriorityFee,
  }
}

export function bufferVaultTransactionGasEstimate(gasEstimate: bigint): bigint {
  if (gasEstimate <= 0n) {
    throw new Error(
      `Vault transaction gas estimate must be positive, received ${gasEstimate.toString()}`,
    )
  }
  return ceilMultiplyFraction(
    gasEstimate,
    GAS_ESTIMATE_BUFFER_NUMERATOR,
    GAS_ESTIMATE_BUFFER_DENOMINATOR,
  )
}

export function validateVaultSignedTransactionFeeCaps(
  feeCaps: VaultSignedTransactionFeeCaps,
  quote?: VaultTransactionFeeQuote,
): VaultSignedTransactionFeeValidationResult {
  const { gasLimit, maxFeePerGas, maxPriorityFeePerGas } = feeCaps
  if (maxFeePerGas === null || maxPriorityFeePerGas === null) {
    return {
      valid: false,
      code: 'MissingEip1559Fees',
      reason: 'Signed transaction must include EIP-1559 max fee and priority fee caps.',
    }
  }
  if (maxPriorityFeePerGas > maxFeePerGas) {
    return {
      valid: false,
      code: 'InvalidFeeCaps',
      reason:
        `Signed transaction maxPriorityFeePerGas (${maxPriorityFeePerGas.toString()} wei) ` +
        `cannot exceed maxFeePerGas (${maxFeePerGas.toString()} wei).`,
    }
  }
  if (maxPriorityFeePerGas < MIN_VAULT_PRIORITY_FEE_PER_GAS) {
    return {
      valid: false,
      code: 'PriorityFeeTooLow',
      reason:
        `Signed transaction maxPriorityFeePerGas (${maxPriorityFeePerGas.toString()} wei) ` +
        `must be at least ${MIN_VAULT_PRIORITY_FEE_PER_GAS.toString()} wei (0.1 gwei).`,
    }
  }
  if (maxPriorityFeePerGas > MAX_VAULT_PRIORITY_FEE_PER_GAS) {
    return {
      valid: false,
      code: 'PriorityFeeTooHigh',
      reason:
        `Signed transaction maxPriorityFeePerGas (${maxPriorityFeePerGas.toString()} wei) ` +
        `must not exceed ${MAX_VAULT_PRIORITY_FEE_PER_GAS.toString()} wei (3 gwei).`,
    }
  }
  if (
    gasLimit !== undefined &&
    gasLimit !== null &&
    gasLimit * maxFeePerGas > MAX_VAULT_TRANSACTION_GAS_COST
  ) {
    return {
      valid: false,
      code: 'GasCostTooHigh',
      reason:
        `Signed transaction maximum gas cost (${(gasLimit * maxFeePerGas).toString()} wei) ` +
        `must not exceed ${MAX_VAULT_TRANSACTION_GAS_COST.toString()} wei (0.015 ETH).`,
    }
  }
  if (quote !== undefined && maxFeePerGas < quote.minimumMaxFeePerGas) {
    return {
      valid: false,
      code: 'MaxFeeTooLow',
      reason:
        `Signed transaction maxFeePerGas (${maxFeePerGas.toString()} wei) must be at least ` +
        `${quote.minimumMaxFeePerGas.toString()} wei for the buffered next-block base fee ` +
        'and 0.1 gwei minimum priority fee.',
    }
  }
  return { valid: true }
}

async function resolveVaultTransactionFeeQuote({
  readFeeHistory,
  readFallbackEstimate,
}: {
  readFeeHistory: () => Promise<FeeHistorySnapshot>
  readFallbackEstimate: () => Promise<FallbackFeeEstimate>
}): Promise<VaultTransactionFeeQuote> {
  let feeHistoryError: unknown
  try {
    const quote = resolveFeeHistoryQuote(await readFeeHistory())
    if (quote !== null) return quote
    feeHistoryError = new Error('eth_feeHistory returned incomplete base fee or reward data')
  } catch (error) {
    feeHistoryError = error
  }

  try {
    return resolveFallbackQuote(await readFallbackEstimate())
  } catch (fallbackError) {
    throw new VaultTransactionFeeEstimationError({ feeHistoryError, fallbackError })
  }
}

/**
 * Resolve explicit EIP-1559 fees for operator-controlled vault transactions.
 *
 * The normal path follows the median p90 priority fee from the last 20 blocks,
 * with a 0.1 gwei floor and 3 gwei ceiling. If fee history is unavailable,
 * Viem's estimate is used while preserving those bounds and its original
 * base-fee allowance.
 */
export async function getVaultTransactionFeeQuote<chain extends Chain | undefined>(
  client: Client<Transport, chain>,
): Promise<VaultTransactionFeeQuote> {
  return resolveVaultTransactionFeeQuote({
    readFeeHistory: () =>
      getFeeHistory(client, {
        blockCount: FEE_HISTORY_BLOCK_COUNT,
        blockTag: 'latest',
        rewardPercentiles: FEE_HISTORY_REWARD_PERCENTILES,
      }),
    readFallbackEstimate: () => estimateFeesPerGas(client),
  })
}

export const __transactionFeeTestUtils = {
  resolveFallbackQuote,
  resolveFeeHistoryQuote,
  resolveVaultTransactionFeeQuote,
}
