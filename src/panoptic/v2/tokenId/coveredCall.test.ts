import { describe, expect, it } from 'vitest'

import { getAmountsForLiquidity } from '../../../uniswap/lpGreeks'
import { tickToSqrtPriceX96 } from '../formatters/tick'
import { getLegTokenInventory } from '../greeks/legLiquidity'
import { getPositionMintFunding } from '../reads/positionMintFunding'
import { createTokenIdBuilder } from './builder'
import {
  buildCoveredCallPositions,
  buildCoveredCallTokenId,
  buildEarnCoveredCallTokenId,
  buildUpfrontCoveredCallTokenId,
  computeLoanStrikeForNotional,
  estimateCoveredCallPremium,
  getCoveredCallAdvance,
  getCoveredCallOutcome,
  isCoveredCallTokenId,
  isEarnCoveredCallTokenId,
  isUpfrontCoveredCallTokenId,
} from './coveredCall'
import { decodeTokenId } from './decode'

const Q96 = 1n << 96n

describe('covered call economics', () => {
  it.each([0n, 1n] as const)(
    'matches LP inventory and full conversion for asset %s',
    (assetIdx) => {
      const sign = assetIdx === 0n ? 1n : -1n
      const args = {
        assetIdx,
        positionSize: 25n * 10n ** 18n,
        strike: sign * -200000n,
        width: 240n,
        tickSpacing: 10n,
      }
      const before = getCoveredCallOutcome({ ...args, atTick: args.strike - sign * 2000n })
      const after = getCoveredCallOutcome({ ...args, atTick: args.strike + sign * 2000n })
      expect(before.base).toBeGreaterThanOrEqual(args.positionSize - 2n)
      expect(before.quote).toBe(0n)
      expect(after.base).toBeGreaterThanOrEqual(0n)
      expect(after.base * 10n ** 12n).toBeLessThan(args.positionSize)
      expect(after.quote).toBeGreaterThan(0n)
      const middle = getCoveredCallOutcome({ ...args, atTick: args.strike })
      const lp = getAmountsForLiquidity(
        tickToSqrtPriceX96(args.strike),
        middle.sqrtLower,
        middle.sqrtUpper,
        middle.liquidity,
      )
      expect(middle.quote).toBe(assetIdx === 0n ? lp.amount1 : lp.amount0)
      const moved =
        assetIdx === 0n
          ? (middle.liquidity * Q96 * (middle.sqrtUpper - middle.sqrtLower) +
              middle.sqrtUpper * middle.sqrtLower -
              1n) /
            (middle.sqrtUpper * middle.sqrtLower)
          : (middle.liquidity * (middle.sqrtUpper - middle.sqrtLower) + Q96 - 1n) / Q96
      expect(middle.base).toBe(
        args.positionSize - moved + (assetIdx === 0n ? lp.amount0 : lp.amount1),
      )
      expect(middle.base).toBeGreaterThan(0n)
      expect(middle.base).toBeLessThan(args.positionSize)
      const boundary = getCoveredCallOutcome({
        ...args,
        atTick: assetIdx === 0n ? middle.upperTick : middle.lowerTick,
      })
      expect(boundary.quote).toBe(after.quote)
    },
  )

  it.each([0n, 1n] as const)(
    'preserves three-leg economics, repayment and mixed frames for asset %s',
    (assetIdx) => {
      const args = {
        positionSize: 10n ** 24n,
        assetIdx,
        strike: assetIdx === 0n ? -200000n : 200000n,
        width: 240n,
        tickSpacing: 10n,
      }
      const loanStrike = computeLoanStrikeForNotional({ ...args, targetNotional: 200n * 10n ** 6n })
      expect(loanStrike).toBeDefined()
      if (loanStrike === undefined) throw new Error('Missing loan')
      const advance = getCoveredCallAdvance(args.positionSize, loanStrike, assetIdx)
      expect(advance).toBeGreaterThan(199n * 10n ** 6n)
      expect(advance).toBeLessThan(201n * 10n ** 6n)
      const poolId = 10n << 48n
      const tokenId = buildCoveredCallTokenId({ ...args, poolId, loanStrike })
      const decoded = decodeTokenId(tokenId)
      expect(decoded.legs).toHaveLength(3)
      const atTick = args.strike
      const result = getCoveredCallOutcome({ ...args, atTick, outstandingAdvance: advance })
      const nonzeroLegs = decoded.legs.filter((leg) => leg.width > 0n)
      const baseInventory = nonzeroLegs.reduce(
        (sum, leg) =>
          sum + getLegTokenInventory(leg, atTick, args.positionSize, args.tickSpacing, assetIdx),
        args.positionSize,
      )
      expect(result.base).toBe(baseInventory)
      expect(result.netQuote).toBe(result.quote - advance)
      const below = getCoveredCallOutcome({
        ...args,
        atTick: args.strike - (assetIdx === 0n ? 2000n : -2000n),
        outstandingAdvance: advance,
      })
      expect(below.repayment).toBe(advance)
      expect(below.netQuote).toBe(-advance)
    },
  )

  it('mirrors premium and inventory when token ordering is reversed', () => {
    const args = {
      positionSize: 10n ** 18n,
      width: 241n,
      tickSpacing: 10n,
      currentTick: -200000n,
      strike: -199800n,
    }
    const normal = estimateCoveredCallPremium({ ...args, assetIdx: 0n })
    const inverse = estimateCoveredCallPremium({
      ...args,
      currentTick: -args.currentTick,
      strike: -args.strike,
      assetIdx: 1n,
    })
    expect(normal).toBe(inverse)
    expect(normal).toBeGreaterThan(0n)
  })

  it.each([0n, 1n] as const)(
    'identifies covered calls including standalone short calls but excluding leveraged credits for asset %s',
    (assetIdx) => {
      const args = { poolId: 10n << 48n, assetIdx, strike: 0n, width: 240n, loanStrike: -100n }
      expect(isCoveredCallTokenId(buildCoveredCallTokenId(args))).toBe(true)
      const standalone = createTokenIdBuilder(args.poolId)
        .addCall({ asset: assetIdx, optionRatio: 1n, isLong: false, strike: 0n, width: 240n })
        .build()
      expect(isCoveredCallTokenId(standalone)).toBe(true)
      const mismatched = createTokenIdBuilder(args.poolId)
        .addCall({ asset: assetIdx, optionRatio: 1n, isLong: false, strike: 0n, width: 240n })
        .addCredit({ asset: assetIdx, tokenType: assetIdx, strike: 0n, optionRatio: 2n })
        .addLoan({ asset: assetIdx, tokenType: assetIdx === 0n ? 1n : 0n, strike: -100n })
        .build()
      expect(isCoveredCallTokenId(mismatched)).toBe(false)
    },
  )

  it('handles invalid inputs and zero amounts', () => {
    expect(
      computeLoanStrikeForNotional({ positionSize: 0n, targetNotional: 1n, assetIdx: 0n }),
    ).toBeUndefined()
    expect(() =>
      getCoveredCallOutcome({
        positionSize: -1n,
        assetIdx: 0n,
        strike: 0n,
        width: 10n,
        tickSpacing: 10n,
        atTick: 0n,
      }),
    ).toThrow(RangeError)
    const zero = getCoveredCallOutcome({
      positionSize: 0n,
      assetIdx: 0n,
      strike: 0n,
      width: 1n,
      tickSpacing: 1n,
      atTick: 0n,
    })
    expect(zero.base).toBe(0n)
    expect(zero.quote).toBe(0n)
  })
})

