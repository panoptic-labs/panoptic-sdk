/**
 * Pure TokenId decomposition into shorter-timescale positions.
 * @module v2/tokenId/split
 */

import { PanopticValidationError } from '../errors'
import { type Timescale, LEG_LIMITS, STANDARD_TICK_WIDTHS, TOKEN_ID_BITS } from './constants'
import { type DecodedLeg, addLegToTokenId, decodeAllLegs, decodeTickSpacing } from './encoding'

const POOL_ID_MASK = (1n << TOKEN_ID_BITS.POOL_ID_SIZE) - 1n
const MAX_UINT128 = (1n << 128n) - 1n
const MAX_UINT256 = (1n << 256n) - 1n

/** TokenIds and sizes aligned with the corresponding `dispatch()` arguments. */
export interface SplitTokenIdByTimescaleResult {
  positionIdList: bigint[]
  positionSizes: bigint[]
}

type LegGroup = DecodedLeg[]

function invalid(message: string): never {
  throw new PanopticValidationError(`splitTokenIdByTimescale: ${message}`)
}

function validateInput(tokenId: bigint, positionSize: bigint): DecodedLeg[] {
  if (tokenId < 0n || tokenId > MAX_UINT256) invalid('tokenId must fit in uint256')
  if (positionSize <= 0n || positionSize > MAX_UINT128) {
    invalid('positionSize must be between 1 and uint128.max')
  }

  const legs = decodeAllLegs(tokenId)
  if (legs.length === 0) invalid('tokenId must contain at least one active leg')

  for (const [index, leg] of legs.entries()) {
    if (leg.index !== BigInt(index)) invalid('active legs must be contiguous from index 0')
  }

  const firstUnusedBit = TOKEN_ID_BITS.POOL_ID_SIZE + BigInt(legs.length) * TOKEN_ID_BITS.LEG_SIZE
  if (tokenId >> firstUnusedBit !== 0n) invalid('inactive leg slots must be empty')

  const byIndex = new Map(legs.map((leg) => [leg.index, leg]))
  for (const leg of legs) {
    const partner = byIndex.get(leg.riskPartner)
    if (partner === undefined) invalid(`leg ${leg.index} references an inactive risk partner`)
    if (partner.index !== leg.index && partner.riskPartner !== leg.index) {
      invalid(`leg ${leg.index} has a non-mutual risk partner`)
    }
  }

  return legs
}

function isCall(leg: DecodedLeg): boolean {
  return leg.tokenType === leg.asset
}

function isEconomicStraddlePair(left: DecodedLeg, right: DecodedLeg): boolean {
  return (
    isCall(left) !== isCall(right) &&
    left.asset === right.asset &&
    left.optionRatio === right.optionRatio &&
    left.isLong === right.isLong &&
    left.strike === right.strike &&
    left.width === right.width
  )
}

/** Preserve mutual pairs, then pair self-partnered economic straddles in source order. */
function groupOptionLegs(optionLegs: DecodedLeg[]): LegGroup[] {
  const byIndex = new Map(optionLegs.map((leg) => [leg.index, leg]))
  const consumed = new Set<bigint>()
  const groups: LegGroup[] = []

  for (const leg of optionLegs) {
    if (consumed.has(leg.index)) continue

    if (leg.riskPartner !== leg.index) {
      const riskPartner = byIndex.get(leg.riskPartner)
      if (riskPartner === undefined) {
        invalid(`mutual risk pair containing leg ${leg.index} cannot be separated`)
      }

      consumed.add(leg.index)
      consumed.add(riskPartner.index)
      groups.push([leg, riskPartner])
      continue
    }

    const partner = optionLegs.find(
      (candidate) =>
        candidate.index > leg.index &&
        !consumed.has(candidate.index) &&
        candidate.riskPartner === candidate.index &&
        isEconomicStraddlePair(leg, candidate),
    )

    consumed.add(leg.index)
    if (partner === undefined) {
      groups.push([leg])
      continue
    }

    consumed.add(partner.index)
    groups.push([leg, partner])
  }

  return groups
}

function remapRiskPartner(leg: DecodedLeg, indexBySource: ReadonlyMap<bigint, bigint>): bigint {
  const riskPartner = indexBySource.get(leg.riskPartner)
  if (riskPartner === undefined) {
    invalid(`risk partner for leg ${leg.index} is missing from its output group`)
  }
  return riskPartner
}

