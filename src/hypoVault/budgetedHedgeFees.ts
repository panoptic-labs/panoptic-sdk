import {
  type VaultDeltaHedgeFeeQuote,
  type VaultTransactionFeePolicy,
  type VaultTransactionFeeQuote,
  REPLACEMENT_FEE_BUMP_DENOMINATOR,
  REPLACEMENT_FEE_BUMP_NUMERATOR,
} from './transactionFees'

export function selectBudgetedHedgeFees({
  quote,
  gasLimit,
  feePolicy,
  originalQuote,
}: {
  quote: VaultDeltaHedgeFeeQuote
  gasLimit: bigint
  feePolicy: VaultTransactionFeePolicy
  originalQuote?: Pick<VaultTransactionFeeQuote, 'maxFeePerGas' | 'maxPriorityFeePerGas'>
}) {
  const baseFee = quote.currentBaseFeePerGas
  const floor = quote.competitivePriorityFeePerGas
  if (
    quote.source !== 'adaptive_hedge' ||
    !feePolicy.marketPriorityFees ||
    gasLimit <= 0n ||
    feePolicy.maxTransactionGasCost <= 0n ||
    baseFee === undefined ||
    baseFee < 0n ||
    floor === undefined ||
    floor < 0n ||
    floor > quote.maxPriorityFeePerGas
  )
    throw new Error('Incomplete budgeted hedge fee authority')

  const bump = (value: bigint) =>
    (value * REPLACEMENT_FEE_BUMP_NUMERATOR + REPLACEMENT_FEE_BUMP_DENOMINATOR - 1n) /
    REPLACEMENT_FEE_BUMP_DENOMINATOR
  const hardMaximum = feePolicy.maxTransactionGasCost / gasLimit
  // Reserve after integer division so the ceil-rounded bump still fits.
  const maximumAffordableFeePerGas =
    originalQuote === undefined
      ? (hardMaximum * REPLACEMENT_FEE_BUMP_DENOMINATOR) / REPLACEMENT_FEE_BUMP_NUMERATOR
      : hardMaximum
  const minimumPriorityFeePerGas =
    originalQuote === undefined || floor >= bump(originalQuote.maxPriorityFeePerGas)
      ? floor
      : bump(originalQuote.maxPriorityFeePerGas)
  const minimumRequiredFeePerGas =
    originalQuote === undefined ||
    baseFee * 2n + minimumPriorityFeePerGas >= bump(originalQuote.maxFeePerGas)
      ? baseFee * 2n + minimumPriorityFeePerGas
      : bump(originalQuote.maxFeePerGas)
  if (minimumRequiredFeePerGas > maximumAffordableFeePerGas)
    return {
      status: 'wait' as const,
      maximumAffordableFeePerGas,
      minimumRequiredFeePerGas,
      minimumPriorityFeePerGas,
    }

  const target =
    quote.maxPriorityFeePerGas > minimumPriorityFeePerGas
      ? quote.maxPriorityFeePerGas
      : minimumPriorityFeePerGas
  const tipRoom = maximumAffordableFeePerGas - 2n * baseFee
  const selectedTip = target < tipRoom ? target : tipRoom
  const desiredMaxFee = 2n * baseFee + selectedTip
  const maxFeePerGas =
    desiredMaxFee >= minimumRequiredFeePerGas ? desiredMaxFee : minimumRequiredFeePerGas
  return {
    status: 'ready' as const,
    quote: {
      ...quote,
      maxFeePerGas,
      maxPriorityFeePerGas: selectedTip,
      minimumMaxFeePerGas: baseFee + selectedTip,
      minimumPriorityFeePerGas: selectedTip,
    },
    feePolicy: Object.freeze({
      ...feePolicy,
      maxTransactionGasCost:
        originalQuote === undefined
          ? gasLimit * maximumAffordableFeePerGas
          : feePolicy.maxTransactionGasCost,
    }),
  }
}
