import { describe, expect, it } from 'vitest'

import { PanopticError } from '../errors'
import { createTokenIdBuilder, decodeAllLegs } from '../tokenId'
import { buildProtectedSettlePlan } from './protectedSettle'

const POOL_ID = 10n << 48n

describe('buildProtectedSettlePlan', () => {
  it('rejects a position size list that does not match the positions', () => {
    expect(() =>
      buildProtectedSettlePlan({
        positionIdList: [1n, 2n],
        finalPositionIdList: [1n, 2n],
        positionSizes: [1n],
      }),
    ).toThrow(PanopticError)
  })

  it('sandwiches a width-positive short with a minimal temporary position', () => {
    const short = createTokenIdBuilder(POOL_ID)
      .addPut({ strike: 0n, width: 10n, optionRatio: 1n, isLong: false })
      .build()
    const plan = buildProtectedSettlePlan({
      positionIdList: [short],
      finalPositionIdList: [short],
      positionSizes: [100n],
    })

    const poke = plan.pokingTokenIds[0]
    expect(poke).toBeDefined()
    expect(plan.dispatch.positionIdList).toEqual([poke, short, poke])
    expect(plan.dispatch.positionSizes[0]).toBeGreaterThan(0n)
    expect(plan.dispatch.positionSizes).toEqual([plan.dispatch.positionSizes[0], 100n, 0n])
    expect(plan.dispatch.finalPositionIdList).toEqual([short])
    expect(decodeAllLegs(poke ?? 0n).every((leg) => !leg.isLong && leg.width > 0n)).toBe(true)
    expect(plan.collectionDispatch?.positionIdList).toEqual([poke, poke])
  })

  it('settles pure longs directly without a poke', () => {
    const long = createTokenIdBuilder(POOL_ID)
      .addCall({ strike: 0n, width: 10n, optionRatio: 1n, isLong: true })
      .build()
    const plan = buildProtectedSettlePlan({
      positionIdList: [long],
      finalPositionIdList: [long],
      positionSizes: [42n],
    })

    expect(plan.pokingTokenIds).toEqual([])
    expect(plan.collectionDispatch).toBeUndefined()
    expect(plan.dispatch.positionIdList).toEqual([long])
    expect(plan.dispatch.positionSizes).toEqual([42n])
  })

  it('derives a collision-free poke when the first candidate is already held', () => {
    const short = createTokenIdBuilder(POOL_ID)
      .addCall({ strike: 100n, width: 4n, optionRatio: 1n, isLong: false })
      .build()
    const first = buildProtectedSettlePlan({
      positionIdList: [short],
      finalPositionIdList: [short],
      positionSizes: [1n],
    }).pokingTokenIds[0]
    const plan = buildProtectedSettlePlan({
      positionIdList: [short],
      finalPositionIdList: first === undefined ? [short] : [short, first],
      positionSizes: [1n],
    })

    expect(plan.pokingTokenIds[0]).not.toBe(first)
    expect(plan.pokingTokenIds[0]).not.toBe(short)
  })

  it('does not poke width-zero short loan legs', () => {
    const loan = createTokenIdBuilder(POOL_ID)
      .addLoan({ strike: 0n, tokenType: 0n, asset: 0n })
      .build()
    const plan = buildProtectedSettlePlan({
      positionIdList: [loan],
      finalPositionIdList: [loan],
      positionSizes: [5n],
    })

    expect(plan.pokingTokenIds).toEqual([])
    expect(plan.dispatch.positionIdList).toEqual([loan])
  })

  it('chooses the viable asset basis at an extreme tick', () => {
    const short = createTokenIdBuilder(1n << 48n)
      .addCall({
        asset: 1n,
        strike: -887271n,
        width: 2n,
        optionRatio: 1n,
        isLong: false,
      })
      .build()
    const plan = buildProtectedSettlePlan({
      positionIdList: [short],
      finalPositionIdList: [short],
      positionSizes: [1n],
    })

    expect(decodeAllLegs(plan.pokingTokenIds[0] ?? 0n)[0]?.asset).toBe(1n)
  })
})
