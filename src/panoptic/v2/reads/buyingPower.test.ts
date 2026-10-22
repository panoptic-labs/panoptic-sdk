import type { Hex } from 'viem'
import { decodeFunctionData, encodeFunctionResult } from 'viem'
import { describe, expect, it } from 'vitest'

import { Multicall3Abi } from '../../../abis/multicall3'
import { collateralTrackerV2Abi, panopticPoolV2Abi } from '../../../generated'
import { applyOwedInterest, getAccountBuyingPower } from './buyingPower'
import { isLiquidatable } from './checks'

const POOL = '0x1000000000000000000000000000000000000001' as const
const CT0 = '0x2000000000000000000000000000000000000002' as const
const CT1 = '0x3000000000000000000000000000000000000003' as const
const ACCOUNT = '0x4000000000000000000000000000000000000004' as const
const TOKEN_ID = 77n

/** Pack a per-position requirement as LeftRightUnsigned: right = token0, left = token1. */
const packRequirement = (req0: bigint, req1: bigint): bigint => (req1 << 128n) | req0

interface AccountState {
  assets0: bigint
  interest0: bigint
  assets1: bigint
  interest1: bigint
  req0: bigint
  req1: bigint
}

/** Fake client answering Multicall3.blockAndAggregate at tick 0 (price 1, so frames are identity). */
function clientFor(state: AccountState) {
  return {
    call: async ({ data }: { to: string; data: Hex; blockNumber?: bigint }) => {
      const decoded = decodeFunctionData({ abi: Multicall3Abi, data })
      if (decoded.functionName !== 'blockAndAggregate') throw new Error('unexpected call')
      const calls = decoded.args[0] as readonly { target: string; callData: Hex }[]
      const results = calls.map((c) => ({ success: true, returnData: answer(state, c) }))
      return {
        data: encodeFunctionResult({
          abi: Multicall3Abi,
          functionName: 'blockAndAggregate',
          result: [12345n, `0x${'ab'.repeat(32)}`, results],
        }),
      }
    },
  }
}

function answer(state: AccountState, c: { target: string; callData: Hex }): Hex {
  try {
    const inner = decodeFunctionData({ abi: Multicall3Abi, data: c.callData })
    if (inner.functionName === 'getCurrentBlockTimestamp') {
      return encodeFunctionResult({
        abi: Multicall3Abi,
        functionName: 'getCurrentBlockTimestamp',
        result: 1_700_000_000n,
      })
    }
  } catch {
    /* not a multicall3 call */
  }
  try {
    const inner = decodeFunctionData({ abi: panopticPoolV2Abi, data: c.callData })
    if (inner.functionName === 'getCurrentTick') {
      return encodeFunctionResult({
        abi: panopticPoolV2Abi,
        functionName: 'getCurrentTick',
        result: 0,
      })
    }
    if (inner.functionName === 'getFullPositionsData') {
      return encodeFunctionResult({
        abi: panopticPoolV2Abi,
        functionName: 'getFullPositionsData',
        result: [0n, 0n, [0n], [packRequirement(state.req0, state.req1)], [0n]],
      })
    }
  } catch {
    /* not a pool call */
  }
  const inner = decodeFunctionData({ abi: collateralTrackerV2Abi, data: c.callData })
  if (inner.functionName === 'assetsAndInterest') {
    const isToken0 = c.target.toLowerCase() === CT0.toLowerCase()
    return encodeFunctionResult({
      abi: collateralTrackerV2Abi,
      functionName: 'assetsAndInterest',
      result: isToken0 ? [state.assets0, state.interest0] : [state.assets1, state.interest1],
    })
  }
  throw new Error(`unexpected call ${inner.functionName}`)
}

const read = (state: AccountState) =>
  getAccountBuyingPower({
    client: clientFor(state) as never,
    poolAddress: POOL,
    account: ACCOUNT,
    tokenIds: [TOKEN_ID],
    collateralAddresses: { collateralToken0: CT0, collateralToken1: CT1 },
  })

