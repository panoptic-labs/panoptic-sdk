import type { Address, PublicClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import type { PoolKey } from '../types'
import { getFactoryConstructMetadata, minePoolAddress, simulateDeployNewPool } from './factory'

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

describe('minePoolAddress', () => {
  it('should call readContract with correct args and return result', async () => {
    const client = createMockClient({
      readContract: vi.fn().mockResolvedValue([42n, 100n]),
    })

    const result = await minePoolAddress({
      client,
      factoryAddress: MOCK_FACTORY,
      deployerAddress: MOCK_ACCOUNT,
      poolKey: MOCK_POOL_KEY,
      riskEngine: MOCK_RISK_ENGINE,
      salt: 1n,
      loops: 1024n,
      minTargetRarity: 20n,
    })

    expect(result).toEqual({ bestSalt: 42n, highestRarity: 100n })
    expect(client.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: MOCK_FACTORY,
        functionName: 'minePoolAddress',
      }),
    )
  })
})

describe('getFactoryConstructMetadata', () => {
  it('should call readContract with correct args', async () => {
    const client = createMockClient({
      readContract: vi.fn().mockResolvedValue('data:application/json;base64,eyJ0ZXN0Ijp0cnVlfQ=='),
    })

    const result = await getFactoryConstructMetadata({
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
})

describe('simulateDeployNewPool', () => {
  it('should simulate deployNewPool and return the predicted address', async () => {
    const client = createMockClient({
      simulateContract: vi.fn().mockResolvedValue({ result: MOCK_POOL }),
    })

    const result = await simulateDeployNewPool({
      client,
      factoryAddress: MOCK_FACTORY,
      account: MOCK_ACCOUNT,
      poolKey: MOCK_POOL_KEY,
      riskEngine: MOCK_RISK_ENGINE,
      salt: 1n,
    })

    expect(result).toBe(MOCK_POOL)
    expect(client.simulateContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: MOCK_FACTORY,
        functionName: 'deployNewPool',
        account: MOCK_ACCOUNT,
      }),
    )
  })
})
