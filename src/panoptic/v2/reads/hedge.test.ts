import { describe, expect, it, vi } from 'vitest'

import { getDeltaHedgeParams } from './hedge'

/**
 * Minimal mock PublicClient — getDeltaHedgeParams with currentTick+tickSpacing
 * provided never calls getPool, but still needs _meta or a blockNumber.
 */
function mockClient() {
  return {
    getBlockNumber: vi.fn().mockResolvedValue(100n),
    request: vi.fn().mockResolvedValue({
      number: '0x64',
      timestamp: '0x6601',
      hash: '0x' + 'ab'.repeat(32),
    }),
  } as never
}

const baseMeta = {
  blockNumber: 100n,
  blockTimestamp: 1000n,
  blockHash: ('0x' + 'ab'.repeat(32)) as `0x${string}`,
}

const baseParams = {
  client: mockClient(),
  poolAddress: ('0x' + '11'.repeat(20)) as `0x${string}`,
  chainId: 1n,
  targetDelta: 0n,
  currentDelta: 1000n,
  asset: 0n as const,
  currentTick: 200000n,
  tickSpacing: 10n,
  _meta: baseMeta,
}

describe('getDeltaHedgeParams', () => {
  describe('without simulation (backward compat)', () => {
    it('returns converged=true and simulationIterations=0', async () => {
      const result = await getDeltaHedgeParams(baseParams)
      expect(result.converged).toBe(true)
      expect(result.simulationIterations).toBe(0)
      expect(result.simulatedTickAfter).toBeUndefined()
      expect(result.hedgeAmount).toBe(1000n)
    })
  })

  describe('with simulation convergence', () => {
    it('converges in one iteration when price impact is small', async () => {
      const simulateSwap = vi.fn().mockResolvedValue({ tickAfter: 200001n })
      // At the post-swap tick, delta barely changes (950 instead of 1000)
      const computeDeltaAtTick = vi.fn().mockReturnValue(950n)

      const result = await getDeltaHedgeParams({
        ...baseParams,
        simulateSwap,
        computeDeltaAtTick,
        totalPositionSize: 100000n,
        convergenceThresholdBps: 100n, // 1%
      })

      expect(simulateSwap).toHaveBeenCalledTimes(1)
      expect(result.simulationIterations).toBe(1)
      expect(result.converged).toBe(true)
      expect(result.simulatedTickAfter).toBe(200001n)
      // New hedge amount = |0 - 950| = 950
      expect(result.hedgeAmount).toBe(950n)
    })

    it('iterates multiple times for large price impact', async () => {
      let callCount = 0
      const simulateSwap = vi.fn().mockImplementation(async () => {
        callCount++
        return { tickAfter: 200000n + BigInt(callCount) }
      })

      // Each iteration the delta gets closer to zero
      const deltas = [800n, 780n, 778n]
      let deltaIdx = 0
      const computeDeltaAtTick = vi.fn().mockImplementation(() => {
        return deltas[Math.min(deltaIdx++, deltas.length - 1)]
      })

      const result = await getDeltaHedgeParams({
        ...baseParams,
        simulateSwap,
        computeDeltaAtTick,
        totalPositionSize: 10000n, // smaller so bps are larger
        convergenceThresholdBps: 10n, // tight threshold
      })

      // 1st: 1000→800 (delta=200, 200*10000/10000=200bps) > 10bps
      // 2nd: 800→780 (delta=20, 20*10000/10000=20bps) > 10bps
      // 3rd: 780→778 (delta=2, 2*10000/10000=2bps) <= 10bps → converged
      expect(result.simulationIterations).toBe(3)
      expect(result.converged).toBe(true)
      expect(result.hedgeAmount).toBe(778n)
    })

    it('stops at maxSimIterations if not converged', async () => {
      const simulateSwap = vi.fn().mockResolvedValue({ tickAfter: 200010n })
      // Delta keeps changing significantly each time
      let val = 1000n
      const computeDeltaAtTick = vi.fn().mockImplementation(() => {
        val -= 50n // Large persistent shift
        return val
      })

      const result = await getDeltaHedgeParams({
        ...baseParams,
        simulateSwap,
        computeDeltaAtTick,
        totalPositionSize: 1000n, // Small total so changes are always > threshold
        convergenceThresholdBps: 1n, // Very tight
        maxSimIterations: 3,
      })

      expect(result.simulationIterations).toBe(3)
      expect(result.converged).toBe(false)
    })

    it('stops early when simulateSwap returns null', async () => {
      const simulateSwap = vi.fn().mockResolvedValue(null)
      const computeDeltaAtTick = vi.fn()

      const result = await getDeltaHedgeParams({
        ...baseParams,
        simulateSwap,
        computeDeltaAtTick,
        totalPositionSize: 100000n,
      })

      expect(result.simulationIterations).toBe(1)
      expect(result.converged).toBe(false)
      expect(result.simulatedTickAfter).toBeUndefined()
      expect(computeDeltaAtTick).not.toHaveBeenCalled()
    })

    it('throws when totalPositionSize is missing', async () => {
      await expect(
        getDeltaHedgeParams({
          ...baseParams,
          simulateSwap: vi.fn(),
          computeDeltaAtTick: vi.fn(),
        }),
      ).rejects.toThrow('totalPositionSize is required')
    })

    it('throws when totalPositionSize is 0', async () => {
      await expect(
        getDeltaHedgeParams({
          ...baseParams,
          simulateSwap: vi.fn(),
          computeDeltaAtTick: vi.fn(),
          totalPositionSize: 0n,
        }),
      ).rejects.toThrow('totalPositionSize is required')
    })
  })
})
