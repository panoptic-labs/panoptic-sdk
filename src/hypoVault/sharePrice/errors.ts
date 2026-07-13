export class VaultApyPreInceptionBlockError extends Error {
  readonly blockNumber: bigint
  readonly minBlockNumber: bigint

  constructor({
    blockNumber,
    minBlockNumber,
    context,
  }: {
    blockNumber: bigint
    minBlockNumber: bigint
    context: string
  }) {
    super(
      `[vault-apy][pre-inception] ${context}: block ${blockNumber.toString()} < minBlock ${minBlockNumber.toString()}`,
    )
    this.name = 'VaultApyPreInceptionBlockError'
    this.blockNumber = blockNumber
    this.minBlockNumber = minBlockNumber
  }
}

export function getVaultApyErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return 'unknown error'
}

export function isExpectedHistoricalReadMiss(error: unknown): boolean {
  const message = getVaultApyErrorMessage(error)
  return (
    error instanceof VaultApyPreInceptionBlockError ||
    message.includes('returned no data ("0x")') ||
    message.includes('InvalidPools()') ||
    message.includes('[computeNAV]') ||
    message.includes('The contract function "computeNAV" reverted')
  )
}

export function isStaleOraclePriceError(error: unknown): boolean {
  const message = getVaultApyErrorMessage(error)
  return message.includes('StaleOraclePrice()') || message.includes('0xa887f2d8')
}

export function isStaleOraclePriceReadError(error: unknown): boolean {
  return isStaleOraclePriceError(error)
}
