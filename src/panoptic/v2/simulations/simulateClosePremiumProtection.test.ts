import {
  type Hex,
  type PublicClient,
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
} from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { panopticPoolV2Abi } from '../../../generated'
import { PanopticError } from '../errors'
import { createTokenIdBuilder } from '../tokenId'
import { simulateClosePremiumProtection } from './simulateClosePremiumProtection'

const account = '0x0000000000000000000000000000000000000001'
const poolAddress = '0x0000000000000000000000000000000000000002'
const buyer = '0x0000000000000000000000000000000000000003'
const signerAddress = '0x0000000000000000000000000000000000000004'
const managerAddress = '0x0000000000000000000000000000000000000005'
const execution = {
  signerAddress,
  signerPositionIdList: [99n],
  buildCollectionCall: (data: Hex) => ({ to: managerAddress, data }) as const,
} as const
const poolId = 10n << 48n
const short = createTokenIdBuilder(poolId)
  .addPut({ strike: 0n, width: 10n, optionRatio: 1n, isLong: false })
  .build()
const readContract = vi.fn()
const simulateBlocks = vi.fn()
const client = {
  getBlockNumber: vi.fn().mockResolvedValue(42n),
  getBlock: vi.fn().mockResolvedValue({ number: 42n, hash: '0x1234', timestamp: 100n }),
  readContract,
  simulateBlocks,
} as unknown as PublicClient

function premiumResult(token0: bigint, token1: bigint) {
  return encodeFunctionResult({
    abi: panopticPoolV2Abi,
    functionName: 'getFullPositionsData',
    result: [(token1 << 128n) | token0, 0n, [], [], []],
  })
}

function simulation({ result }: { result: Hex[] }) {
  return [{ calls: result.map((data) => ({ status: 'success', data })) }]
}

beforeEach(() => {
  vi.clearAllMocks()
  readContract.mockResolvedValue([0n, 0n, [100n], []])
})

