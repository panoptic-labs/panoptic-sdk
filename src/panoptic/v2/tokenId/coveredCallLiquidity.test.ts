import { describe, expect, it } from 'vitest'

import {
  buildEarnCoveredCallTokenId,
  computeLoanStrikeForNotional,
  getCoveredCallAdvance,
  getEarnCoveredCallLiquidity,
} from './coveredCall'

function setup(assetIdx: 0n | 1n) {
  const positionSize = 2n * 10n ** 15n
  const strike = assetIdx === 0n ? -210280n : 210280n
  const loanStrike = computeLoanStrikeForNotional({
    positionSize,
    targetNotional: 120000n,
    assetIdx,
  })
  if (loanStrike === undefined) throw new Error('Missing loan strike')
  const tokenId = buildEarnCoveredCallTokenId({
    poolId: 5n << 48n,
    assetIdx,
    strike,
    width: 72n,
    loanStrike,
  })
  const base = { totalAssets: 10n ** 18n, insideAMM: 0n, symbol: 'SPY', decimals: 18n }
  const quote = { totalAssets: 1n, insideAMM: 0n, symbol: 'USDG', decimals: 6n }
  const pool = {
    currentTick: assetIdx === 0n ? -210281n : 210281n,
    tickSpacing: 5n,
    collateralTracker0: assetIdx === 0n ? base : quote,
    collateralTracker1: assetIdx === 0n ? quote : base,
  }
  return { pool, tokenId, positionSize, quote, loanStrike }
}

describe('Earn covered-call quote liquidity', () => {
  it.each([0n, 1n] as const)('requires LP funding and the advance with asset %s', (assetIdx) => {
    const input = setup(assetIdx)
    const funding = getEarnCoveredCallLiquidity(input)
    expect(funding.symbol).toBe('USDG')
    expect(funding.decimals).toBe(6n)
    expect(funding.availableQuote).toBe(0n)
    expect(funding.requiredQuote).toBeGreaterThan(
      getCoveredCallAdvance(input.positionSize, input.loanStrike, assetIdx),
    )
    expect(funding.shortfall).toBe(funding.requiredQuote)
  })

  it.each([0n, 1n] as const)(
    'excludes deployed liquidity and the virtual asset with asset %s',
    (assetIdx) => {
      const input = setup(assetIdx)
      const required = getEarnCoveredCallLiquidity(input).requiredQuote
      input.quote.insideAMM = 3000000n
      input.quote.totalAssets = input.quote.insideAMM + required + 1n
      expect(getEarnCoveredCallLiquidity(input)).toMatchObject({
        availableQuote: required,
        shortfall: 0n,
      })
      input.quote.totalAssets -= 1n
      expect(getEarnCoveredCallLiquidity(input).shortfall).toBe(1n)
    },
  )

  it('preserves equivalent requirements when pool token order is reversed', () => {
    const forward = getEarnCoveredCallLiquidity(setup(0n))
    const reverse = getEarnCoveredCallLiquidity(setup(1n))
    const difference = forward.requiredQuote - reverse.requiredQuote
    expect(difference >= -2n && difference <= 2n).toBe(true)
  })

  it('rejects missing strategies and zero position sizes', () => {
    const input = setup(0n)
    expect(() => getEarnCoveredCallLiquidity({ ...input, tokenId: 0n })).toThrow(RangeError)
    expect(() => getEarnCoveredCallLiquidity({ ...input, positionSize: 0n })).toThrow(RangeError)
  })
})
