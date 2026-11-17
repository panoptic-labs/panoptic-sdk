/**
 * Unit tests for direct-LP token IDs and liquidity planning.
 * @module v2/sfpmLp/position.test
 */
import { describe, expect, it } from 'vitest'

import { createTokenIdBuilder } from '../tokenId'
import {
  type SfpmLpRange,
  buildSfpmLpTokenId,
  decodeSfpmLpLegs,
  minSfpmLpPositionSize,
  planSfpmLpBurn,
  sfpmLpLegLiquidity,
} from './position'

// tickSpacing 10, vegoid 4 (mainnet 5bps USDC/WETH).
const POOL_ID = 0xa0488e6a0c2ddn
// tickSpacing 1, vegoid 4.
const POOL_ID_SPACING_1 = (1n << 48n) | (4n << 40n) | 0x1234n

const range0: SfpmLpRange = { tickLower: 200_000n, tickUpper: 200_100n, asset: 0n }
const range1: SfpmLpRange = { tickLower: 199_500n, tickUpper: 200_050n, asset: 1n }

/** Net liquidity per leg after minting `sizes` one at a time. */
function mintedLiquidity(tokenId: bigint, sizes: bigint[]): bigint[] {
  return decodeSfpmLpLegs(tokenId).map((leg) =>
    sizes.reduce((sum, size) => sum + sfpmLpLegLiquidity(leg, size), 0n),
  )
}

/** Two sizes whose separate mints hold less liquidity than one burn of their sum removes. */
function findRoundingDeficit(tokenId: bigint): [bigint, bigint] {
  const [leg] = decodeSfpmLpLegs(tokenId)
  if (leg === undefined) throw new Error('no legs')
  for (let a = 1_000_001n; a < 1_000_200n; a++) {
    const b = 777_777n
    if (sfpmLpLegLiquidity(leg, a) + sfpmLpLegLiquidity(leg, b) < sfpmLpLegLiquidity(leg, a + b)) {
      return [a, b]
    }
  }
  throw new Error('no rounding deficit found')
}

describe('buildSfpmLpTokenId', () => {
  it.each([0n, 1n] as const)('round-trips a single range with asset %s', (asset) => {
    const tokenId = buildSfpmLpTokenId({ poolId: POOL_ID, ranges: [{ ...range0, asset }] })
    expect(decodeSfpmLpLegs(tokenId)).toEqual([
      {
        index: 0n,
        asset,
        tokenType: asset,
        optionRatio: 1n,
        tickLower: 200_000n,
        tickUpper: 200_100n,
      },
    ])
  })

  it('round-trips an odd-width range, where the strike is not the midpoint', () => {
    const tokenId = buildSfpmLpTokenId({
      poolId: POOL_ID_SPACING_1,
      ranges: [{ tickLower: -7n, tickUpper: -4n, asset: 0n }],
    })
    const [leg] = decodeSfpmLpLegs(tokenId)
    expect(leg).toMatchObject({ tickLower: -7n, tickUpper: -4n })
  })

  it('round-trips multiple overlapping ranges in mixed assets', () => {
    const ranges: SfpmLpRange[] = [
      range0,
      range1,
      { tickLower: 199_900n, tickUpper: 200_200n, asset: 0n, tokenType: 1n, optionRatio: 3n },
      { ...range0, tokenType: 1n },
    ]
    const legs = decodeSfpmLpLegs(buildSfpmLpTokenId({ poolId: POOL_ID, ranges }))
    expect(legs.map((leg) => [leg.tickLower, leg.tickUpper, leg.asset, leg.tokenType])).toEqual([
      [200_000n, 200_100n, 0n, 0n],
      [199_500n, 200_050n, 1n, 1n],
      [199_900n, 200_200n, 0n, 1n],
      [200_000n, 200_100n, 0n, 1n],
    ])
    expect(legs[2]?.optionRatio).toBe(3n)
  })

  it('rejects invalid range sets', () => {
    const build = (ranges: SfpmLpRange[]) => () => buildSfpmLpTokenId({ poolId: POOL_ID, ranges })
    expect(build([])).toThrow(/1-4 ranges/)
    expect(build([range0, range0])).toThrow(/appears twice/)
    expect(build([{ ...range0, tickUpper: 200_105n }])).toThrow(/not aligned/)
    expect(build([{ ...range0, tickUpper: 200_000n }])).toThrow(/tickLower < tickUpper/)
    expect(build([{ ...range0, tickUpper: 300_000n }])).toThrow(/maximum is 4095/)
  })
})

