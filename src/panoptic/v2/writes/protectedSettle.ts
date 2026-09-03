/**
 * Construction of fee-protected self-settlement dispatches.
 *
 * A short position's displayed premium can include fees that still live in
 * Uniswap. Minting a temporary, minimal short over the same chunks collects
 * those fees into `settledTokens`; burning it after settlement leaves the
 * caller's position list unchanged.
 * @module v2/writes/protectedSettle
 */

import { PanopticError } from '../errors'
import { tickToSqrtPriceX96 } from '../formatters'
import type { DispatchIntent } from '../simulations/creditWrap'
import { addLegToTokenId, decodeAllLegs, decodeTickSpacing } from '../tokenId'

const POOL_ID_MASK = (1n << 64n) - 1n
const Q96 = 1n << 96n
const MAX_UINT128 = (1n << 128n) - 1n
const SETTLE_LIMITS = [-887272n, 887272n, 0n] as const

export interface BuildProtectedSettleDispatchParams {
  /** Positions whose premium should be settled. */
  positionIdList: bigint[]
  /** The caller's complete held list. A settlement does not change it. */
  finalPositionIdList: bigint[]
  /** Current stored size for every entry in `positionIdList`. */
  positionSizes: bigint[]
  usePremiaAsCollateral?: boolean
  builderCode?: bigint
}

export interface ProtectedSettlePlan {
  /** Atomic poke/settle/poke dispatch submitted after buyer settlements. */
  dispatch: DispatchIntent
  /** Poke-only dispatch used to verify no displayed premium remains uncollected. */
  collectionDispatch?: DispatchIntent
  /** Temporary position IDs, one for each settled position containing short chunks. */
  pokingTokenIds: bigint[]
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator
}

/** Smallest position size that creates non-zero liquidity on every poke leg. */
function minimumPokeSize(
  legs: ReturnType<typeof decodeAllLegs>,
  tickSpacing: bigint,
): bigint | undefined {
  let requiredSize = 1n

  for (const leg of legs) {
    const widthInTicks = leg.width * tickSpacing
    const lowerTick = leg.strike - widthInTicks / 2n
    const upperTick = leg.strike + (widthInTicks + 1n) / 2n
    const sqrtLower = tickToSqrtPriceX96(lowerTick)
    const sqrtUpper = tickToSqrtPriceX96(upperTick)
    const delta = sqrtUpper - sqrtLower
    const liquidityFactor = leg.asset === 0n ? (sqrtLower * sqrtUpper) / Q96 : Q96
    if (liquidityFactor === 0n) return undefined
    const requiredAmount = ceilDiv(delta, liquidityFactor)
    const legSize = ceilDiv(requiredAmount, leg.optionRatio)
    if (legSize > requiredSize) requiredSize = legSize
  }

  if (requiredSize > MAX_UINT128) {
    return undefined
  }
  return requiredSize
}

function encodePokeToken(
  sourceTokenId: bigint,
  legs: ReturnType<typeof decodeAllLegs>,
  firstRatio: bigint,
  assetMask: bigint,
): bigint {
  let tokenId = sourceTokenId & POOL_ID_MASK
  legs.forEach((leg, index) => {
    const encodedIndex = BigInt(index)
    tokenId = addLegToTokenId(tokenId, {
      index: encodedIndex,
      asset: (assetMask >> encodedIndex) & 1n,
      optionRatio: index === 0 ? firstRatio : leg.optionRatio,
      isLong: 0n,
      tokenType: leg.tokenType,
      riskPartner: encodedIndex,
      strike: leg.strike,
      width: leg.width,
    })
  })
  return tokenId
}

