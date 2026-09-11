import { describe, expect, it, vi } from 'vitest'

import { calculatePositionDeltaDebtOnly, toVaultFrameAtTick } from '../greeks'
import { decodeTokenId } from '../tokenId'
import { addLegToTokenId } from '../tokenId/encoding'
import {
  accountHedgeDelta,
  buildCapacityHedge,
  findHedgeBoundary,
  hedgeMargin,
} from './hedgeCapacity'

const pack = (balance: bigint, required: bigint) => balance | (required << 128n)
const SCALE = 10_000_000n
const hedgeInput = { poolId: 1n, tick: 198213n, tickSpacing: 10n, notionalFee: 3n, swapFee: 500n }

describe('snapshot hedge capacity', () => {
  it.each([0n, 1n] as const)(
    'neutralizes both delta directions in asset %s with unequal token decimals',
    (assetIndex) => {
      const size = assetIndex === 0n ? 10_000_000_000n : 4_000_000_000_000_000_000n
      for (const delta of [size, -size]) {
        const hedge = buildCapacityHedge({ ...hedgeInput, delta, assetIndex })
        const leg = decodeTokenId(hedge.tokenId).legs[0]
        expect(leg.asset).toBe(hedge.borrowToken)
        expect(leg.tokenType).toBe(hedge.borrowToken)
        const hedgeDelta = hedge.borrowToken === assetIndex ? -hedge.amount : hedge.proceeds
        const residual = delta + hedgeDelta
        const roundingUnit =
          toVaultFrameAtTick(1n, hedge.borrowToken, assetIndex, hedgeInput.tick) + 2n
        expect(residual < 0n ? -residual : residual).toBeLessThanOrEqual(roundingUnit)
      }
    },
  )

  it.each([0n, 1n] as const)(
    'includes existing loan proceeds once and handles four legs, ratios and mixed assets (%s)',
    (assetIndex) => {
      let tokenId = 1n
      for (let index = 0n; index < 4n; index++) {
        tokenId = addLegToTokenId(tokenId, {
          index,
          asset: index % 2n,
          tokenType: index % 2n,
          isLong: index === 2n ? 1n : 0n,
          optionRatio: index + 1n,
          strike: 198210n,
          width: index < 2n ? 12n : 0n,
          riskPartner: index,
        })
      }
      const size = 1_000_000n
      const collateral = 7_000_000n
      const balance = size | (198200n << 160n)
      const result = accountHedgeDelta({
        positionIds: [tokenId],
        balances: [balance],
        collateralDelta: collateral,
        tick: 198213n,
        tickSpacing: 10n,
        assetIndex,
      })
      expect(result).toBe(
        collateral +
          calculatePositionDeltaDebtOnly({
            legs: decodeTokenId(tokenId).legs,
            positionSize: size,
            mintTick: 198200n,
            currentTick: 198213n,
            poolTickSpacing: 10n,
            assetIndex,
          }),
      )
      const loanId = addLegToTokenId(1n, {
        index: 0n,
        asset: assetIndex,
        tokenType: assetIndex,
        isLong: 0n,
        optionRatio: 1n,
        strike: 0n,
        width: 0n,
        riskPartner: 0n,
      })
      expect(
        accountHedgeDelta({
          positionIds: [loanId],
          balances: [size],
          collateralDelta: size,
          tick: 0n,
          tickSpacing: 10n,
          assetIndex,
        }),
      ).toBe(0n)
    },
  )

  it('distinguishes maintenance solvency from hedge-opening affordability', () => {
    const base = {
      tokenData: [pack(2_000n, 1_800n), 0n] as const,
      balanceChanges: [0n, 0n] as const,
      crossRatios: [SCALE, SCALE] as const,
      tick: 0n,
    }
    expect(hedgeMargin({ ...base, buffer: SCALE }).solvent).toBe(true)
    const hedged = {
      ...base,
      tokenData: [pack(2_000n, 7_300n), 0n] as const,
      balanceChanges: [0n, 5_000n] as const,
    }
    expect(hedgeMargin({ ...hedged, buffer: 10_666_667n }).solvent).toBe(false)
  })

  it.each([-198213n, 198213n])('requires both cross-collateral constraints at tick %s', (tick) => {
    const largeBalance = 10n ** 30n
    const params = {
      tokenData: [pack(largeBalance, 0n), pack(0n, 100n)] as const,
      balanceChanges: [0n, 0n] as const,
      tick,
      buffer: SCALE,
    }
    expect(hedgeMargin({ ...params, crossRatios: [SCALE, SCALE] }).solvent).toBe(true)
    expect(hedgeMargin({ ...params, crossRatios: [0n, SCALE] }).solvent).toBe(false)
  })

  it('rounds opening requirements upward and rejects unpayable token fees', () => {
    const params = {
      tokenData: [pack(1n, 1n), 0n] as const,
      balanceChanges: [0n, 0n] as const,
      crossRatios: [SCALE, SCALE] as const,
      tick: 0n,
    }
    expect(hedgeMargin({ ...params, buffer: SCALE + 1n }).solvent).toBe(false)
    expect(hedgeMargin({ ...params, buffer: SCALE, balanceChanges: [-2n, 100n] }).solvent).toBe(
      false,
    )
  })

  it('finds the first detected boundary despite later affordable regions', async () => {
    const evaluate = vi.fn(async (tick: number) => ({
      tick,
      affordable: !(tick >= 123 && tick <= 450) && tick > -321,
    }))
    const samples = await Promise.all([-500, -400, -200, 200, 400, 600].map(evaluate))
    const current = await evaluate(0)
    expect(await findHedgeBoundary(current, samples, 1, evaluate)).toBe(123)
    expect(await findHedgeBoundary(current, samples, -1, evaluate)).toBe(-321)
  })

  it('distinguishes no boundary in range from an unavailable hedge now', async () => {
    const evaluate = vi.fn(async (tick: number) => ({ tick, affordable: true }))
    expect(
      await findHedgeBoundary(
        { tick: 0, affordable: true },
        [{ tick: 400, affordable: true }],
        1,
        evaluate,
      ),
    ).toBeNull()
    expect(await findHedgeBoundary({ tick: 0, affordable: false }, [], -1, evaluate)).toBe(0)
    expect(evaluate).not.toHaveBeenCalled()
  })

  it('propagates unavailable scenario reads instead of inventing a boundary', async () => {
    await expect(
      findHedgeBoundary(
        { tick: 0, affordable: true },
        [{ tick: 400, affordable: false }],
        1,
        async () => {
          throw new Error('RPC unavailable')
        },
      ),
    ).rejects.toThrow('RPC unavailable')
  })
})
