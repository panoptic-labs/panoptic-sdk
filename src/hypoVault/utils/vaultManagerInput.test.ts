import {
  type Abi,
  type PublicClient,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
} from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { resolveVaultTokenIdsByPool } from './vaultManagerInput'

const readContractMock = vi.fn()

vi.mock('viem/actions', () => ({
  readContract: (...args: unknown[]) => readContractMock(...args),
}))

/**
 * Build a viem-shaped revert error so the bisect path treats it as a
 * "bad batch" the same way it would in production. The bisect only
 * catches `ContractFunctionExecutionError`; plain `Error` is treated as
 * a transport failure and rethrown, which is the desired behavior.
 */
function makeRevertError(reason: string): ContractFunctionExecutionError {
  return new ContractFunctionExecutionError(
    new ContractFunctionRevertedError({
      abi: [] as Abi,
      data: undefined,
      functionName: 'getFullPositionsData',
      message: reason,
    }),
    {
      abi: [] as Abi,
      functionName: 'getFullPositionsData',
    },
  )
}

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  }
}

describe('resolveVaultTokenIdsByPool', () => {
  it('prefers subgraph open account balances when available', async () => {
    readContractMock.mockReset()
    const fetchFn = vi.fn(async (_input: string, init?: { body?: string }) => {
      const payload = JSON.parse((init?.body as string | undefined) ?? '{}') as {
        query?: string
      }
      if (payload.query?.includes('panopticPoolAccounts')) {
        return jsonResponse({
          data: {
            panopticPoolAccounts: [
              {
                panopticPool: { id: '0xpool' },
                accountBalances: [{ tokenId: { id: '10' } }, { tokenId: { id: '20' } }],
              },
            ],
          },
        })
      }
      return jsonResponse({
        data: {
          optionMints: [
            {
              panopticPool: { id: '0xpool' },
              tokenId: { id: '30', idHexString: '0x1e' },
            },
          ],
          optionBurns: [
            {
              panopticPool: { id: '0xpool' },
              tokenId: { id: '20', idHexString: '0x14' },
            },
            {
              panopticPool: { id: '0xpool' },
              tokenId: { id: '42', idHexString: '0x2a' },
            },
          ],
        },
      })
    })

    readContractMock.mockResolvedValue([0n, 0n, [0n, 5n, 0n, 7n], [0n], [0n]])

    const viemClient = {} as unknown as PublicClient

    const result = await resolveVaultTokenIdsByPool({
      viemClient,
      chainId: 11155111,
      vaultAddress: '0xCd70829727D5524Dee39DA7E824BCfe0F0879Ff4',
      managerAddress: '0xa1b9A9943FE39C36403daB99D3B654f6d44cF7c4',
      poolInfos: [
        {
          pool: '0xpool',
          token0: '0x0000000000000000000000000000000000000000',
          token1: '0x0000000000000000000000000000000000000001',
          maxPriceDeviation: 100,
        },
      ],
      panopticSubgraphUrl: 'https://example.com/subgraph',
      fetchFn,
    })

    expect(result).toEqual([[10n, 20n]])
    expect(readContractMock).not.toHaveBeenCalled()
  })

  it('returns tokenIds matrix aligned to poolInfos ordering', async () => {
    readContractMock.mockReset()
    const fetchFn = vi.fn(async (_input: string, init?: { body?: string }) => {
      const payload = JSON.parse((init?.body as string | undefined) ?? '{}') as {
        query?: string
      }
      if (payload.query?.includes('panopticPoolAccounts')) {
        return jsonResponse({
          data: {
            panopticPoolAccounts: [
              {
                panopticPool: { id: '0xpool0' },
                accountBalances: [{ tokenId: { id: '1' } }],
              },
            ],
          },
        })
      }
      return jsonResponse({
        data: {
          optionMints: [
            {
              panopticPool: { id: '0xpool1' },
              tokenId: { id: '5', idHexString: '0x05' },
            },
          ],
          optionBurns: [],
        },
      })
    })

    readContractMock.mockResolvedValueOnce([0n, 0n, [1n], [0n], [0n]])

    const viemClient = {} as unknown as PublicClient

    const result = await resolveVaultTokenIdsByPool({
      viemClient,
      chainId: 11155111,
      vaultAddress: '0xCd70829727D5524Dee39DA7E824BCfe0F0879Ff4',
      poolInfos: [
        {
          pool: '0xpool0',
          token0: '0x0000000000000000000000000000000000000000',
          token1: '0x0000000000000000000000000000000000000001',
          maxPriceDeviation: 100,
        },
        {
          pool: '0xpool1',
          token0: '0x0000000000000000000000000000000000000000',
          token1: '0x0000000000000000000000000000000000000001',
          maxPriceDeviation: 100,
        },
      ],
      panopticSubgraphUrl: 'https://example.com/subgraph',
      fetchFn,
    })

    expect(result).toEqual([[1n], [5n]])
    expect(readContractMock).toHaveBeenCalledTimes(1)
  })

  it('filters historical candidates by block ownership when verificationBlockNumber is provided', async () => {
    readContractMock.mockReset()
    const fetchFn = vi.fn(async (_input: string, init?: { body?: string }) => {
      const payload = JSON.parse((init?.body as string | undefined) ?? '{}') as {
        query?: string
      }
      if (payload.query?.includes('panopticPoolAccounts')) {
        return jsonResponse({
          data: {
            panopticPoolAccounts: [
              {
                panopticPool: { id: '0xpool' },
                accountBalances: [{ tokenId: { id: '10' } }, { tokenId: { id: '20' } }],
              },
            ],
          },
        })
      }
      return jsonResponse({
        data: {
          optionMints: [],
          optionBurns: [],
        },
      })
    })

    readContractMock
      // Batch validation of [10, 20] reverts because one tokenId is stale at this block.
      .mockRejectedValueOnce(makeRevertError('PositionNotOwned'))
      // Per-token fallback for 10 -> not owned
      .mockRejectedValueOnce(makeRevertError('PositionNotOwned'))
      // Per-token fallback for 20 -> open with positionSize=3
      .mockResolvedValueOnce([0n, 0n, [3n], [0n], [0n]])

    const viemClient = {} as unknown as PublicClient

    const result = await resolveVaultTokenIdsByPool({
      viemClient,
      chainId: 11155111,
      vaultAddress: '0xCd70829727D5524Dee39DA7E824BCfe0F0879Ff4',
      managerAddress: '0xa1b9A9943FE39C36403daB99D3B654f6d44cF7c4',
      poolInfos: [
        {
          pool: '0xpool',
          token0: '0x0000000000000000000000000000000000000000',
          token1: '0x0000000000000000000000000000000000000001',
          maxPriceDeviation: 100,
        },
      ],
      panopticSubgraphUrl: 'https://example.com/subgraph',
      verificationBlockNumber: 123n,
      fetchFn,
    })

    expect(result).toEqual([[20n]])
    expect(readContractMock).toHaveBeenCalledTimes(3)
  })
})
