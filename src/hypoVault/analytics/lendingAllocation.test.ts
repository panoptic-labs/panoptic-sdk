import type { PublicClient } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getAccountCollateral } from '../../panoptic/v2/reads/account'
import { getCollateralData } from '../../panoptic/v2/reads/collateral'
import { getPoolMetadata } from '../../panoptic/v2/reads/pool'
import { getHypoVaultConfigForVault } from '../hypoVaultManagerConfigs/vaultToConfig'
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

vi.mock('../hypoVaultManagerConfigs/vaultToConfig', () => ({
  getHypoVaultConfigForVault: vi.fn(),
}))

vi.mock('../hypoVaultManagerArtifacts/SepoliaUSDCPLPVaultPoolInfos', () => ({
  SepoliaUSDCPLPVaultPoolInfos: {
    vaultAddress: '0x0000000000000000000000000000000000000000',
    poolInfos: [],
  },
}))

vi.mock('../hypoVaultManagerArtifacts/SepoliaWETHPLPVaultPoolInfos', () => ({
  SepoliaWETHPLPVaultPoolInfos: {
    vaultAddress: '0x0000000000000000000000000000000000000000',
    poolInfos: [],
  },
}))

const VAULT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const
const UNDERLYING = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const
const POOL = '0xcccccccccccccccccccccccccccccccccccccccc' as const
const COLLATERAL_0 = '0xdddddddddddddddddddddddddddddddddddddddd' as const

function createMockClient(): PublicClient {
  return {
    readContract: vi.fn().mockResolvedValue(50n),
  } as unknown as PublicClient
}

describe('getLendingAllocationRows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('adds borrowRateWad and collateralTrackerAddress for non-idle rows and nulls for idle row', async () => {
    vi.mocked(getHypoVaultConfigForVault).mockReturnValue({
      addresses: { ethUsdc500bpsV4PanopticPool: POOL },
    } as unknown as ReturnType<typeof getHypoVaultConfigForVault>)

    vi.mocked(getPoolMetadata).mockResolvedValue({
      token0Asset: UNDERLYING,
      token1Asset: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
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
      token0: { assets: 100n },
      token1: { assets: 0n },
    } as Awaited<ReturnType<typeof getAccountCollateral>>)

    const result = await getLendingAllocationRows({
      client: createMockClient(),
      chainId: 1,
      vaultAddress: VAULT,
      underlyingTokenAddress: UNDERLYING,
    })

    expect(result.rows).toHaveLength(2)

    const marketRow = result.rows.find((row) => row.isIdle === false)
    const idleRow = result.rows.find((row) => row.isIdle)

    expect(marketRow).toBeDefined()
    expect(idleRow).toBeDefined()

    expect(marketRow?.borrowRateWad).toBe(1_000n)
    expect(marketRow?.supplyRateWad).toBe(700n)
    expect(marketRow?.collateralTrackerAddress).toBe(COLLATERAL_0)

    expect(idleRow?.borrowRateWad).toBeNull()
    expect(idleRow?.supplyRateWad).toBeNull()
    expect(idleRow?.collateralTrackerAddress).toBeNull()
  })
})
