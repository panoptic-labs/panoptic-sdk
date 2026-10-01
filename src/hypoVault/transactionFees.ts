import type { Chain, Client, Transport } from 'viem'
import { hexToBigInt } from 'viem'
import { estimateFeesPerGas, getBlock, getFeeHistory } from 'viem/actions'

import { ROBINHOOD_CHAIN_ID } from './chainDeployments'

export const MIN_VAULT_PRIORITY_FEE_PER_GAS = 100_000_000n // 0.1 gwei
export const MAX_VAULT_PRIORITY_FEE_PER_GAS = 3_000_000_000n // 3 gwei
export const MAX_STALE_DELTA_HEDGE_PRIORITY_FEE_PER_GAS = 8_000_000_000n // 8 gwei
export const MAX_VAULT_TRANSACTION_GAS_COST = 15_000_000_000_000_000n // 0.015 ETH

const FEE_HISTORY_BLOCK_COUNT = 20
const FEE_HISTORY_REWARD_PERCENTILES = [90]
const DELTA_HEDGE_FEE_HISTORY_REWARD_PERCENTILES = [25]
const BASE_FEE_BUFFER_NUMERATOR = 1_125n
const BASE_FEE_BUFFER_DENOMINATOR = 1_000n
const REPLACEMENT_FEE_BUMP_NUMERATOR = 1_125n
const REPLACEMENT_FEE_BUMP_DENOMINATOR = 1_000n
const DELTA_HEDGE_PRIORITY_FEE_BUMP_NUMERATOR = 1_300n
const DELTA_HEDGE_PRIORITY_FEE_BUMP_DENOMINATOR = 1_000n
// Leave the mandatory 12.5% replacement headroom for a final 3 gwei replacement.
const MAX_DELTA_HEDGE_PRIORITY_FEE_PER_GAS =
  (MAX_VAULT_PRIORITY_FEE_PER_GAS * REPLACEMENT_FEE_BUMP_DENOMINATOR) /
  REPLACEMENT_FEE_BUMP_NUMERATOR
const GAS_ESTIMATE_BUFFER_NUMERATOR = 3n
const GAS_ESTIMATE_BUFFER_DENOMINATOR = 2n

export type VaultTransactionFeeQuote = {
  currentBaseFeePerGas?: bigint
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
  minimumMaxFeePerGas: bigint
  minimumPriorityFeePerGas?: bigint
  source: 'fee_history' | 'viem_fallback' | 'rpc_priority_fee' | 'fee_history_p25'
}

export type VaultDeltaHedgeFeeQuote = VaultTransactionFeeQuote & {
  rawPriorityFeePerGas: bigint
}