function buildUniquePoke(
  sourceTokenId: bigint,
  occupied: Set<bigint>,
): { tokenId: bigint; size: bigint } | undefined {
  const seenChunks = new Set<string>()
  const shortChunkLegs = decodeAllLegs(sourceTokenId).filter((leg) => {
    if (leg.isLong || leg.width === 0n) return false
    const chunkKey = `${leg.strike}:${leg.width}:${leg.tokenType}`
    if (seenChunks.has(chunkKey)) return false
    seenChunks.add(chunkKey)
    return true
  })
  if (shortChunkLegs.length === 0) return undefined

  const originalRatio = shortChunkLegs[0].optionRatio
  for (let ratioOffset = 0n; ratioOffset < 127n; ratioOffset += 1n) {
    const firstRatio = ((originalRatio - 1n + ratioOffset) % 127n) + 1n
    const assetVariants = 1n << BigInt(shortChunkLegs.length)
    for (let assetMask = 0n; assetMask < assetVariants; assetMask += 1n) {
      const tokenId = encodePokeToken(sourceTokenId, shortChunkLegs, firstRatio, assetMask)
      if (!occupied.has(tokenId)) {
        const size = minimumPokeSize(decodeAllLegs(tokenId), decodeTickSpacing(sourceTokenId))
        if (size !== undefined) return { tokenId, size }
      }
    }
  }

  throw new PanopticError('Unable to derive a collision-free protected settlement poke')
}

/**
 * Build `[poke, settle, poke]` for every target containing a width>0 short.
 * Pure-long and width-zero positions are settled directly.
 */
export function buildProtectedSettlePlan(
  params: BuildProtectedSettleDispatchParams,
): ProtectedSettlePlan {
  const {
    positionIdList,
    finalPositionIdList,
    positionSizes,
    usePremiaAsCollateral = false,
    builderCode = 0n,
  } = params
  if (positionIdList.length !== positionSizes.length) {
    throw new PanopticError('Protected settlement: positionSizes length must match positionIdList')
  }

  const occupied = new Set(finalPositionIdList)
  const actionIds: bigint[] = []
  const actionSizes: bigint[] = []
  const actionLimits: (readonly [bigint, bigint, bigint])[] = []
  const collectionIds: bigint[] = []
  const collectionSizes: bigint[] = []
  const collectionLimits: (readonly [bigint, bigint, bigint])[] = []
  const pokingTokenIds: bigint[] = []

  positionIdList.forEach((tokenId, index) => {
    const poke = buildUniquePoke(tokenId, occupied)
    if (poke === undefined) {
      actionIds.push(tokenId)
      actionSizes.push(positionSizes[index])
      actionLimits.push(SETTLE_LIMITS)
      return
    }

    occupied.add(poke.tokenId)
    pokingTokenIds.push(poke.tokenId)
    actionIds.push(poke.tokenId, tokenId, poke.tokenId)
    actionSizes.push(poke.size, positionSizes[index], 0n)
    actionLimits.push(SETTLE_LIMITS, SETTLE_LIMITS, SETTLE_LIMITS)
    collectionIds.push(poke.tokenId, poke.tokenId)
    collectionSizes.push(poke.size, 0n)
    collectionLimits.push(SETTLE_LIMITS, SETTLE_LIMITS)
  })

  const base = { finalPositionIdList: [...finalPositionIdList], usePremiaAsCollateral, builderCode }
  return {
    dispatch: {
      ...base,
      positionIdList: actionIds,
      positionSizes: actionSizes,
      tickAndSpreadLimits: actionLimits,
    },
    collectionDispatch:
      collectionIds.length === 0
        ? undefined
        : {
            ...base,
            positionIdList: collectionIds,
            positionSizes: collectionSizes,
            tickAndSpreadLimits: collectionLimits,
          },
    pokingTokenIds,
  }
}

/**
 * Build the atomic self-settlement dispatch that temporarily pokes each
 * affected short chunk before settling its source position.
 *
 * @param params - Positions, current sizes, and complete held-position list.
 * @returns A dispatch intent ready for simulation or submission.
 */
export function buildProtectedSettleDispatch(
  params: BuildProtectedSettleDispatchParams,
): DispatchIntent {
  return buildProtectedSettlePlan(params).dispatch
}
