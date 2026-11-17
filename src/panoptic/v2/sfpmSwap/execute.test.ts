/**
 * Unit tests for the SFPM swap execution wrapper.
 * @module v2/sfpmSwap/execute.test
 */
import type { Hex, PublicClient, WalletClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { buildSfpmSwapCalldata } from './calldata'
import { executeSfpmSwap } from './execute'
import { buildSfpmSwapPlan } from './plan'

const SFPM = '0x000000000000031d296bBA22f188472157eEb01f' as const
const POOL = '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640' as const
const ACCOUNT = '0x3333333333333333333333333333333333333333' as const
const TX_HASH: Hex = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'

describe('executeSfpmSwap', () => {
  it.each([
    ['exactIn', true],
    ['exactIn', false],
    ['exactOut', true],
    ['exactOut', false],
  ] as const)(
    'sends %s (zeroForOne=%s) as one atomic [mint, burn] multicall',
    async (kind, zeroForOne) => {
      const plan = buildSfpmSwapPlan({
        sfpmAddress: SFPM,
        poolAddress: POOL,
        poolId: 0xa0488e6a0c2ddn,
        kind,
        zeroForOne,
        amount: 1_000_000n,
        currentTick: 201_042,
        slippageBps: 50n,
      })
      const writeContract = vi.fn().mockResolvedValue(TX_HASH)

      const result = await executeSfpmSwap({
        client: {
          estimateContractGas: vi.fn().mockResolvedValue(500_000n),
        } as unknown as PublicClient,
        walletClient: { writeContract } as unknown as WalletClient,
        account: ACCOUNT,
        plan,
      })

      const { mintData, burnData } = buildSfpmSwapCalldata(plan)
      expect(result.hash).toBe(TX_HASH)
      expect(writeContract).toHaveBeenCalledWith(
        expect.objectContaining({
          address: SFPM,
          functionName: 'multicall',
          args: [[mintData, burnData]],
        }),
      )
    },
  )
})