it.each([0n, 1n] as const)(
  'builds an unlevered short call and a separate quote loan for asset %s',
  (assetIdx) => {
    const size = 10n ** 18n
    const loanStrike = computeLoanStrikeForNotional({
      positionSize: size,
      targetNotional: 1_000_000n,
      assetIdx,
    })
    if (loanStrike === undefined) throw new Error('Missing strike')
    const { tokenId, loanTokenId } = buildCoveredCallPositions({
      poolId: 10n << 48n,
      assetIdx,
      strike: assetIdx === 0n ? -200000n : 200000n,
      width: 240n,
      loanStrike,
    })
    const call = decodeTokenId(tokenId).legs
    const loan = decodeTokenId(loanTokenId).legs
    expect(call).toHaveLength(1)
    expect(loan).toHaveLength(1)
    expect(call[0]).toMatchObject({
      asset: assetIdx,
      tokenType: assetIdx,
      isLong: false,
      width: 240n,
      optionRatio: 1n,
    })
    expect(loan[0]).toMatchObject({
      asset: assetIdx,
      tokenType: assetIdx === 0n ? 1n : 0n,
      isLong: false,
      width: 0n,
      optionRatio: 1n,
    })
    expect(isCoveredCallTokenId(tokenId)).toBe(true)
    expect(isCoveredCallTokenId(loanTokenId)).toBe(false)
    expect(getCoveredCallAdvance(size, loanStrike, assetIdx)).toBeLessThanOrEqual(1_000_000n)
  },
)

