import { describe, expect, it } from 'vitest'

import {
  buildUpfrontCoveredCallTokenId,
  hasCoveredCallFingerprint,
  isUpfrontCoveredCallTokenId,
} from './coveredCall'
import {
  buildCoveredCallCollectDispatch,
  buildCoveredCallIncreaseDispatch,
  buildCoveredCallResizeDispatch,
  coveredCallSiblingTokenId,
} from './coveredCallResize'
import { decodeAllLegs } from './encoding'

const call = (assetIdx: 0n | 1n, positionSize = 10n ** 18n, depth = 800n) => {
  const sign = assetIdx === 0n ? 1n : -1n
  const strike = sign * -199710n
  return buildUpfrontCoveredCallTokenId({
    poolId: 0x000a0888e6a0c2ddn,
    assetIdx,
    strike,
    width: 240n,
    tickSpacing: 10n,
    positionSize,
    currentTick: strike + sign * depth,
  }).tokenId
}
const limits = [-10n, 10n, 0n] as const
const other = 12345n

describe('coveredCallSiblingTokenId', () => {
  it.each([0n, 1n] as const)('keeps the covered call shape for asset %s', (assetIdx) => {
    const tokenId = call(assetIdx)
    const sibling = coveredCallSiblingTokenId(tokenId)
    expect(sibling).not.toBe(tokenId)
    expect(isUpfrontCoveredCallTokenId(sibling)).toBe(true)
    expect(hasCoveredCallFingerprint(sibling)).toBe(true)
    const [before, after] = [decodeAllLegs(tokenId), decodeAllLegs(sibling)]
    // Only the credit leg's strike moves, by one tick.
    expect(after.map((leg) => leg.width)).toEqual(before.map((leg) => leg.width))
    const creditBefore = before.find((leg) => leg.width === 0n)
    const creditAfter = after.find((leg) => leg.width === 0n)
    expect(creditAfter?.optionRatio).toBe(creditBefore?.optionRatio)
    expect(Math.abs(Number((creditAfter?.strike ?? 0n) - (creditBefore?.strike ?? 0n)))).toBe(1)
    expect(after.find((leg) => leg.width > 0n)).toEqual(before.find((leg) => leg.width > 0n))
  })

  it('skips taken siblings', () => {
    const tokenId = call(0n)
    const first = coveredCallSiblingTokenId(tokenId)
    const second = coveredCallSiblingTokenId(tokenId, [first])
    expect(second).not.toBe(first)
    expect(second).not.toBe(tokenId)
  })

  it('rejects non covered calls', () => {
    expect(() => coveredCallSiblingTokenId(other)).toThrow()
  })
})

describe('covered call resize dispatch', () => {
  const tokenId = call(0n)

  it('mints the replacement before burning the old position', () => {
    const dispatch = buildCoveredCallResizeDispatch({
      existingPositionIds: [other, tokenId],
      tokenId,
      newTokenId: 7n,
      newPositionSize: 5n,
      mintLimits: [1n, 2n, 3n],
      burnLimits: limits,
    })
    expect(dispatch.positionIdList).toEqual([7n, tokenId])
    expect(dispatch.positionSizes).toEqual([5n, 0n])
    expect(dispatch.finalPositionIdList).toEqual([other, 7n])
    expect(dispatch.tickAndSpreadLimits).toEqual([[1n, 2n, 3n], limits])
  })

  it('rejects a replacement that is already held or a position that is not', () => {
    const base = { tokenId, newPositionSize: 1n, mintLimits: limits, burnLimits: limits }
    expect(() =>
      buildCoveredCallResizeDispatch({
        ...base,
        existingPositionIds: [tokenId],
        newTokenId: tokenId,
      }),
    ).toThrow()
    expect(() =>
      buildCoveredCallResizeDispatch({ ...base, existingPositionIds: [other], newTokenId: 7n }),
    ).toThrow()
  })

  it('collects by re-minting a same-size sibling', () => {
    const dispatch = buildCoveredCallCollectDispatch({
      existingPositionIds: [tokenId],
      tokenId,
      positionSize: 10n ** 18n,
      mintLimits: limits,
      burnLimits: limits,
    })
    expect(dispatch.newTokenId).toBe(coveredCallSiblingTokenId(tokenId))
    expect(dispatch.positionSizes).toEqual([10n ** 18n, 0n])
  })

  it('increases with a larger replacement, using a sibling on collision', () => {
    // Re-priced at a different tick: the credit strike (hence the tokenId) moves.
    const bigger = call(0n, 2n * 10n ** 18n, 1200n)
    expect(bigger).not.toBe(tokenId)
    const fresh = buildCoveredCallIncreaseDispatch({
      existingPositionIds: [tokenId],
      tokenId,
      positionSize: 10n ** 18n,
      newTokenId: bigger,
      newPositionSize: 2n * 10n ** 18n,
      mintLimits: limits,
      burnLimits: limits,
    })
    expect(fresh.newTokenId).toBe(bigger)
    expect(fresh.positionSizes).toEqual([2n * 10n ** 18n, 0n])
    const collided = buildCoveredCallIncreaseDispatch({
      existingPositionIds: [tokenId],
      tokenId,
      positionSize: 10n ** 18n,
      newTokenId: tokenId,
      newPositionSize: 2n * 10n ** 18n,
      mintLimits: limits,
      burnLimits: limits,
    })
    expect(collided.newTokenId).toBe(coveredCallSiblingTokenId(tokenId))
    expect(() =>
      buildCoveredCallIncreaseDispatch({
        existingPositionIds: [tokenId],
        tokenId,
        positionSize: 10n ** 18n,
        newTokenId: bigger,
        newPositionSize: 10n ** 18n,
        mintLimits: limits,
        burnLimits: limits,
      }),
    ).toThrow()
  })
})

describe('buildCoveredCallResizeDispatch at the leg limit', () => {
  const held = call(0n)
  const replacement = coveredCallSiblingTokenId(held)
  const base = {
    existingPositionIds: [held],
    tokenId: held,
    newTokenId: replacement,
    newPositionSize: 10n ** 18n,
    mintLimits: limits,
    burnLimits: [-20n, 20n, 0n] as const,
  }

  it('mints first while the extra legs fit', () => {
    const dispatch = buildCoveredCallResizeDispatch({ ...base, maxLegs: 4n })
    expect(dispatch.positionIdList).toEqual([replacement, held])
    expect(dispatch.positionSizes).toEqual([10n ** 18n, 0n])
  })

  it('burns first when minting first would exceed the limit', () => {
    const dispatch = buildCoveredCallResizeDispatch({ ...base, maxLegs: 2n })
    expect(dispatch.positionIdList).toEqual([held, replacement])
    expect(dispatch.positionSizes).toEqual([0n, 10n ** 18n])
    expect(dispatch.tickAndSpreadLimits).toEqual([base.burnLimits, limits])
    expect(dispatch.finalPositionIdList).toEqual([replacement])
  })

  it('rejects a resize whose final leg count exceeds the limit', () => {
    expect(() => buildCoveredCallResizeDispatch({ ...base, maxLegs: 1n })).toThrow(/max 1/)
  })
})