function buildTokenId(
  poolId: bigint,
  legs: LegGroup,
  transform: (leg: DecodedLeg) => Pick<DecodedLeg, 'strike' | 'width'>,
): bigint {
  const indexBySource = new Map(legs.map((leg, index) => [leg.index, BigInt(index)]))
  let output = poolId

  for (const [index, leg] of legs.entries()) {
    const newIndex = BigInt(index)
    const { strike, width } = transform(leg)
    if (strike < LEG_LIMITS.MIN_STRIKE || strike > LEG_LIMITS.MAX_STRIKE) {
      invalid(`generated strike ${strike} does not fit in int24`)
    }
    if (width < 0n || width > LEG_LIMITS.MAX_WIDTH) {
      invalid(`generated width ${width} does not fit in the TokenId width field`)
    }

    output = addLegToTokenId(output, {
      index: newIndex,
      asset: leg.asset,
      optionRatio: leg.optionRatio,
      isLong: leg.isLong ? 1n : 0n,
      tokenType: leg.tokenType,
      riskPartner: remapRiskPartner(leg, indexBySource),
      strike,
      width,
    })
  }

  return output
}

function childWidths(sourceWidth: bigint, targetWidth: bigint): bigint[] {
  if (sourceWidth <= targetWidth) return [sourceWidth]

  const fullWidthCount = sourceWidth / targetWidth
  const remainder = sourceWidth % targetWidth
  const widths: bigint[] = []
  for (let remaining = fullWidthCount; remaining > 0n; remaining -= 1n) {
    widths.push(targetWidth)
  }
  if (remainder > 0n) widths.push(remainder)
  return widths
}

function dividePositionSize(positionSize: bigint, count: number): bigint[] {
  const countBigInt = BigInt(count)
  if (positionSize < countBigInt) {
    invalid(`positionSize ${positionSize} is too small for ${count} nonzero child positions`)
  }

  const quotient = positionSize / countBigInt
  const remainder = positionSize % countBigInt
  return Array.from(
    { length: count },
    (_, index) => quotient + (BigInt(index) < remainder ? 1n : 0n),
  )
}

function splitGroup(
  poolId: bigint,
  group: LegGroup,
  tickSpacing: bigint,
  targetWidth: bigint,
  positionSize: bigint,
): SplitTokenIdByTimescaleResult {
  const sourceWidth = group[0]?.width
  if (sourceWidth === undefined || sourceWidth === 0n)
    invalid('option group must have nonzero width')
  if (group.some((leg) => leg.width !== sourceWidth)) {
    invalid('all legs in an option group must have the same width')
  }

  const widths = childWidths(sourceWidth, targetWidth)
  const positionSizes = dividePositionSize(positionSize, widths.length)
  let consumedWidth = 0n

  const positionIdList = widths.map((width) => {
    const offset = consumedWidth
    consumedWidth += width

    return buildTokenId(poolId, group, (leg) => {
      // PanopticMath.getTicks uses floor below the strike and ceil above it.
      const sourceLower = leg.strike - (sourceWidth * tickSpacing) / 2n
      const childLower = sourceLower + offset * tickSpacing
      const strike = childLower + (width * tickSpacing) / 2n
      return { strike, width }
    })
  })

  return { positionIdList, positionSizes }
}

/**
 * Split every standalone option, economic straddle, or mutual risk pair in a
 * TokenId into a shorter standard timescale. Width-zero credit/loan legs are
 * emitted together as one final position. Returned arrays are parallel and
 * ready for `dispatch()`.
 *
 * Each option group divides `positionSize` independently across its children.
 * Integer remainder units are assigned to the lower children first.
 */
export function splitTokenIdByTimescale(
  tokenId: bigint,
  positionSize: bigint,
  targetTimescale: Timescale,
): SplitTokenIdByTimescaleResult {
  const legs = validateInput(tokenId, positionSize)
  const tickSpacing = decodeTickSpacing(tokenId)
  if (tickSpacing <= 0n) invalid('tokenId tick spacing must be positive')

  const targetTickWidth = STANDARD_TICK_WIDTHS[targetTimescale]
  if (targetTickWidth === undefined) invalid(`unknown target timescale ${String(targetTimescale)}`)
  const targetWidth = (targetTickWidth + tickSpacing - 1n) / tickSpacing

  const poolId = tokenId & POOL_ID_MASK
  const optionLegs = legs.filter((leg) => leg.width > 0n)
  const fundingLegs = legs.filter((leg) => leg.width === 0n)
  const positionIdList: bigint[] = []
  const positionSizes: bigint[] = []

  for (const group of groupOptionLegs(optionLegs)) {
    const split = splitGroup(poolId, group, tickSpacing, targetWidth, positionSize)
    positionIdList.push(...split.positionIdList)
    positionSizes.push(...split.positionSizes)
  }

  if (fundingLegs.length > 0) {
    positionIdList.push(
      buildTokenId(poolId, fundingLegs, (leg) => ({ strike: leg.strike, width: leg.width })),
    )
    positionSizes.push(positionSize)
  }

  return { positionIdList, positionSizes }
}
