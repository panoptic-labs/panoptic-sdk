import Decimal from 'decimal.js'

import { tickToSqrtPriceX96 } from '../formatters/tick'
import { getPositionChunkData } from '../sync/chunkTracking'
import { DEFAULT_VEGOID } from '../tokenId/constants'
import { decodeTokenId } from '../tokenId/decode'

export type FillabilityPosition = {
  tokenId: bigint
  positionSize: bigint
  maxMultiplier: string | null
  /** Explicit size denomination for orders whose posted asset differs from the encoded legs. */
  assetIndex?: 0n | 1n
}

export type FillabilityChunks = Record<string, { netLiquidity: bigint; longLiquidity: bigint }>

/** Whether liquidity supports every long option leg at the requested spread cap. */
export function isPositionFillable(
  position: FillabilityPosition,
  chunks: FillabilityChunks,
): boolean {
  try {
    if (position.positionSize <= 0n || position.maxMultiplier === null) return false
    const cap = new Decimal(position.maxMultiplier)
    if (!cap.isFinite() || cap.lte(1)) return false
    const [numerator, denominator] = cap.toFraction()
    const capNumerator = BigInt(numerator.toFixed(0))
    const capDenominator = BigInt(denominator.toFixed(0))
    const decoded = decodeTokenId(position.tokenId)
    const vegoid = decoded.vegoid || DEFAULT_VEGOID
    if (decoded.tickSpacing <= 0n) return false
    const legs = decoded.legs.filter((leg) => leg.isLong && leg.width > 0n)
    if (legs.length === 0) return false
    const remaining = new Map<string, { net: bigint; long: bigint }>()
    for (const leg of legs) {
      const width = leg.width * decoded.tickSpacing
      const lower = leg.strike - width / 2n
      const upper = leg.strike + (width + 1n) / 2n
      const key = `${lower}-${upper}-${leg.tokenType}`
      const chunk = chunks[key]
      if (!chunk || chunk.netLiquidity <= 0n) return false
      const state = remaining.get(key) ?? { net: chunk.netLiquidity, long: chunk.longLiquidity }
      const sqrtLower = tickToSqrtPriceX96(lower)
      const sqrtUpper = tickToSqrtPriceX96(upper)
      const amount = position.positionSize * leg.optionRatio
      const asset = position.assetIndex ?? leg.asset
      // Round only after the complete token0 liquidity conversion.
      const needed =
        asset === 0n
          ? (amount * sqrtLower * sqrtUpper) / ((1n << 96n) * (sqrtUpper - sqrtLower))
          : (amount * (1n << 96n)) / (sqrtUpper - sqrtLower)
      if (needed >= state.net) return false
      const net = state.net - needed
      const long = state.long + needed
      if (long * capDenominator > (capNumerator - capDenominator) * vegoid * net) return false
      remaining.set(key, { net, long })
    }
    return true
  } catch {
    return false
  }
}

/** Read all requested chunks at one block and apply the shared fillability predicate. */
export async function getPositionsFillability(
  params: Omit<Parameters<typeof getPositionChunkData>[0], 'tokenIds' | 'vegoid'> & {
    positions: FillabilityPosition[]
  },
) {
  const tokenIds = [...new Set(params.positions.map((position) => position.tokenId))]
  const data = await getPositionChunkData({ ...params, tokenIds })
  const byTokenId = new Map(data.positions.map((position) => [position.tokenId, position]))
  const results = params.positions.map((position) => {
    const decoded = decodeTokenId(position.tokenId)
    const chunks: FillabilityChunks = {}
    for (const chunk of byTokenId.get(position.tokenId)?.legs ?? []) {
      const leg = decoded.legs.find((candidate) => candidate.index === BigInt(chunk.legIndex))
      if (!leg) continue
      const width = leg.width * decoded.tickSpacing
      const lower = leg.strike - width / 2n
      const upper = leg.strike + (width + 1n) / 2n
      chunks[`${lower}-${upper}-${leg.tokenType}`] = {
        netLiquidity: chunk.netLiquidity,
        longLiquidity: chunk.removedLiquidity,
      }
    }
    return { fillable: isPositionFillable(position, chunks), chunks }
  })
  return { results, _meta: data._meta }
}
