import type { Address, PublicClient } from 'viem'
import { zeroAddress } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import type { PoolKey } from '../types'
import {
  getFactoryConstructMetadata,
  getPanopticPoolFromPoolId,
  minePoolAddress,
  resolvePanopticPoolFromPoolId,
  simulateDeployNewPool,
} from './factory'

const MOCK_FACTORY = '0x000000000000010a1DEc6c46371A28A071F8bb01' as Address
const MOCK_ACCOUNT = '0x557a1a07653a637d8e0c01074d9c33618c0956af' as Address
const MOCK_POOL = '0x2aafC1D2Af4dEB9FD8b02cDE5a8C0922cA4D6c78' as Address
const MOCK_RISK_ENGINE = '0x0000000000000000000000000000000000000000' as Address

const MOCK_POOL_KEY: PoolKey = {
  currency0: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address,
  currency1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
  fee: 500n,
  tickSpacing: 10n,
  hooks: '0x0000000000000000000000000000000000000000' as Address,
}

function createMockClient(overrides: Partial<PublicClient> = {}): PublicClient {
  return {
    readContract: vi.fn(),
    simulateContract: vi.fn(),
    ...overrides,
  } as unknown as PublicClient
}

describe.each(['v3', 'v4'] as const)('minePoolAddress (%s)', (version) => {
  const baseParams = {
    client: {} as PublicClient,
    factoryAddress: MOCK_FACTORY,
    deployerAddress: MOCK_ACCOUNT,
    riskEngine: MOCK_RISK_ENGINE,
    salt: 1n,
    loops: 1024n,
    minTargetRarity: 20n,
  }

  const versionParams =
    version === 'v3'
      ? {
          version,
          token0: MOCK_POOL_KEY.currency0,
          token1: MOCK_POOL_KEY.currency1,
          fee: 500n,
          v3Pool: MOCK_POOL,
        }
      : { version, poolKey: MOCK_POOL_KEY }

  it('should call readContract with correct args and return result', async () => {
    const client = createMockClient({
      readContract: vi.fn().mockResolvedValue([42n, 100n]),
    })

    const result = await minePoolAddress({ ...baseParams, ...versionParams, client })

    expect(result).toEqual({ bestSalt: 42n, highestRarity: 100n })
    expect(client.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: MOCK_FACTORY,
        functionName: 'minePoolAddress',
      }),
    )
  })

  it('should propagate errors from readContract', async () => {
    const client = createMockClient({
      readContract: vi.fn().mockRejectedValue(new Error('rpc error')),
    })

    await expect(minePoolAddress({ ...baseParams, ...versionParams, client })).rejects.toThrow(
      'rpc error',
    )
  })
})

describe.each(['v3', 'v4'] as const)('getFactoryConstructMetadata (%s)', (version) => {
  it('should call readContract with correct args', async () => {
    const client = createMockClient({
      readContract: vi.fn().mockResolvedValue('data:application/json;base64,eyJ0ZXN0Ijp0cnVlfQ=='),
    })

    const result = await getFactoryConstructMetadata({
      version,
      client,
      factoryAddress: MOCK_FACTORY,
      panopticPoolAddress: MOCK_POOL,
      symbol0: 'WETH',
      symbol1: 'USDC',
      fee: 500n,
    })

    expect(result).toBe('data:application/json;base64,eyJ0ZXN0Ijp0cnVlfQ==')
    expect(client.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: MOCK_FACTORY,
        functionName: 'constructMetadata',
        args: [MOCK_POOL, 'WETH', 'USDC', 500n],
      }),
    )
  })

  it('should propagate errors from readContract', async () => {
    const client = createMockClient({
      readContract: vi.fn().mockRejectedValue(new Error('rpc error')),
    })

    await expect(
      getFactoryConstructMetadata({
        version,
        client,
        factoryAddress: MOCK_FACTORY,
        panopticPoolAddress: MOCK_POOL,
        symbol0: 'WETH',
        symbol1: 'USDC',
        fee: 500n,
      }),
    ).rejects.toThrow('rpc error')
  })
})

