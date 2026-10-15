import { type PublicClient, encodeErrorResult, encodeFunctionResult } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { Multicall3Abi } from '../../abis/multicall3'
import { panopticPoolV2Abi } from '../../abis/panoptic_v2_abis'
import {
  getVaultCandidatePoolInfos,
  recoverVaultCandidateTokenIdsByPool,
  resolveVaultPoolInfosAtBlock,
  resolveVaultTokenIdsByPool,
  verifyVaultOpenTokenIdsAtBlock,
} from './vaultManagerInput'

const readContractMock = vi.fn()
const callMock = vi.fn()
const getOpenPositionIdsMock = vi.fn()
const resolveAuthorizationMock = vi.fn()
const resolveRobinhoodAuthorizationMock = vi.fn()
const getAuthorizationGenerationsMock = vi.fn()
const getRobinhoodAuthorizationGenerationsMock = vi.fn()
const getHistoricalPoolConfigurationMock = vi.fn()
const getHistoricalPoolConfigurationsMock = vi.fn()

vi.mock('viem/actions', () => ({
  call: async (...args: unknown[]) => {
    const results = await callMock(...args)
    return {
      data: encodeFunctionResult({
        abi: Multicall3Abi,
        functionName: 'aggregate3',
        result: results,
      }),
    }
  },
  readContract: (...args: unknown[]) => readContractMock(...args),
}))

vi.mock('../../panoptic/v2/sync/getTrackedPositionIds', () => ({
  getOpenPositionIds: (...args: unknown[]) => getOpenPositionIdsMock(...args),
}))

vi.mock('../mainnetV3Authorization', () => ({
  MAINNET_V3_AUTHORIZATION_BLOCK: 100n,
  getMainnetV3AuthorizationGenerations: (...args: unknown[]) =>
    getAuthorizationGenerationsMock(...args),
  resolveMainnetV3AuthorizationArtifacts: (...args: unknown[]) => resolveAuthorizationMock(...args),
}))

vi.mock('../mainnetVaultPoolHistory', () => ({
  ROBINHOOD_USDG_VAULT_DEPLOYMENT_BLOCK: 200n,
  getVaultPoolConfigurationAtBlock: (...args: unknown[]) =>
    getHistoricalPoolConfigurationMock(...args),
  getVaultPoolConfigurationHistory: (...args: unknown[]) =>
    getHistoricalPoolConfigurationsMock(...args),
}))

vi.mock('../robinhoodSpyUsdgAuthorization', () => ({
  getRobinhoodSpyUsdgAuthorizationGenerations: (...args: unknown[]) =>
    getRobinhoodAuthorizationGenerationsMock(...args),
  resolveRobinhoodSpyUsdgAuthorizationArtifacts: (...args: unknown[]) =>
    resolveRobinhoodAuthorizationMock(...args),
}))

function ownedPosition(size: bigint) {
  return {
    success: true,
    returnData: encodeFunctionResult({
      abi: panopticPoolV2Abi,
      functionName: 'getFullPositionsData',
      result: [0n, 0n, [size], [0n], [0n]],
    }),
  }
}

function missingPosition() {
  return {
    success: false,
    returnData: encodeErrorResult({
      abi: panopticPoolV2Abi,
      errorName: 'PositionNotOwned',
    }),
  }
}

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  }
}