describe('decodeSfpmLpLegs', () => {
  it('rejects long legs and zero-width legs', () => {
    const long = createTokenIdBuilder(POOL_ID)
      .addLeg({
        asset: 0n,
        tokenType: 0n,
        optionRatio: 1n,
        isLong: true,
        strike: 200_050n,
        width: 10n,
      })
      .build()
    const loan = createTokenIdBuilder(POOL_ID)
      .addLoan({ asset: 0n, tokenType: 0n, strike: 0n })
      .build()
    expect(() => decodeSfpmLpLegs(long)).toThrow(/liquidity-adding/)
    expect(() => decodeSfpmLpLegs(loan)).toThrow(/liquidity-adding/)
  })
})

describe('sfpmLpLegLiquidity', () => {
  it('scales with the option ratio and never over-counts split sizes', () => {
    const [single] = decodeSfpmLpLegs(buildSfpmLpTokenId({ poolId: POOL_ID, ranges: [range1] }))
    const [triple] = decodeSfpmLpLegs(
      buildSfpmLpTokenId({ poolId: POOL_ID, ranges: [{ ...range1, optionRatio: 3n }] }),
    )
    if (single === undefined || triple === undefined) throw new Error('no legs')
    expect(sfpmLpLegLiquidity(triple, 1_000n)).toBe(sfpmLpLegLiquidity(single, 3_000n))
    expect(
      sfpmLpLegLiquidity(single, 1_234n) + sfpmLpLegLiquidity(single, 4_321n),
    ).toBeLessThanOrEqual(sfpmLpLegLiquidity(single, 5_555n))
  })
})

describe('minSfpmLpPositionSize', () => {
  it.each([[range0], [range1], [range0, range1]])(
    'is the smallest size with liquidity',
    (...ranges) => {
      const legs = decodeSfpmLpLegs(buildSfpmLpTokenId({ poolId: POOL_ID, ranges }))
      const min = minSfpmLpPositionSize(legs)
      expect(legs.every((leg) => sfpmLpLegLiquidity(leg, min) > 0n)).toBe(true)
      expect(legs.some((leg) => sfpmLpLegLiquidity(leg, min - 1n) === 0n)).toBe(true)
    },
  )
})

describe('minSfpmLpPositionSize rejection', () => {
  it('rejects a range that cannot hold liquidity at any size', () => {
    const tokenId = buildSfpmLpTokenId({
      poolId: POOL_ID,
      ranges: [{ tickLower: -880_000n, tickUpper: -870_000n, asset: 0n }],
    })
    expect(() => minSfpmLpPositionSize(decodeSfpmLpLegs(tokenId))).toThrow(
      /cannot hold liquidity at any position size/,
    )
  })
})

describe('planSfpmLpBurn', () => {
  it.each([[range0], [range1], [range0, range1]])(
    'burns a single-mint position in one call, fully or partially',
    (...ranges) => {
      const tokenId = buildSfpmLpTokenId({ poolId: POOL_ID, ranges })
      const legs = decodeSfpmLpLegs(tokenId)
      const net = mintedLiquidity(tokenId, [5_000_000n])
      expect(planSfpmLpBurn(legs, net, 5_000_000n)).toEqual({
        burnSizes: [5_000_000n],
        unburnableSize: 0n,
      })
      expect(planSfpmLpBurn(legs, net, 1_000_000n)).toEqual({
        burnSizes: [1_000_000n],
        unburnableSize: 0n,
      })
    },
  )

  it.each([[range0], [range1], [range0, range1]])(
    'never over-draws a chunk when one burn of the full balance would',
    (...ranges) => {
      const tokenId = buildSfpmLpTokenId({ poolId: POOL_ID, ranges })
      const legs = decodeSfpmLpLegs(tokenId)
      const sizes = findRoundingDeficit(tokenId)
      const balance = sizes[0] + sizes[1]
      const net = mintedLiquidity(tokenId, sizes)

      const plan = planSfpmLpBurn(legs, net, balance)

      expect(plan.burnSizes[0]).toBeLessThan(balance)
      expect(plan.burnSizes.reduce((a, b) => a + b, 0n) + plan.unburnableSize).toBe(balance)
      expect(plan.unburnableSize).toBeLessThan(minSfpmLpPositionSize(legs) * 2n)
      legs.forEach((leg, i) => {
        const burned = plan.burnSizes.reduce((sum, size) => sum + sfpmLpLegLiquidity(leg, size), 0n)
        expect(burned).toBeLessThanOrEqual(net[i] ?? 0n)
      })
    },
  )

  it('burns nothing when the chunks hold no liquidity', () => {
    const tokenId = buildSfpmLpTokenId({ poolId: POOL_ID, ranges: [range0] })
    expect(planSfpmLpBurn(decodeSfpmLpLegs(tokenId), [0n], 1_000n)).toEqual({
      burnSizes: [],
      unburnableSize: 1_000n,
    })
  })
})