describe.each(['v3', 'v4'] as const)('simulateDeployNewPool (%s)', (version) => {
  const baseParams = {
    client: {} as PublicClient,
    factoryAddress: MOCK_FACTORY,
    account: MOCK_ACCOUNT,
    riskEngine: MOCK_RISK_ENGINE,
    salt: 1n,
  }

  const versionParams =
    version === 'v3'
      ? { version, token0: MOCK_POOL_KEY.currency0, token1: MOCK_POOL_KEY.currency1, fee: 500n }
      : { version, poolKey: MOCK_POOL_KEY }

  it('should simulate deployNewPool and return the predicted address', async () => {
    const client = createMockClient({
      simulateContract: vi.fn().mockResolvedValue({ result: MOCK_POOL }),
    })

    const result = await simulateDeployNewPool({ ...baseParams, ...versionParams, client })

    expect(result).toBe(MOCK_POOL)
    expect(client.simulateContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: MOCK_FACTORY,
        functionName: 'deployNewPool',
        account: MOCK_ACCOUNT,
      }),
    )
  })

  it('should propagate errors from simulateContract', async () => {
    const client = createMockClient({
      simulateContract: vi.fn().mockRejectedValue(new Error('simulation failed')),
    })

    await expect(
      simulateDeployNewPool({ ...baseParams, ...versionParams, client }),
    ).rejects.toThrow('simulation failed')
  })
})

const MOCK_SFPM = '0x8888888888888888888888888888888888888888' as Address
const MOCK_PANOPTIC_POOL = '0x9999999999999999999999999999999999999999' as Address

describe('getPanopticPoolFromPoolId (v3)', () => {
  it('should chain SFPM lookup and factory lookup', async () => {
    const client = createMockClient({
      readContract: vi
        .fn()
        // First call: getUniswapV3PoolFromId → returns uniswap pool
        .mockResolvedValueOnce(MOCK_POOL)
        // Second call: getPanopticPool → returns panoptic pool
        .mockResolvedValueOnce(MOCK_PANOPTIC_POOL),
    })

    const result = await getPanopticPoolFromPoolId({
      version: 'v3',
      client,
      sfpmAddress: MOCK_SFPM,
      factoryAddress: MOCK_FACTORY,
      riskEngine: MOCK_RISK_ENGINE,
      poolId: 42n,
    })

    expect(result).toBe(MOCK_PANOPTIC_POOL)
    expect(client.readContract).toHaveBeenCalledTimes(2)
    expect(client.readContract).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        address: MOCK_SFPM,
        functionName: 'getUniswapV3PoolFromId',
        args: [42n],
      }),
    )
    expect(client.readContract).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        address: MOCK_FACTORY,
        functionName: 'getPanopticPool',
        args: [MOCK_POOL, MOCK_RISK_ENGINE],
      }),
    )
  })
})

describe('getPanopticPoolFromPoolId (v4)', () => {
  it('should chain SFPM poolKey lookup and factory lookup', async () => {
    const rawPoolKey = {
      currency0: MOCK_POOL_KEY.currency0,
      currency1: MOCK_POOL_KEY.currency1,
      fee: 500, // ABI returns number
      tickSpacing: 10, // ABI returns number
      hooks: MOCK_POOL_KEY.hooks,
    }

    const client = createMockClient({
      readContract: vi
        .fn()
        // First call: getUniswapV4PoolKeyFromId → returns raw pool key
        .mockResolvedValueOnce(rawPoolKey)
        // Second call: getPanopticPool → returns panoptic pool
        .mockResolvedValueOnce(MOCK_PANOPTIC_POOL),
    })

    const result = await getPanopticPoolFromPoolId({
      version: 'v4',
      client,
      sfpmAddress: MOCK_SFPM,
      factoryAddress: MOCK_FACTORY,
      riskEngine: MOCK_RISK_ENGINE,
      poolId: 7n,
    })

    expect(result).toBe(MOCK_PANOPTIC_POOL)
    expect(client.readContract).toHaveBeenCalledTimes(2)
    expect(client.readContract).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        address: MOCK_SFPM,
        functionName: 'getUniswapV4PoolKeyFromId',
        args: [7n],
      }),
    )
    expect(client.readContract).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        address: MOCK_FACTORY,
        functionName: 'getPanopticPool',
      }),
    )
  })
})

const MOCK_V3_SFPM = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address
const MOCK_V4_SFPM = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Address
const MOCK_V3_FACTORY = '0xcccccccccccccccccccccccccccccccccccccccc' as Address
const MOCK_V4_FACTORY = '0xdddddddddddddddddddddddddddddddddddddd' as Address