describe('vault pool generation selection', () => {
  const vaultAddress = '0xCd70829727D5524Dee39DA7E824BCfe0F0879Ff4' as const
  const poolA = {
    pool: '0x0000000000000000000000000000000000000010' as const,
    token0: '0x0000000000000000000000000000000000000001' as const,
    token1: '0x0000000000000000000000000000000000000002' as const,
    maxPriceDeviation: 100,
  }
  const poolB = {
    ...poolA,
    pool: '0x0000000000000000000000000000000000000020' as const,
  }

  it('selects the atomically authorized generation at and after the transition boundary', async () => {
    resolveAuthorizationMock.mockReset()
    resolveAuthorizationMock.mockResolvedValue({ poolInfos: [poolB] })

    await expect(
      resolveVaultPoolInfosAtBlock({
        viemClient: {} as never,
        chainId: 1,
        vaultAddress,
        blockNumber: 100n,
      }),
    ).resolves.toEqual([poolB])
  })

  it('keeps candidates for pools from every recognized generation', () => {
    getAuthorizationGenerationsMock.mockReset()
    getHistoricalPoolConfigurationsMock.mockReset()
    getHistoricalPoolConfigurationsMock.mockReturnValue(null)
    getAuthorizationGenerationsMock.mockReturnValue({
      previous: { poolInfos: [poolA] },
      next: { poolInfos: [poolA, poolB] },
      current: { poolInfos: [poolB] },
      replacement: { poolInfos: [poolB] },
    })

    expect(getVaultCandidatePoolInfos(vaultAddress, 1)).toEqual([poolA, poolB])
  })

  it('uses historical pool metadata before the Robinhood vault deployment block', async () => {
    resolveRobinhoodAuthorizationMock.mockReset()
    getHistoricalPoolConfigurationMock.mockReset()
    getHistoricalPoolConfigurationMock.mockReturnValue({ poolInfos: [poolA] })

    await expect(
      resolveVaultPoolInfosAtBlock({
        viemClient: {} as never,
        chainId: 4663,
        vaultAddress,
        blockNumber: 199n,
      }),
    ).resolves.toEqual([poolA])
    expect(resolveRobinhoodAuthorizationMock).not.toHaveBeenCalled()
  })

  it('keeps historical candidates on chains without mainnet authorization generations', () => {
    getAuthorizationGenerationsMock.mockReset()
    getRobinhoodAuthorizationGenerationsMock.mockReset()
    getHistoricalPoolConfigurationsMock.mockReset()
    getAuthorizationGenerationsMock.mockReturnValue(null)
    getRobinhoodAuthorizationGenerationsMock.mockReturnValue([])
    getHistoricalPoolConfigurationsMock.mockReturnValue([{ poolInfos: [poolA] }])

    expect(getVaultCandidatePoolInfos(vaultAddress, 4663)).toContainEqual(poolA)
  })
})

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
                panopticPool: { id: '0x0000000000000000000000000000000000000010' },
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
              panopticPool: { id: '0x0000000000000000000000000000000000000010' },
              tokenId: { id: '30', idHexString: '0x1e' },
            },
          ],
          optionBurns: [
            {
              panopticPool: { id: '0x0000000000000000000000000000000000000010' },
              tokenId: { id: '20', idHexString: '0x14' },
            },
            {
              panopticPool: { id: '0x0000000000000000000000000000000000000010' },
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
          pool: '0x0000000000000000000000000000000000000010',
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
                panopticPool: { id: '0x0000000000000000000000000000000000000010' },
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

    callMock.mockReset()
    callMock.mockResolvedValueOnce([missingPosition(), ownedPosition(3n)])

    const viemClient = {} as unknown as PublicClient

    const result = await resolveVaultTokenIdsByPool({
      viemClient,
      chainId: 11155111,
      vaultAddress: '0xCd70829727D5524Dee39DA7E824BCfe0F0879Ff4',
      managerAddress: '0xa1b9A9943FE39C36403daB99D3B654f6d44cF7c4',
      poolInfos: [
        {
          pool: '0x0000000000000000000000000000000000000010',
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
    expect(callMock).toHaveBeenCalledTimes(1)
  })
})

describe('recoverVaultCandidateTokenIdsByPool', () => {
  const vaultAddress = '0xCd70829727D5524Dee39DA7E824BCfe0F0879Ff4' as const
  const pool0 = '0x0000000000000000000000000000000000000010' as const
  const pool1 = '0x0000000000000000000000000000000000000020' as const
  const poolInfos = [
    {
      pool: pool0,
      token0: '0x0000000000000000000000000000000000000001' as const,
      token1: '0x0000000000000000000000000000000000000002' as const,
      maxPriceDeviation: 100,
      positionScanFromBlock: 50n,
    },
    {
      pool: pool1,
      token0: '0x0000000000000000000000000000000000000001' as const,
      token1: '0x0000000000000000000000000000000000000002' as const,
      maxPriceDeviation: 100,
    },
  ]

  it('merges recovered IDs and preserves an unchanged pool', async () => {
    getOpenPositionIdsMock.mockReset()
    getOpenPositionIdsMock.mockResolvedValueOnce([3n, 1n]).mockResolvedValueOnce([])

    const result = await recoverVaultCandidateTokenIdsByPool({
      viemClient: {} as unknown as PublicClient,
      chainId: 1,
      vaultAddress,
      candidatesByPool: [
        { poolAddress: pool0, candidates: [1n, 2n] },
        { poolAddress: pool1, candidates: [9n] },
      ],
      poolInfos,
      blockNumber: 200n,
      fromBlock: 100n,
    })

    expect(result).toEqual([
      { poolAddress: pool0, candidates: [1n, 2n, 3n] },
      { poolAddress: pool1, candidates: [9n] },
    ])
    expect(getOpenPositionIdsMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ fromBlock: 100n, toBlock: 200n }),
    )
  })

  it('uses each configured pool scan start when no trusted block exists', async () => {
    getOpenPositionIdsMock.mockReset()
    getOpenPositionIdsMock.mockResolvedValue([])

    await expect(
      recoverVaultCandidateTokenIdsByPool({
        viemClient: {} as unknown as PublicClient,
        chainId: 1,
        vaultAddress,
        candidatesByPool: [],
        poolInfos,
        blockNumber: 200n,
      }),
    ).rejects.toThrow('no recovery lower bound configured')

    expect(getOpenPositionIdsMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ fromBlock: 50n }),
    )
    expect(getOpenPositionIdsMock).toHaveBeenCalledTimes(1)
  })

  it('surfaces a missing authoritative snapshot instead of treating it as empty', async () => {
    getOpenPositionIdsMock.mockReset()
    getOpenPositionIdsMock.mockResolvedValue(null)

    await expect(
      recoverVaultCandidateTokenIdsByPool({
        viemClient: {} as unknown as PublicClient,
        chainId: 1,
        vaultAddress,
        candidatesByPool: [],
        poolInfos: poolInfos.slice(0, 1),
        blockNumber: 200n,
      }),
    ).rejects.toThrow('Could not recover an authoritative position list')
  })

  it('surfaces recovery failures instead of returning an incomplete list', async () => {
    getOpenPositionIdsMock.mockReset()
    getOpenPositionIdsMock.mockRejectedValue(new Error('RPC unavailable'))

    await expect(
      recoverVaultCandidateTokenIdsByPool({
        viemClient: {} as unknown as PublicClient,
        chainId: 1,
        vaultAddress,
        candidatesByPool: [],
        poolInfos,
        blockNumber: 200n,
        fromBlock: 100n,
      }),
    ).rejects.toThrow('RPC unavailable')
  })
})