describe('simulateClosePremiumProtection', () => {
  it('wraps block-number resolution failures in PanopticError', async () => {
    vi.mocked(client.getBlockNumber).mockRejectedValueOnce(new Error('Block lookup failed'))
    await expect(
      simulateClosePremiumProtection({
        client,
        ...execution,
        signerPositionIdList: [...execution.signerPositionIdList],
        poolAddress,
        account,
        positionIdList: [short],
        closingTokenIds: [short],
        targets: [],
      }),
    ).rejects.toBeInstanceOf(PanopticError)
    expect(readContract).not.toHaveBeenCalled()
  })

  it('preserves existing PanopticError during block-number resolution', async () => {
    const failure = new PanopticError('Block lookup failed')
    vi.mocked(client.getBlockNumber).mockRejectedValueOnce(failure)
    await expect(
      simulateClosePremiumProtection({
        client,
        ...execution,
        signerPositionIdList: [...execution.signerPositionIdList],
        poolAddress,
        account,
        positionIdList: [short],
        closingTokenIds: [short],
        targets: [],
      }),
    ).rejects.toBe(failure)
  })

  it('handles early metadata rejection while preserving its eventual propagation', async () => {
    const failure = new Error('Metadata unavailable')
    vi.mocked(client.getBlock).mockRejectedValueOnce(failure)
    readContract.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve([0n, 0n, [100n], [], []]), 10)),
    )
    simulateBlocks.mockResolvedValue(
      simulation({
        result: ['0x', premiumResult(10n, 20n), premiumResult(10n, 20n)],
      }),
    )
    await expect(
      simulateClosePremiumProtection({
        client,
        ...execution,
        signerPositionIdList: [...execution.signerPositionIdList],
        poolAddress,
        account,
        positionIdList: [short],
        closingTokenIds: [short],
        targets: [],
      }),
    ).rejects.toBe(failure)
  })

  it.each([{ signerPositions: [] }, { signerPositions: [99n] }])(
    'settles buyers and collects chunk fees with signer positions $signerPositions',
    async ({ signerPositions }) => {
      simulateBlocks.mockResolvedValue(
        simulation({
          result: ['0x', '0x', premiumResult(398n, 162n), premiumResult(398n, 162n)],
        }),
      )
      const target = { user: buyer, tokenId: 7n, positionIdList: [6n, 7n] } as const
      const result = await simulateClosePremiumProtection({
        client,
        ...execution,
        signerPositionIdList: signerPositions,
        poolAddress,
        account,
        positionIdList: [short, 88n],
        closingTokenIds: [short],
        targets: [{ ...target, positionIdList: [...target.positionIdList] }],
      })
      expect(result.success && result.data).toMatchObject({ forfeit0: 0n, forfeit1: 0n })
      const request = simulateBlocks.mock.calls[0]?.[0]
      expect(request).toMatchObject({ blockNumber: 42n })
      expect(simulateBlocks).toHaveBeenCalledTimes(1)
      expect(request.blocks).toHaveLength(1)
      expect(
        request.blocks[0].calls.map((call: { to: string; account: string }) => [
          call.to,
          call.account,
        ]),
      ).toEqual([
        [poolAddress, signerAddress],
        [managerAddress, signerAddress],
        [poolAddress, signerAddress],
        [poolAddress, signerAddress],
      ])
      const calls = request.blocks[0].calls.map(({ data }: { data: Hex }) =>
        decodeFunctionData({ abi: panopticPoolV2Abi, data }),
      )
      expect(calls.map((call: { functionName: string }) => call.functionName)).toEqual([
        'dispatchFrom',
        'dispatch',
        'getFullPositionsData',
        'getFullPositionsData',
      ])
      expect(calls[0].args).toEqual([signerPositions, buyer, [6n, 7n], [6n, 7n], 0n])
      expect(calls[1].args[1]).toEqual([short, 88n])
      expect(calls[1].args[0]).not.toContain(short)
      expect(calls[2].args).toEqual([account, true, [short]])
      expect(calls[3].args).toEqual([account, false, [short]])
      expect(readContract.mock.calls[0]?.[0].blockNumber).toBe(42n)
    },
  )

  it.each([
    {
      owed0: 398235612n,
      owed1: 162634828778461550n,
      available0: 93231129n,
      available1: 38040223402712842n,
    },
    {
      owed0: 162634828778461550n,
      owed1: 398235612n,
      available0: 38040223402712842n,
      available1: 93231129n,
    },
  ])('reports the shortfall in both token orderings: $owed0 / $owed1', async (premium) => {
    simulateBlocks.mockResolvedValue(
      simulation({
        result: [
          '0x',
          premiumResult(premium.owed0, premium.owed1),
          premiumResult(premium.available0, premium.available1),
        ],
      }),
    )
    const result = await simulateClosePremiumProtection({
      client,
      ...execution,
      signerPositionIdList: [...execution.signerPositionIdList],
      poolAddress,
      account,
      positionIdList: [short],
      closingTokenIds: [short],
      targets: [],
    })
    expect(result.success && result.data).toMatchObject({
      forfeit0: premium.owed0 - premium.available0,
      forfeit1: premium.owed1 - premium.available1,
    })
  })

  it('checks multiple mixed-asset positions together without settling the seller itself', async () => {
    const mixed = createTokenIdBuilder(poolId)
      .addPut({ strike: 0n, width: 10n, optionRatio: 2n, isLong: false, asset: 0n })
      .addCall({ strike: 200n, width: 4n, optionRatio: 1n, isLong: false, asset: 1n })
      .addCall({ strike: 300n, width: 4n, optionRatio: 1n, isLong: true, asset: 0n })
      .build()
    readContract.mockResolvedValue([0n, 0n, [100n, 200n], []])
    simulateBlocks.mockResolvedValue(
      simulation({
        result: ['0x', premiumResult(10n, 20n), premiumResult(10n, 20n)],
      }),
    )
    const result = await simulateClosePremiumProtection({
      client,
      ...execution,
      signerPositionIdList: [...execution.signerPositionIdList],
      poolAddress,
      account,
      positionIdList: [short, mixed],
      closingTokenIds: [short, mixed],
      targets: [],
    })
    expect(result.success).toBe(true)
    const calls = simulateBlocks.mock.calls[0]?.[0].blocks[0].calls.map(
      (call: { data: Hex }) => call.data,
    )
    const collection = decodeFunctionData({ abi: panopticPoolV2Abi, data: calls[0] })
    expect(collection.functionName).toBe('dispatch')
    if (collection.functionName !== 'dispatch') throw new Error('Expected collection dispatch')
    expect(collection.args[1]).toEqual([short, mixed])
    expect(collection.args[0]).not.toContain(short)
    expect(collection.args[0]).not.toContain(mixed)
    expect(collection.args[0]).toHaveLength(4)
  })

  it('returns a failure when collection or buyer settlement cannot execute', async () => {
    simulateBlocks.mockRejectedValue(new Error('AccountInsolvent'))
    const result = await simulateClosePremiumProtection({
      client,
      ...execution,
      signerPositionIdList: [...execution.signerPositionIdList],
      poolAddress,
      account,
      positionIdList: [short],
      closingTokenIds: [short],
      targets: [],
    })
    expect(result.success).toBe(false)
    expect(!result.success && result.error.message).toContain('AccountInsolvent')
  })

  it('serializes the ordered steps into one eth_simulateV1 state transition', async () => {
    const request = vi.fn().mockResolvedValue([
      {
        number: '0x2b',
        gasLimit: '0x1c9c380',
        gasUsed: '0x10000',
        timestamp: '0x65',
        calls: ['0x', '0x', premiumResult(10n, 20n), premiumResult(10n, 20n)].map((returnData) => ({
          status: '0x1',
          returnData,
          gasUsed: '0x100',
          logs: [],
        })),
      },
    ])
    const rpcClient = createPublicClient({ transport: custom({ request }) })
    const result = await simulateClosePremiumProtection({
      client: { ...client, simulateBlocks: rpcClient.simulateBlocks },
      ...execution,
      signerPositionIdList: [...execution.signerPositionIdList],
      poolAddress,
      account,
      positionIdList: [short],
      closingTokenIds: [short],
      targets: [{ user: buyer, tokenId: 7n, positionIdList: [7n] }],
    })
    expect(result.success && result.data).toMatchObject({ forfeit0: 0n, forfeit1: 0n })
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith({
      method: 'eth_simulateV1',
      params: [
        expect.objectContaining({
          blockStateCalls: [
            {
              calls: [
                expect.objectContaining({ from: signerAddress, to: poolAddress }),
                expect.objectContaining({ from: signerAddress, to: managerAddress }),
                expect.objectContaining({ from: signerAddress, to: poolAddress }),
                expect.objectContaining({ from: signerAddress, to: poolAddress }),
              ],
            },
          ],
        }),
        '0x2a',
      ],
    })
  })

  it.each([0, 1, 2, 3])('rejects a failed stateful step at index %i', async (failedIndex) => {
    const blocks = simulation({
      result: ['0x', '0x', premiumResult(10n, 20n), premiumResult(10n, 20n)],
    })
    simulateBlocks.mockResolvedValue([
      {
        calls: blocks[0].calls.map((call, index) =>
          index === failedIndex
            ? { status: 'failure', data: '0x', error: new Error('Step reverted') }
            : call,
        ),
      },
    ])
    const result = await simulateClosePremiumProtection({
      client,
      ...execution,
      signerPositionIdList: [...execution.signerPositionIdList],
      poolAddress,
      account,
      positionIdList: [short],
      closingTokenIds: [short],
      targets: [{ user: buyer, tokenId: 7n, positionIdList: [7n] }],
    })
    expect(result.success).toBe(false)
    expect(!result.success && result.error.message).toContain('Step reverted')
  })

  it.each([{ blocks: [] }, { blocks: simulation({ result: [premiumResult(1n, 1n)] }) }])(
    'rejects incomplete stateful results',
    async ({ blocks }) => {
      simulateBlocks.mockResolvedValue(blocks)
      const result = await simulateClosePremiumProtection({
        client,
        ...execution,
        signerPositionIdList: [...execution.signerPositionIdList],
        poolAddress,
        account,
        positionIdList: [short],
        closingTokenIds: [short],
        targets: [],
      })
      expect(result.success).toBe(false)
      expect(!result.success && result.error.message).toContain('incomplete results')
    },
  )

  it('rejects an unowned position before simulating', async () => {
    const result = await simulateClosePremiumProtection({
      client,
      ...execution,
      signerPositionIdList: [...execution.signerPositionIdList],
      poolAddress,
      account,
      positionIdList: [],
      closingTokenIds: [short],
      targets: [],
    })
    expect(result.success).toBe(false)
    expect(simulateBlocks).not.toHaveBeenCalled()
  })
})
