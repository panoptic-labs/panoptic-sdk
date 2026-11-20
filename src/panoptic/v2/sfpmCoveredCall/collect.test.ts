import { type PublicClient, decodeFunctionData } from 'viem'
import { describe, expect, it } from 'vitest'

import { semiFungiblePositionManagerV3Abi as sfpmV3Abi } from '../../../generated'
import { tickToSqrtPriceX96 } from '../formatters/tick'
import {
  buildSfpmLpTokenId,
  decodeSfpmLpLegs,
  minSfpmLpPositionSize,
  sfpmLpLegLiquidity,
} from '../sfpmLp'
import { planSfpmCoveredCallCollect } from './collect'

// tickSpacing 10, vegoid 4.
const POOL_ID = 0xa0488e6a0c2ddn
const tokenId = buildSfpmLpTokenId({
  poolId: POOL_ID,
  ranges: [{ tickLower: 200_000n, tickUpper: 200_100n, asset: 0n }],
})
const Q96 = 1n << 96n

function fakeClient(): PublicClient {
  type Call = { functionName: string; args: readonly unknown[] }
  const answer = (call: Call) => {
    switch (call.functionName) {
      case 'balanceOf':
        return 5n
      case 'getCurrentTick':
        return 200_050
      case 'getAccountLiquidity':
        return 10n ** 18n
      case 'getAccountPremium':
        return [0n, 0n] as const
      default:
        throw new Error(`unexpected ${call.functionName}`)
    }
  }
  return {
    getBlock: async () => ({ number: 1n, hash: '0x01', timestamp: 1n }),
    multicall: async ({ contracts }: { contracts: Call[] }) => contracts.map(answer),
    readContract: async (call: Call) => answer(call),
  } as unknown as PublicClient
}

describe('planSfpmCoveredCallCollect', () => {
  it('mints then burns the minimum size, and caps what the mint can pull', async () => {
    const plan = await planSfpmCoveredCallCollect({
      client: fakeClient(),
      sfpmAddress: '0x00000000000005E4693aDc8Ec0f12D686f728198',
      poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
      account: '0x000000000000000000000000000000000000dEaD',
      tokenId,
      slippageBps: 30n,
    })
    const legs = decodeSfpmLpLegs(tokenId)
    const size = minSfpmLpPositionSize(legs)
    const steps = plan.calls.map((data) => decodeFunctionData({ abi: sfpmV3Abi, data }))
    expect(steps.map((step) => step.functionName)).toEqual([
      'mintTokenizedPosition',
      'burnTokenizedPosition',
    ])
    for (const step of steps) {
      expect(step.args?.[1]).toBe(tokenId)
      expect(step.args?.[2]).toBe(size)
      expect(Number(step.args?.[3])).toBeLessThan(200_050)
      expect(Number(step.args?.[4])).toBeGreaterThan(200_050)
    }
    // Uniswap's one-sided mint amounts (rounded up) must fit under the caps.
    const [leg] = legs
    if (!leg) throw new Error('no leg')
    const liquidity = sfpmLpLegLiquidity(leg, size)
    const a = tickToSqrtPriceX96(leg.tickLower)
    const b = tickToSqrtPriceX96(leg.tickUpper)
    const amount0 = (liquidity * Q96 * (b - a) + a * b - 1n) / (a * b)
    const amount1 = (liquidity * (b - a) + Q96 - 1n) / Q96
    expect(plan.maxIn0).toBeGreaterThanOrEqual(amount0)
    expect(plan.maxIn1).toBeGreaterThanOrEqual(amount1)
    expect(plan.maxIn0).toBeLessThan(amount0 + 3n)
  })
})
