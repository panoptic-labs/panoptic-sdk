import { TOKEN_ID_BITS } from './constants'
import { decodeLeg } from './encoding'

/**
 * Validate a TokenId's structure using the rules of TokenId.validate.
 * This does not check pool registration, available liquidity, or account collateral.
 */
export function getTokenIdValidationError(tokenId: bigint): string | null {
  if (tokenId < 0n || tokenId >= 1n << 256n) return 'Token ID must fit in uint256.'

  const legs = []
  for (let index = 0n; index < TOKEN_ID_BITS.MAX_LEGS; index++) {
    const leg = decodeLeg(tokenId, index)
    if (leg.optionRatio === 0n) {
      const offset = TOKEN_ID_BITS.POOL_ID_SIZE + index * TOKEN_ID_BITS.LEG_SIZE
      if (tokenId >> offset !== 0n) return 'Position contains empty or non-contiguous legs.'
      break
    }
    legs.push(leg)
  }
  if (legs.length === 0) return 'Position must contain at least one leg.'

  const chunks = new Set<string>()
  for (const leg of legs) {
    // The contract's chunk key excludes asset, ratio, direction, and risk partner.
    const chunk = `${leg.strike}:${leg.width}:${leg.tokenType}`
    if (chunks.has(chunk))
      return 'Position contains duplicate legs sharing the same liquidity chunk.'
    chunks.add(chunk)

    if (leg.strike <= -887272n || leg.strike >= 887272n) {
      return 'Position strike must be inside the pool tick bounds.'
    }
    const partner = legs[Number(leg.riskPartner)]
    if (!partner || partner.riskPartner !== leg.index) {
      return 'Position risk partners must reference existing legs and be mutual.'
    }
  }
  return null
}
