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

function errorChainIncludes(error: unknown, marker: string): boolean {
  const visited = new Set<object>()
  let current: unknown = error

  while (typeof current === 'object' && current !== null && !visited.has(current)) {
    visited.add(current)

    const record = current as Record<string, unknown>
    for (const key of ['message', 'shortMessage', 'details', 'errorName']) {
      const value = record[key]
      if (typeof value === 'string' && value.includes(marker)) {
        return true
      }
    }

    const data = record.data
    if (typeof data === 'object' && data !== null) {
      const errorName = (data as Record<string, unknown>).errorName
      if (typeof errorName === 'string' && errorName.includes(marker)) {
        return true
      }
    }

    current = record.cause
  }

  return false
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

export function isIncorrectPositionListReadError(error: unknown): boolean {
  return errorChainIncludes(error, 'IncorrectPositionList')
}

export const TRUSTED_VAULT_SHARE_PRICE_STATUSES = ['ok', 'stale_oracle_override'] as const

export function isTrustedVaultSharePriceStatus(
  status: string,
): status is (typeof TRUSTED_VAULT_SHARE_PRICE_STATUSES)[number] {
  return TRUSTED_VAULT_SHARE_PRICE_STATUSES.some((trustedStatus) => trustedStatus === status)
}
