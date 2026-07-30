/**
 * Unit tests for the SFPM swap plan builder.
 * @module v2/sfpmSwap/plan.test
 */
import { describe, expect, it } from 'vitest'

import { buildSfpmSwapCalldata } from './calldata'
import { buildSfpmSwapPlan, slippageBpsToTickDistance } from './plan'
import type { SfpmSwapPlanParams } from './types'

const SFPM = '0x000000000000031d296bBA22f188472157eEb01f' as const
const POOL = '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640' as const
// poolId resolved on the fork for the mainnet 5bps USDC/WETH pool (vegoid 4).
const POOL_ID = 0xa0488e6a0c2ddn

const base: SfpmSwapPlanParams = {
  sfpmAddress: SFPM,
  poolAddress: POOL,
  poolId: POOL_ID,
  kind: 'exactIn',
  zeroForOne: true,
  amount: 1000n * 10n ** 6n,
  currentTick: 201042,
  slippageBps: 50n,
}

describe('slippageBpsToTickDistance', () => {
  it('is zero at zero slippage and grows monotonically', () => {
    expect(slippageBpsToTickDistance(0n)).toBe(0n)
    expect(slippageBpsToTickDistance(1n)).toBeGreaterThanOrEqual(1n)
    expect(slippageBpsToTickDistance(100n)).toBeGreaterThan(slippageBpsToTickDistance(50n))
  })

  it('rejects out-of-bounds tolerances', () => {
    expect(() => slippageBpsToTickDistance(-1n)).toThrow()
    expect(() => slippageBpsToTickDistance(1001n)).toThrow()
  })
})

describe('buildSfpmSwapPlan', () => {
  it('exactIn zeroForOne swaps on mint with an inverted band; token0 loan tokenId', () => {
    const plan = buildSfpmSwapPlan(base)
    expect(plan.swapOn).toBe('mint')
    // tokenId low 64 bits == poolId; single token0 loan leg (matches the fork golden).
    expect(plan.tokenId).toBe(0x2000a0488e6a0c2ddn)
    expect(plan.tokenId & ((1n << 64n) - 1n)).toBe(POOL_ID)
    // mint (swap) band is inverted (low > high); burn band is wide & non-inverted.
    expect(plan.mintTickLimits[0]).toBeGreaterThan(plan.mintTickLimits[1])
    expect(plan.burnTickLimits[0]).toBeLessThan(plan.burnTickLimits[1])
    expect(plan.positionSize).toBe(base.amount)
  })

  it('exactIn !zeroForOne uses a token1 loan leg', () => {
    const plan = buildSfpmSwapPlan({ ...base, zeroForOne: false })
    // token1 leg sets tokenType/asset bits; differs from the token0 golden.
    expect(plan.tokenId).not.toBe(0x2000a0488e6a0c2ddn)
    expect(plan.swapOn).toBe('mint')
  })

  it('exactOut swaps on burn', () => {
    const plan = buildSfpmSwapPlan({ ...base, kind: 'exactOut' })
    expect(plan.swapOn).toBe('burn')
    expect(plan.burnTickLimits[0]).toBeGreaterThan(plan.burnTickLimits[1])
    expect(plan.mintTickLimits[0]).toBeLessThan(plan.mintTickLimits[1])
  })

  it('rejects a zero-width band (slippage too small)', () => {
    expect(() => buildSfpmSwapPlan({ ...base, slippageBps: 0n })).toThrow()
  })

  it('rejects a non-positive amount', () => {
    expect(() => buildSfpmSwapPlan({ ...base, amount: 0n })).toThrow()
  })

  it('centers the inverted band on the current tick', () => {
    const plan = buildSfpmSwapPlan(base)
    const d = Number(slippageBpsToTickDistance(base.slippageBps))
    expect(plan.mintTickLimits).toEqual([base.currentTick + d, base.currentTick - d])
  })
})

describe('buildSfpmSwapCalldata', () => {
  it('encodes a multicall of exactly [mint, burn]', () => {
    const plan = buildSfpmSwapPlan(base)
    const { multicallData, mintData, burnData } = buildSfpmSwapCalldata(plan)
    // multicall(bytes[]) selector
    expect(multicallData.slice(0, 10)).toBe('0xac9650d8')
    // mint / burn selectors differ and both appear inside the multicall blob
    expect(mintData.slice(0, 10)).not.toBe(burnData.slice(0, 10))
    expect(multicallData.includes(mintData.slice(2))).toBe(true)
    expect(multicallData.includes(burnData.slice(2))).toBe(true)
  })
})
