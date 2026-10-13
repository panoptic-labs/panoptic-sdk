import type { PublicClient } from 'viem'
import { zeroAddress } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getAccountCollateral } from '../../panoptic/v2/reads/account'
import { getCollateralData } from '../../panoptic/v2/reads/collateral'
import { getPoolMetadata } from '../../panoptic/v2/reads/pool'
import { resolveVaultPoolInfosAtBlock } from '../utils/vaultManagerInput'
import { getLendingAllocationRows } from './lendingAllocation'

vi.mock('../../panoptic/v2/reads/pool', () => ({
  getPoolMetadata: vi.fn(),
}))

vi.mock('../../panoptic/v2/reads/collateral', () => ({
  getCollateralData: vi.fn(),
}))

vi.mock('../../panoptic/v2/reads/account', () => ({
  getAccountCollateral: vi.fn(),
}))

vi.mock('../utils/vaultManagerInput', () => ({
  resolveVaultPoolInfosAtBlock: vi.fn(),
}))

const VAULT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const
const UNDERLYING = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const
const POOL = '0xcccccccccccccccccccccccccccccccccccccccc' as const
const COLLATERAL_0 = '0xdddddddddddddddddddddddddddddddddddddddd' as const

function createMockClient(): PublicClient {
  return {
    readContract: vi.fn().mockResolvedValue(50n),
    getBlockNumber: vi.fn().mockResolvedValue(123n),
    getBalance: vi.fn().mockResolvedValue(25n),
  } as unknown as PublicClient
}

describe('getLendingAllocationRows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    { chainId: 1, blockNumber: 100n, tokenIndex: 0, native: false },
    { chainId: 1, blockNumber: 101n, tokenIndex: 1, native: false },
    { chainId: 4663, blockNumber: 100n, tokenIndex: 0, native: false },
    { chainId: 4663, blockNumber: 101n, tokenIndex: 1, native: false },
    { chainId: 1, blockNumber: 99n, tokenIndex: 0, native: true },
    { chainId: 1, blockNumber: 99n, tokenIndex: 1, native: true },
  ])(
    'reads block $blockNumber allocation on chain $chainId with underlying token$tokenIndex',
    async ({ chainId, blockNumber, tokenIndex, native }) => {
      const underlyingTokenAddress = native
        ? '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
        : UNDERLYING
      const poolAsset = native ? zeroAddress : UNDERLYING
      vi.mocked(resolveVaultPoolInfosAtBlock).mockResolvedValue([
        { pool: POOL, token0: UNDERLYING, token1: COLLATERAL_0, maxPriceDeviation: 100 },
      ])

      vi.mocked(getPoolMetadata).mockResolvedValue({
        token0Asset: tokenIndex === 0 ? poolAsset : COLLATERAL_0,
        token1Asset: tokenIndex === 1 ? poolAsset : COLLATERAL_0,
        token0Symbol: 'USDC',
        token1Symbol: 'ETH',
        collateralToken0Address: COLLATERAL_0,
        collateralToken1Address: '0xffffffffffffffffffffffffffffffffffffffff',
      } as unknown as Awaited<ReturnType<typeof getPoolMetadata>>)

      vi.mocked(getCollateralData).mockResolvedValue({
        borrowRate: 1_000n,
        supplyRate: 700n,
        utilization: 5_000n,
      } as Awaited<ReturnType<typeof getCollateralData>>)

      vi.mocked(getAccountCollateral).mockResolvedValue({
        token0: { assets: tokenIndex === 0 ? 100n : 0n },
        token1: { assets: tokenIndex === 1 ? 100n : 0n },
      } as Awaited<ReturnType<typeof getAccountCollateral>>)

      const client = createMockClient()
      const result = await getLendingAllocationRows({
        client,
        chainId,
        blockNumber,
        vaultAddress: VAULT,
        underlyingTokenAddress,
      })

      expect(resolveVaultPoolInfosAtBlock).toHaveBeenCalledWith({
        viemClient: client,
        chainId,
        vaultAddress: VAULT,
        blockNumber,
      })
      expect(getCollateralData).toHaveBeenCalledWith({
        client,
        poolAddress: POOL,
        tokenIndex,
        blockNumber,
      })
      expect(result.totalUnderlying).toBe(native ? 175n : 150n)
      expect(result.rows).toHaveLength(2)

      const marketRow = result.rows.find((row) => row.isIdle === false)
      const idleRow = result.rows.find((row) => row.isIdle)

      expect(marketRow).toBeDefined()
      expect(idleRow).toBeDefined()

      expect(marketRow?.borrowRateWad).toBe(1_000n)
      expect(marketRow?.supplyRateWad).toBe(700n)
      expect(marketRow?.collateralTrackerAddress).toBe(
        tokenIndex === 0 ? COLLATERAL_0 : '0xffffffffffffffffffffffffffffffffffffffff',
      )

      expect(idleRow?.borrowRateWad).toBeNull()
      expect(idleRow?.supplyRateWad).toBeNull()
      expect(idleRow?.collateralTrackerAddress).toBeNull()
    },
  )
})