describe('resolvePanopticPoolFromPoolId', () => {
  it('should return v3 result when v3 resolves and v4 does not', async () => {
    const readContract = vi.fn().mockImplementation((args: { address: Address }) => {
      if (args.address === MOCK_V3_SFPM) return Promise.resolve(MOCK_POOL)
      if (args.address === MOCK_V3_FACTORY) return Promise.resolve(MOCK_PANOPTIC_POOL)
      if (args.address === MOCK_V4_SFPM)
        return Promise.reject(
          Object.assign(new Error('revert'), { name: 'ContractFunctionExecutionError' }),
        )
      return Promise.resolve(zeroAddress)
    })
    const client = createMockClient({ readContract })

    const result = await resolvePanopticPoolFromPoolId({
      client,
      poolId: 42n,
      riskEngine: MOCK_RISK_ENGINE,
      v3: { sfpmAddress: MOCK_V3_SFPM, factoryAddress: MOCK_V3_FACTORY },
      v4: { sfpmAddress: MOCK_V4_SFPM, factoryAddress: MOCK_V4_FACTORY },
    })

    expect(result).toEqual({ panopticPoolAddress: MOCK_PANOPTIC_POOL, version: 'v3' })
  })

  it('should return v4 result when v4 resolves and v3 does not', async () => {
    const rawPoolKey = {
      currency0: MOCK_POOL_KEY.currency0,
      currency1: MOCK_POOL_KEY.currency1,
      fee: 500,
      tickSpacing: 10,
      hooks: MOCK_POOL_KEY.hooks,
    }

    const readContract = vi.fn().mockImplementation((args: { address: Address }) => {
      if (args.address === MOCK_V3_SFPM) return Promise.resolve(zeroAddress)
      if (args.address === MOCK_V3_FACTORY) return Promise.resolve(zeroAddress)
      if (args.address === MOCK_V4_SFPM) return Promise.resolve(rawPoolKey)
      if (args.address === MOCK_V4_FACTORY) return Promise.resolve(MOCK_PANOPTIC_POOL)
      return Promise.resolve(zeroAddress)
    })
    const client = createMockClient({ readContract })

    const result = await resolvePanopticPoolFromPoolId({
      client,
      poolId: 7n,
      riskEngine: MOCK_RISK_ENGINE,
      v3: { sfpmAddress: MOCK_V3_SFPM, factoryAddress: MOCK_V3_FACTORY },
      v4: { sfpmAddress: MOCK_V4_SFPM, factoryAddress: MOCK_V4_FACTORY },
    })

    expect(result).toEqual({ panopticPoolAddress: MOCK_PANOPTIC_POOL, version: 'v4' })
  })

  it('should throw when neither version resolves', async () => {
    const readContract = vi.fn().mockImplementation((args: { address: Address }) => {
      if (args.address === MOCK_V3_SFPM) return Promise.resolve(zeroAddress)
      if (args.address === MOCK_V3_FACTORY) return Promise.resolve(zeroAddress)
      if (args.address === MOCK_V4_SFPM)
        return Promise.reject(
          Object.assign(new Error('revert'), { name: 'ContractFunctionExecutionError' }),
        )
      return Promise.resolve(zeroAddress)
    })
    const client = createMockClient({ readContract })

    await expect(
      resolvePanopticPoolFromPoolId({
        client,
        poolId: 999n,
        riskEngine: MOCK_RISK_ENGINE,
        v3: { sfpmAddress: MOCK_V3_SFPM, factoryAddress: MOCK_V3_FACTORY },
        v4: { sfpmAddress: MOCK_V4_SFPM, factoryAddress: MOCK_V4_FACTORY },
      }),
    ).rejects.toThrow('No PanopticPool found for poolId 999')
  })

  it('should work with only v3 provided', async () => {
    const client = createMockClient({
      readContract: vi
        .fn()
        .mockResolvedValueOnce(MOCK_POOL)
        .mockResolvedValueOnce(MOCK_PANOPTIC_POOL),
    })

    const result = await resolvePanopticPoolFromPoolId({
      client,
      poolId: 42n,
      riskEngine: MOCK_RISK_ENGINE,
      v3: { sfpmAddress: MOCK_V3_SFPM, factoryAddress: MOCK_V3_FACTORY },
    })

    expect(result).toEqual({ panopticPoolAddress: MOCK_PANOPTIC_POOL, version: 'v3' })
  })

  it('should throw when no version config is provided', async () => {
    const client = createMockClient()

    await expect(
      resolvePanopticPoolFromPoolId({
        client,
        poolId: 42n,
        riskEngine: MOCK_RISK_ENGINE,
      }),
    ).rejects.toThrow('At least one of v3 or v4 must be provided')
  })
})