it.each([0n, 1n] as const)(
  'builds one Earn call-plus-quote-loan position for asset %s',
  (assetIdx) => {
    const args = { poolId: 10n << 48n, assetIdx, strike: 100n, width: 240n, loanStrike: -100n }
    const id = buildEarnCoveredCallTokenId(args)
    const { legs } = decodeTokenId(id)
    expect(legs).toHaveLength(2)
    expect(legs[0]).toMatchObject({
      asset: assetIdx,
      tokenType: assetIdx,
      isLong: false,
      width: 240n,
      optionRatio: 1n,
    })
    expect(legs[1]).toMatchObject({
      asset: assetIdx,
      tokenType: assetIdx === 0n ? 1n : 0n,
      isLong: false,
      width: 0n,
      optionRatio: 1n,
    })
    expect(isEarnCoveredCallTokenId(id)).toBe(true)
    expect(isCoveredCallTokenId(id)).toBe(true)
    expect(isEarnCoveredCallTokenId(buildCoveredCallPositions(args).tokenId)).toBe(false)
    expect(isEarnCoveredCallTokenId(buildCoveredCallTokenId(args))).toBe(false)
    const mismatched = createTokenIdBuilder(args.poolId)
      .addCall({
        asset: assetIdx,
        optionRatio: 1n,
        isLong: false,
        strike: args.strike,
        width: args.width,
      })
      .addLoan({ asset: assetIdx, tokenType: assetIdx, strike: args.loanStrike })
      .build()
    expect(isEarnCoveredCallTokenId(mismatched)).toBe(false)
  },
)

describe('upfront covered call', () => {
  const size = 10n ** 18n
  const market = (assetIdx: 0n | 1n) => {
    const sign = assetIdx === 0n ? 1n : -1n
    return {
      poolId: 0x000a0888e6a0c2ddn,
      assetIdx,
      strike: sign * -199710n,
      width: 240n,
      tickSpacing: 10n,
      sign,
    }
  }
  const mintFlows = (tokenId: bigint, tick: bigint) => {
    const sqrtPriceX96 = tickToSqrtPriceX96(tick)
    return getPositionMintFunding({
      tokenId,
      positionSize: size,
      sqrtPriceX96,
      valuationSqrtPriceX96: sqrtPriceX96,
      swapAtMint: true,
      commissionRate: 0n,
      swapFee: 0n,
      slippageBps: 0n,
      required0: 0n,
      required1: 0n,
    })
  }

  it.each([
    [0n, 0n],
    [0n, 800n],
    [0n, 2000n],
    [1n, 0n],
    [1n, 800n],
    [1n, 2000n],
  ] as const)(
    'mints flow-neutral with a swap for asset %s, %s ticks in the money',
    (assetIdx, depth) => {
      const { sign, ...args } = market(assetIdx)
      const currentTick = args.strike + sign * depth
      const built = buildUpfrontCoveredCallTokenId({ ...args, positionSize: size, currentTick })
      const { paid0, paid1 } = mintFlows(built.tokenId, currentTick)
      const [paidAsset, paidQuote] = assetIdx === 0n ? [paid0, paid1] : [paid1, paid0]

      expect(isUpfrontCoveredCallTokenId(built.tokenId)).toBe(true)
      expect(built.upfrontQuote).toBeGreaterThan(0n)
      expect(paidQuote).toBe(0n)
      expect(paidAsset).toBeLessThanOrEqual(0n)
      expect(-paidAsset * 10_000n).toBeLessThan(size)
    },
  )

  it.each([0n, 1n] as const)('rejects an out-of-the-money mint for asset %s', (assetIdx) => {
    const { sign, ...args } = market(assetIdx)
    expect(() =>
      buildUpfrontCoveredCallTokenId({
        ...args,
        positionSize: size,
        currentTick: args.strike - sign * 2000n,
      }),
    ).toThrow(RangeError)
  })

  it.each([0n, 1n] as const)('counts as a covered call for asset %s', (assetIdx) => {
    const { sign, ...args } = market(assetIdx)
    const built = buildUpfrontCoveredCallTokenId({
      ...args,
      positionSize: size,
      currentTick: args.strike + sign * 800n,
    })
    expect(isCoveredCallTokenId(built.tokenId)).toBe(true)
  })

  it('is distinct from the other covered call shapes', () => {
    const { sign: _sign, ...args } = market(1n)
    expect(
      isUpfrontCoveredCallTokenId(buildEarnCoveredCallTokenId({ ...args, loanStrike: 199930n })),
    ).toBe(false)
    expect(
      isUpfrontCoveredCallTokenId(buildCoveredCallTokenId({ ...args, loanStrike: 199930n })),
    ).toBe(false)
  })
})
