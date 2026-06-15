import { describe, expect, it, vi } from 'vitest'

import { SwapTokenMismatchError } from '../errors'
import { simulateSwapExactIn, simulateSwapExactOut } from './simulateSwap'
import type { SimulateWithTokenFlowResult } from './tokenFlow'

vi.mock('../reads/pool', () => ({
  getPool: vi.fn().mockResolvedValue({
    poolId: 1n,
    currentTick: 200000n,
    collateralTracker0: {
      address: '0xCT0',
      token: '0xToken0',
      symbol: 'WETH',
      decimals: 18n,
      totalAssets: 0n,
      insideAMM: 0n,
      creditedShares: 0n,
      totalShares: 0n,
      utilization: 0n,
      borrowRate: 0n,
      supplyRate: 0n,
    },
    collateralTracker1: {
      address: '0xCT1',
      token: '0xToken1',
      symbol: 'USDC',
      decimals: 6n,
      totalAssets: 0n,
      insideAMM: 0n,
      creditedShares: 0n,
      totalShares: 0n,
      utilization: 0n,
      borrowRate: 0n,
      supplyRate: 0n,
    },
    poolKey: {
      currency0: '0xToken0',
      currency1: '0xToken1',
      fee: 500n,
      tickSpacing: 10n,
      hooks: '0x0000000000000000000000000000000000000000',
    },
    tickSpacing: 10n,
  }),
}))

vi.mock('../clients', () => ({
  getBlockMeta: vi.fn().mockResolvedValue({
    blockNumber: 100n,
    blockTimestamp: 1700000000n,
    blockHash: '0xblockhash',
  }),
}))

vi.mock('../tokenId/builder', () => ({
  createTokenIdBuilder: vi.fn().mockReturnValue({
    addLoan: vi.fn().mockReturnValue({
      build: vi.fn().mockReturnValue(99999n),
    }),
  }),
}))

vi.mock('./tokenFlow', () => ({
  simulateWithTokenFlow: vi.fn().mockResolvedValue({
    success: true,
    tokenFlow: {
      delta0: 500n,
      delta1: -1000n,
      balanceBefore0: 0n,
      balanceBefore1: 2000n,
      balanceAfter0: 500n,
      balanceAfter1: 1000n,
      tickBefore: 200000n,
      tickAfter: 200010n,
    },
    gasEstimate: 300000n,
  }),
}))

const mockClient = {
  getBlockNumber: vi.fn().mockResolvedValue(100n),
} as unknown as Parameters<typeof simulateSwapExactOut>[0]['client']

describe('simulateSwapExactOut', () => {
  it('should return successful simulation for token0 output', async () => {
    const result = await simulateSwapExactOut({
      client: mockClient,
      poolAddress: '0xPool' as `0x${string}`,
      account: '0xUser' as `0x${string}`,
      chainId: 1n,
      tokenOut: '0xToken0' as `0x${string}`,
      amountOut: 500n,
      slippageBps: 500n,
      existingPositionIds: [],
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.amountOut).toBe(500n)
      expect(result.data.amountIn).toBe(1000n)
      expect(result.gasEstimate).toBe(300000n)
      expect(result._meta.blockNumber).toBe(100n)
    }
  })

  it('should return error for token mismatch', async () => {
    const result = await simulateSwapExactOut({
      client: mockClient,
      poolAddress: '0xPool' as `0x${string}`,
      account: '0xUser' as `0x${string}`,
      chainId: 1n,
      tokenOut: '0xBadToken' as `0x${string}`,
      amountOut: 500n,
      slippageBps: 500n,
      existingPositionIds: [],
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toBeInstanceOf(SwapTokenMismatchError)
    }
  })

  it('should handle simulation failure gracefully', async () => {
    const { simulateWithTokenFlow } = await import('./tokenFlow')
    const failureResult: SimulateWithTokenFlowResult = {
      success: false,
      error: 'Revert: insufficient liquidity',
      gasEstimate: 0n,
    }
    vi.mocked(simulateWithTokenFlow).mockResolvedValueOnce(failureResult)

    const result = await simulateSwapExactOut({
      client: mockClient,
      poolAddress: '0xPool' as `0x${string}`,
      account: '0xUser' as `0x${string}`,
      chainId: 1n,
      tokenOut: '0xToken0' as `0x${string}`,
      amountOut: 500n,
      slippageBps: 500n,
      existingPositionIds: [],
    })

    expect(result.success).toBe(false)
  })
})

describe('simulateSwapExactIn', () => {
  it('should return successful simulation for token1 input', async () => {
    const result = await simulateSwapExactIn({
      client: mockClient,
      poolAddress: '0xPool' as `0x${string}`,
      account: '0xUser' as `0x${string}`,
      chainId: 1n,
      tokenIn: '0xToken1' as `0x${string}`,
      amountIn: 1000n,
      slippageBps: 500n,
      existingPositionIds: [],
    })

    expect(result.success).toBe(true)
    if (result.success) {
      // tokenIn=token1, tokenOut=token0 (index 0)
      expect(result.data.amountOut).toBe(500n)
      expect(result.data.amountIn).toBe(1000n)
      expect(result.gasEstimate).toBe(300000n)
    }
  })

  it('should return error for token mismatch', async () => {
    const result = await simulateSwapExactIn({
      client: mockClient,
      poolAddress: '0xPool' as `0x${string}`,
      account: '0xUser' as `0x${string}`,
      chainId: 1n,
      tokenIn: '0xUnknown' as `0x${string}`,
      amountIn: 1000n,
      slippageBps: 500n,
      existingPositionIds: [],
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toBeInstanceOf(SwapTokenMismatchError)
    }
  })

  it('should surface simulation failure', async () => {
    const { simulateWithTokenFlow } = await import('./tokenFlow')
    const failureResult: SimulateWithTokenFlowResult = {
      success: false,
      error: 'Revert: insufficient liquidity',
      gasEstimate: 0n,
    }
    vi.mocked(simulateWithTokenFlow).mockResolvedValueOnce(failureResult)

    const result = await simulateSwapExactIn({
      client: mockClient,
      poolAddress: '0xPool' as `0x${string}`,
      account: '0xUser' as `0x${string}`,
      chainId: 1n,
      tokenIn: '0xToken1' as `0x${string}`,
      amountIn: 1000n,
      slippageBps: 500n,
      existingPositionIds: [],
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.message).toContain('insufficient liquidity')
    }
  })
})