const check = (state: AccountState) =>
  isLiquidatable({
    client: clientFor(state) as never,
    poolAddress: POOL,
    account: ACCOUNT,
    tokenIds: [TOKEN_ID],
    collateralAddresses: { collateralToken0: CT0, collateralToken1: CT1 },
    blockNumber: 12345n,
  })

describe('applyOwedInterest', () => {
  it('deducts payable interest from the balance', () => {
    expect(applyOwedInterest(1_000n, 300n)).toEqual({ balance: 700n, requirementExtra: 0n })
  })
  it('zeroes the balance and carries the remainder into the requirement', () => {
    expect(applyOwedInterest(100n, 300n)).toEqual({ balance: 0n, requirementExtra: 200n })
  })
  it('treats interest equal to the balance as fully payable', () => {
    expect(applyOwedInterest(300n, 300n)).toEqual({ balance: 0n, requirementExtra: 0n })
  })
})

describe('getAccountBuyingPower owed interest', () => {
  // Token0 is the borrowed (interest) token; token1 holds the collateral.
  const base: AccountState = {
    assets0: 0n,
    interest0: 0n,
    assets1: 10_000n,
    interest1: 0n,
    req0: 4_000n,
    req1: 0n,
  }

  it('leaves an account with no borrows unchanged', async () => {
    const bp = await read(base)
    expect(bp.collateralBalance0).toBe(10_000n)
    expect(bp.requiredCollateral0).toBe(4_000n)
    expect(bp.collateralBalance1).toBe(10_000n)
    expect(bp.requiredCollateral1).toBe(4_000n)
  })

  it('reduces the balance by interest below it and leaves the requirement alone', async () => {
    const bp = await read({ ...base, assets0: 1_000n, interest0: 300n })
    expect(bp.collateralBalance0).toBe(10_000n + 700n)
    expect(bp.requiredCollateral0).toBe(4_000n)
  })

  it('raises the requirement by the full interest when the interest token balance is zero', async () => {
    const bp = await read({ ...base, assets0: 0n, interest0: 300n })
    expect(bp.collateralBalance0).toBe(10_000n)
    expect(bp.requiredCollateral0).toBe(4_300n)
    // The token1 frame sees the same remainder through cross-conversion.
    expect(bp.requiredCollateral1).toBe(4_300n)
  })

  it('raises the requirement by interest minus dust when the balance is below the interest', async () => {
    const bp = await read({ ...base, assets0: 50n, interest0: 300n })
    expect(bp.collateralBalance0).toBe(10_000n)
    expect(bp.requiredCollateral0).toBe(4_250n)
  })

  it('applies interest per token independently', async () => {
    const bp = await read({
      assets0: 50n,
      interest0: 300n,
      assets1: 10_000n,
      interest1: 1_000n,
      req0: 4_000n,
      req1: 500n,
    })
    // token0: balance 0, +250 requirement. token1: balance 9000, requirement 500.
    expect(bp.collateralBalance0).toBe(9_000n)
    expect(bp.requiredCollateral0).toBe(4_250n + 500n)
  })
})

describe('isLiquidatable owed interest', () => {
  it('flags an account whose uncollected interest exceeds its spare collateral', async () => {
    // assetsOf arithmetic: 10_000 collateral vs 9_900 requirement → solvent.
    // Engine arithmetic: 300 of interest, 0 payable → requirement 10_200 → insolvent.
    const result = await check({
      assets0: 0n,
      interest0: 300n,
      assets1: 10_000n,
      interest1: 0n,
      req0: 9_900n,
      req1: 0n,
    })
    expect(result.requiredMargin0).toBe(10_200n)
    expect(result.currentMargin0).toBe(10_000n)
    expect(result.marginShortfall0).toBe(200n)
    expect(result.isLiquidatable).toBe(true)
  })

  it('stays solvent when the interest token balance covers the interest', async () => {
    const result = await check({
      assets0: 500n,
      interest0: 300n,
      assets1: 10_000n,
      interest1: 0n,
      req0: 9_900n,
      req1: 0n,
    })
    expect(result.currentMargin0).toBe(10_200n)
    expect(result.requiredMargin0).toBe(9_900n)
    expect(result.isLiquidatable).toBe(false)
  })
})
