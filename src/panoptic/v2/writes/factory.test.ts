import type { Address, Hash, PublicClient, WalletClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import type { PoolKey } from '../types'
import { deployNewPool } from './factory'

const MOCK_FACTORY = '0x000000000000010a1DEc6c46371A28A071F8bb01' as Address
const MOCK_ACCOUNT = '0x557a1a07653a637d8e0c01074d9c33618c0956af' as Address
const MOCK_HASH = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as Hash
const MOCK_RISK_ENGINE = '0x0000000000000000000000000000000000000000' as Address

const MOCK_POOL_KEY: PoolKey = {
  currency0: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address,
  currency1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
  fee: 500n,
  tickSpacing: 10n,
  hooks: '0x0000000000000000000000000000000000000000' as Address,
}

function createMockClients() {
  const publicClient = {
    estimateContractGas: vi.fn().mockResolvedValue(200000n),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({
      transactionHash: MOCK_HASH,
      blockNumber: 12345678n,
      blockHash: '0xabcd' as Hash,
      gasUsed: 150000n,
      status: 'success',
      logs: [],
    }),
  } as unknown as PublicClient

  const walletClient = {
    writeContract: vi.fn().mockResolvedValue(MOCK_HASH),
    account: { address: MOCK_ACCOUNT },
    chain: { id: 1 },
  } as unknown as WalletClient

  return { publicClient, walletClient }
}

describe('deployNewPool', () => {
  it('should call writeContract with factory ABI and return TxResult', async () => {
    const { publicClient, walletClient } = createMockClients()

    const result = await deployNewPool({
      client: publicClient,
      walletClient,
      account: MOCK_ACCOUNT,
      factoryAddress: MOCK_FACTORY,
      poolKey: MOCK_POOL_KEY,
      riskEngine: MOCK_RISK_ENGINE,
      salt: 42n,
    })

    expect(result.hash).toBe(MOCK_HASH)
    expect(typeof result.wait).toBe('function')
    expect(walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: MOCK_FACTORY,
        functionName: 'deployNewPool',
      }),
    )
  })
})