describe('bounded historical position verification', () => {
  const client = {} as PublicClient
  const vaultAddress = '0x236d0558f06cd60780b232d4ec4c92d2cb7e4d18' as const
  const poolAddress = '0x00000000563b70d704f4c6675a5f6ac989fbae13' as const
  const verify = (candidates: bigint[]) =>
    verifyVaultOpenTokenIdsAtBlock({
      viemClient: client,
      vaultAddress,
      candidatesByPool: [{ poolAddress, candidates }],
      blockNumber: 26128353n,
    })

  it('checks 33 closed candidates in three sequential RPC calls without recursive probes', async () => {
    callMock.mockReset()
    callMock
      .mockResolvedValueOnce(Array.from({ length: 16 }, missingPosition))
      .mockResolvedValueOnce(Array.from({ length: 16 }, missingPosition))
      .mockResolvedValueOnce([missingPosition()])
    expect(await verify(Array.from({ length: 33 }, (_, i) => BigInt(i)))).toEqual([[]])
    expect(callMock).toHaveBeenCalledTimes(3)
    for (const [, request] of callMock.mock.calls) {
      expect(request).toMatchObject({
        to: '0xcA11bde05977b3631167028862bE2a173976CA11',
        blockNumber: 26128353n,
      })
    }
  })

  it('keeps open positions and ignores zero balances and missing positions', async () => {
    callMock.mockReset()
    callMock.mockResolvedValueOnce([ownedPosition(4n), missingPosition(), ownedPosition(0n)])
    expect(await verify([1n, 2n, 3n])).toEqual([[1n]])
  })

  it('propagates provider failures without treating positions as closed', async () => {
    callMock.mockReset()
    callMock.mockRejectedValueOnce(new Error('429 throughput limit'))
    await expect(verify([1n, 2n])).rejects.toThrow('429 throughput limit')
    expect(callMock).toHaveBeenCalledTimes(1)
  })

  it('rejects unexpected contract reverts and incomplete responses', async () => {
    callMock.mockReset()
    callMock.mockResolvedValueOnce([{ success: false, returnData: '0x' }])
    await expect(verify([1n])).rejects.toThrow()
    callMock.mockResolvedValueOnce([])
    await expect(verify([1n])).rejects.toThrow('Incomplete')
  })
})