export type VaultSignedTransactionFeeCaps = {
  chainId?: number
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

export class VaultTransactionReplacementLimitError extends Error {
  readonly code: 'GasCostCapExceeded' | 'PriorityFeeCapExceeded'
  readonly requiredMaxFeePerGas: bigint
  readonly requiredMaxPriorityFeePerGas: bigint
  readonly maximumAffordableFeePerGas: bigint

  constructor({
    code,
    gasLimit,
    requiredMaxFeePerGas,
    requiredMaxPriorityFeePerGas,
    maximumAffordableFeePerGas,
  }: {
    code: 'GasCostCapExceeded' | 'PriorityFeeCapExceeded'
    gasLimit: bigint
    requiredMaxFeePerGas: bigint
    requiredMaxPriorityFeePerGas: bigint
    maximumAffordableFeePerGas: bigint
  }) {
    super(
      `Vault transaction replacement blocked by ${code}: gasLimit=${gasLimit.toString()}, ` +
        `requiredMaxFeePerGas=${requiredMaxFeePerGas.toString()}, ` +
        `requiredMaxPriorityFeePerGas=${requiredMaxPriorityFeePerGas.toString()}, ` +
        `maximumAffordableFeePerGas=${maximumAffordableFeePerGas.toString()}`,
    )
    this.name = 'VaultTransactionReplacementLimitError'
    this.code = code
    this.requiredMaxFeePerGas = requiredMaxFeePerGas
    this.requiredMaxPriorityFeePerGas = requiredMaxPriorityFeePerGas
    this.maximumAffordableFeePerGas = maximumAffordableFeePerGas
  }
}

type FeeHistorySnapshot = {
  baseFeePerGas: readonly bigint[]
  reward?: readonly (readonly bigint[])[] | undefined
  minimumPriorityFeePerGas?: bigint
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

function getChainPriorityFeeFloor(chainId: number | undefined): bigint | undefined {
  return chainId === ROBINHOOD_CHAIN_ID ? 0n : undefined
}

function clampPriorityFee(
  priorityFee: bigint,
  minimumPriorityFeePerGas = MIN_VAULT_PRIORITY_FEE_PER_GAS,
): bigint {
  if (priorityFee < minimumPriorityFeePerGas) return minimumPriorityFeePerGas
  if (priorityFee > MAX_VAULT_PRIORITY_FEE_PER_GAS) return MAX_VAULT_PRIORITY_FEE_PER_GAS
  return priorityFee
}

function resolveFeeHistoryQuote({
  baseFeePerGas,
  reward,
  minimumPriorityFeePerGas,
}: {
  baseFeePerGas: readonly bigint[]
  reward?: readonly (readonly bigint[])[] | undefined
  minimumPriorityFeePerGas?: bigint
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

  const effectivePriorityFeeFloor = minimumPriorityFeePerGas ?? MIN_VAULT_PRIORITY_FEE_PER_GAS
  const maxPriorityFeePerGas = clampPriorityFee(sampledPriorityFee, effectivePriorityFeeFloor)
  const bufferedBaseFee = ceilMultiplyFraction(
    baseFeePerGas[latestBaseFeeIndex],
    BASE_FEE_BUFFER_NUMERATOR,
    BASE_FEE_BUFFER_DENOMINATOR,
  )

  return {
    currentBaseFeePerGas: baseFeePerGas[latestBaseFeeIndex],
    maxFeePerGas: bufferedBaseFee + maxPriorityFeePerGas,
    maxPriorityFeePerGas,
    minimumMaxFeePerGas: bufferedBaseFee + effectivePriorityFeeFloor,
    ...(minimumPriorityFeePerGas === undefined ? {} : { minimumPriorityFeePerGas }),
    source: 'fee_history',
  }
}

function resolveDeltaHedgeFeeHistoryQuote({
  baseFeePerGas,
  reward,
  minimumPriorityFeePerGas,
}: FeeHistorySnapshot): VaultDeltaHedgeFeeQuote | null {
  const latestBaseFeeIndex = baseFeePerGas.length - 2
  if (latestBaseFeeIndex < 0 || reward === undefined || reward.length === 0) return null

  const p25Rewards = reward.flatMap((blockRewards) => {
    const p25 = blockRewards[0]
    return p25 === undefined ? [] : [p25]
  })
  const rawPriorityFeePerGas = medianBigInt(p25Rewards)
  if (rawPriorityFeePerGas === undefined) return null

  const effectivePriorityFeeFloor = minimumPriorityFeePerGas ?? MIN_VAULT_PRIORITY_FEE_PER_GAS
  const maxPriorityFeePerGas = clampPriorityFee(rawPriorityFeePerGas, effectivePriorityFeeFloor)
  const bufferedBaseFee = ceilMultiplyFraction(
    baseFeePerGas[latestBaseFeeIndex],
    BASE_FEE_BUFFER_NUMERATOR,
    BASE_FEE_BUFFER_DENOMINATOR,
  )
  return {
    maxFeePerGas: bufferedBaseFee + maxPriorityFeePerGas,
    maxPriorityFeePerGas,
    minimumMaxFeePerGas: bufferedBaseFee + effectivePriorityFeeFloor,
    ...(minimumPriorityFeePerGas === undefined ? {} : { minimumPriorityFeePerGas }),
    rawPriorityFeePerGas,
    source: 'fee_history_p25',
  }
}

function resolveRpcPriorityFeeQuote({
  baseFeePerGas,
  rawPriorityFeePerGas,
  minimumPriorityFeePerGas,
}: {
  baseFeePerGas: bigint
  rawPriorityFeePerGas: bigint
  minimumPriorityFeePerGas?: bigint
}): VaultDeltaHedgeFeeQuote {
  const bufferedBaseFee = ceilMultiplyFraction(
    baseFeePerGas,
    BASE_FEE_BUFFER_NUMERATOR,
    BASE_FEE_BUFFER_DENOMINATOR,
  )
  return {
    maxFeePerGas: bufferedBaseFee + rawPriorityFeePerGas,
    maxPriorityFeePerGas: rawPriorityFeePerGas,
    minimumMaxFeePerGas: bufferedBaseFee + (minimumPriorityFeePerGas ?? rawPriorityFeePerGas),
    ...(minimumPriorityFeePerGas === undefined ? {} : { minimumPriorityFeePerGas }),
    rawPriorityFeePerGas,
    source: 'rpc_priority_fee',
  }
}

export function getVaultTransactionReplacementFeeQuote({
  originalQuote,
  historicalQuote,
  gasLimit,
  finalReplacement = false,
  staleBoundsReplacement = false,
}: {
  originalQuote: Pick<VaultTransactionFeeQuote, 'maxFeePerGas' | 'maxPriorityFeePerGas'>
  historicalQuote: VaultDeltaHedgeFeeQuote
  gasLimit: bigint
  finalReplacement?: boolean
  staleBoundsReplacement?: boolean
}): VaultDeltaHedgeFeeQuote {
  if (gasLimit <= 0n) {
    throw new Error(`Vault transaction gas limit must be positive, received ${gasLimit.toString()}`)
  }

  const bumpedPriorityFee = staleBoundsReplacement
    ? ceilMultiplyFraction(
        originalQuote.maxPriorityFeePerGas,
        REPLACEMENT_FEE_BUMP_NUMERATOR,
        REPLACEMENT_FEE_BUMP_DENOMINATOR,
      )
    : ceilMultiplyFraction(
        originalQuote.maxPriorityFeePerGas,
        DELTA_HEDGE_PRIORITY_FEE_BUMP_NUMERATOR,
        DELTA_HEDGE_PRIORITY_FEE_BUMP_DENOMINATOR,
      )
  const bumpedMaxFee = ceilMultiplyFraction(
    originalQuote.maxFeePerGas,
    REPLACEMENT_FEE_BUMP_NUMERATOR,
    REPLACEMENT_FEE_BUMP_DENOMINATOR,
  )
  const escalatingPriorityFee =
    historicalQuote.maxPriorityFeePerGas > bumpedPriorityFee
      ? historicalQuote.maxPriorityFeePerGas
      : bumpedPriorityFee
  const priorityFeeLimit = staleBoundsReplacement
    ? MAX_STALE_DELTA_HEDGE_PRIORITY_FEE_PER_GAS
    : finalReplacement
      ? MAX_VAULT_PRIORITY_FEE_PER_GAS
      : MAX_DELTA_HEDGE_PRIORITY_FEE_PER_GAS
  const desiredMaxPriorityFeePerGas = finalReplacement
    ? MAX_VAULT_PRIORITY_FEE_PER_GAS
    : staleBoundsReplacement
      ? bumpedPriorityFee
      : escalatingPriorityFee
  const requiredReplacementPriorityFee = ceilMultiplyFraction(
    originalQuote.maxPriorityFeePerGas,
    REPLACEMENT_FEE_BUMP_NUMERATOR,
    REPLACEMENT_FEE_BUMP_DENOMINATOR,
  )
  const requiredMaxPriorityFeePerGas =
    desiredMaxPriorityFeePerGas < priorityFeeLimit ? desiredMaxPriorityFeePerGas : priorityFeeLimit
  if (requiredMaxPriorityFeePerGas < requiredReplacementPriorityFee) {
    throw new VaultTransactionReplacementLimitError({
      code: 'PriorityFeeCapExceeded',
      gasLimit,
      requiredMaxFeePerGas: originalQuote.maxFeePerGas,
      requiredMaxPriorityFeePerGas: requiredReplacementPriorityFee,
      maximumAffordableFeePerGas: MAX_VAULT_TRANSACTION_GAS_COST / gasLimit,
    })
  }
  const bufferedBaseFee =
    historicalQuote.minimumMaxFeePerGas -
    (historicalQuote.minimumPriorityFeePerGas ?? MIN_VAULT_PRIORITY_FEE_PER_GAS)
  const currentMarketMaxFee = bufferedBaseFee + requiredMaxPriorityFeePerGas
  const desiredMaxFeePerGas =
    currentMarketMaxFee > bumpedMaxFee ? currentMarketMaxFee : bumpedMaxFee
  const maximumAffordableFeePerGas = MAX_VAULT_TRANSACTION_GAS_COST / gasLimit

  if (
    bumpedMaxFee > maximumAffordableFeePerGas ||
    requiredMaxPriorityFeePerGas > maximumAffordableFeePerGas
  ) {
    throw new VaultTransactionReplacementLimitError({
      code: 'GasCostCapExceeded',
      gasLimit,
      requiredMaxFeePerGas: bumpedMaxFee,
      requiredMaxPriorityFeePerGas,
      maximumAffordableFeePerGas,
    })
  }
  const maxFeePerGas =
    desiredMaxFeePerGas < maximumAffordableFeePerGas
      ? desiredMaxFeePerGas
      : maximumAffordableFeePerGas

  return {
    ...historicalQuote,
    maxFeePerGas,
    maxPriorityFeePerGas: requiredMaxPriorityFeePerGas,
  }
}

function resolveFallbackQuote({
  maxFeePerGas: estimatedMaxFeePerGas,
  maxPriorityFeePerGas: estimatedPriorityFeePerGas,
  minimumPriorityFeePerGas,
}: {
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
  minimumPriorityFeePerGas?: bigint
}): VaultTransactionFeeQuote {
  const effectivePriorityFeeFloor = minimumPriorityFeePerGas ?? MIN_VAULT_PRIORITY_FEE_PER_GAS
  const maxPriorityFeePerGas = clampPriorityFee(
    estimatedPriorityFeePerGas,
    effectivePriorityFeeFloor,
  )
  const estimatedBaseFeeAllowance =
    estimatedMaxFeePerGas > estimatedPriorityFeePerGas
      ? estimatedMaxFeePerGas - estimatedPriorityFeePerGas
      : 0n

  return {
    maxFeePerGas: estimatedBaseFeeAllowance + maxPriorityFeePerGas,
    maxPriorityFeePerGas,
    minimumMaxFeePerGas: estimatedBaseFeeAllowance + effectivePriorityFeeFloor,
    ...(minimumPriorityFeePerGas === undefined ? {} : { minimumPriorityFeePerGas }),
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

  const bufferedBaseFee =
    quote.minimumMaxFeePerGas - (quote.minimumPriorityFeePerGas ?? MIN_VAULT_PRIORITY_FEE_PER_GAS)
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
  const { chainId, gasLimit, maxFeePerGas, maxPriorityFeePerGas } = feeCaps
  const minimumPriorityFeePerGas =
    quote?.minimumPriorityFeePerGas ??
    getChainPriorityFeeFloor(chainId) ??
    MIN_VAULT_PRIORITY_FEE_PER_GAS
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
  if (maxPriorityFeePerGas < minimumPriorityFeePerGas) {
    return {
      valid: false,
      code: 'PriorityFeeTooLow',
      reason:
        `Signed transaction maxPriorityFeePerGas (${maxPriorityFeePerGas.toString()} wei) ` +
        `must be at least ${minimumPriorityFeePerGas.toString()} wei.`,
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
  if (quote !== undefined) {
    const feeRequirementDescription =
      quote.currentBaseFeePerGas === undefined ? 'buffered next-block base fee' : 'current base fee'
    const minimumBroadcastMaxFeePerGas =
      quote.currentBaseFeePerGas === undefined
        ? quote.minimumMaxFeePerGas
        : quote.currentBaseFeePerGas + minimumPriorityFeePerGas
    if (maxFeePerGas < minimumBroadcastMaxFeePerGas) {
      return {
        valid: false,
        code: 'MaxFeeTooLow',
        reason:
          `Signed transaction maxFeePerGas (${maxFeePerGas.toString()} wei) must be at least ` +
          `${minimumBroadcastMaxFeePerGas.toString()} wei for the ${feeRequirementDescription} ` +
          'and configured minimum priority fee.',
      }
    }
  }
  return { valid: true }
}

async function resolveVaultTransactionFeeQuote({
  readFeeHistory,
  readFallbackEstimate,
  minimumPriorityFeePerGas,
}: {
  readFeeHistory: () => Promise<FeeHistorySnapshot>
  readFallbackEstimate: () => Promise<FallbackFeeEstimate>
  minimumPriorityFeePerGas?: bigint
}): Promise<VaultTransactionFeeQuote> {
  let feeHistoryError: unknown
  try {
    const quote = resolveFeeHistoryQuote({
      ...(await readFeeHistory()),
      minimumPriorityFeePerGas,
    })
    if (quote !== null) return quote
    feeHistoryError = new Error('eth_feeHistory returned incomplete base fee or reward data')
  } catch (error) {
    feeHistoryError = error
  }

  try {
    return resolveFallbackQuote({
      ...(await readFallbackEstimate()),
      minimumPriorityFeePerGas,
    })
  } catch (fallbackError) {
    throw new VaultTransactionFeeEstimationError({ feeHistoryError, fallbackError })
  }
}

/**
 * Resolve explicit EIP-1559 fees for operator-controlled vault transactions.
 *
 * The normal path follows the median p90 priority fee from the last 20 blocks,
 * with a 3 gwei ceiling and a 0.1 gwei floor except on chains that do not use
 * tips for ordering. If fee history is unavailable, Viem's estimate is used
 * while preserving those bounds and its original base-fee allowance.
 */
export async function getVaultTransactionFeeQuote<chain extends Chain | undefined>(
  client: Client<Transport, chain>,
): Promise<VaultTransactionFeeQuote> {
  return resolveVaultTransactionFeeQuote({
    minimumPriorityFeePerGas: getChainPriorityFeeFloor(client.chain?.id),
    readFeeHistory: () =>
      getFeeHistory(client, {
        blockCount: FEE_HISTORY_BLOCK_COUNT,
        blockTag: 'latest',
        rewardPercentiles: FEE_HISTORY_REWARD_PERCENTILES,
      }),
    readFallbackEstimate: () => estimateFeesPerGas(client),
  })
}

export async function getVaultDeltaHedgeHistoricalFeeQuote<chain extends Chain | undefined>(
  client: Client<Transport, chain>,
): Promise<VaultDeltaHedgeFeeQuote> {
  const feeHistory = await getFeeHistory(client, {
    blockCount: FEE_HISTORY_BLOCK_COUNT,
    blockTag: 'latest',
    rewardPercentiles: DELTA_HEDGE_FEE_HISTORY_REWARD_PERCENTILES,
  })
  const quote = resolveDeltaHedgeFeeHistoryQuote({
    ...feeHistory,
    minimumPriorityFeePerGas: getChainPriorityFeeFloor(client.chain?.id),
  })
  if (quote === null) {
    throw new Error('eth_feeHistory returned incomplete p25 base fee or reward data')
  }
  return quote
}

async function resolveVaultDeltaHedgeInitialFeeQuote({
  readRpcQuote,
  readHistoricalQuote,
  minimumPriorityFeePerGas,
}: {
  readRpcQuote: () => Promise<{ baseFeePerGas: bigint; rawPriorityFeePerGas: bigint }>
  readHistoricalQuote: () => Promise<VaultDeltaHedgeFeeQuote>
  minimumPriorityFeePerGas?: bigint
}): Promise<VaultDeltaHedgeFeeQuote> {
  try {
    return resolveRpcPriorityFeeQuote({
      ...(await readRpcQuote()),
      minimumPriorityFeePerGas,
    })
  } catch {
    return readHistoricalQuote()
  }
}

/**
 * Resolve the first fee quote for a delta hedge from the connected RPC's
 * eth_maxPriorityFeePerGas recommendation. A failed RPC recommendation falls
 * back immediately to the rolling historical p25 quote.
 */
export async function getVaultDeltaHedgeInitialFeeQuote<chain extends Chain | undefined>(
  client: Client<Transport, chain>,
): Promise<VaultDeltaHedgeFeeQuote> {
  return resolveVaultDeltaHedgeInitialFeeQuote({
    minimumPriorityFeePerGas: getChainPriorityFeeFloor(client.chain?.id),
    readRpcQuote: async () => {
      const [rawPriorityFee, latestBlock] = await Promise.all([
        client.request({ method: 'eth_maxPriorityFeePerGas' }),
        getBlock(client, { blockTag: 'latest' }),
      ])
      if (latestBlock.baseFeePerGas === null) {
        throw new Error('Latest block does not include an EIP-1559 base fee')
      }
      return {
        baseFeePerGas: latestBlock.baseFeePerGas,
        rawPriorityFeePerGas: hexToBigInt(rawPriorityFee),
      }
    },
    readHistoricalQuote: () => getVaultDeltaHedgeHistoricalFeeQuote(client),
  })
}

export const __transactionFeeTestUtils = {
  clampPriorityFee,
  getChainPriorityFeeFloor,
  resolveDeltaHedgeFeeHistoryQuote,
  resolveFallbackQuote,
  resolveFeeHistoryQuote,
  resolveRpcPriorityFeeQuote,
  resolveVaultDeltaHedgeInitialFeeQuote,
  resolveVaultTransactionFeeQuote,
}
