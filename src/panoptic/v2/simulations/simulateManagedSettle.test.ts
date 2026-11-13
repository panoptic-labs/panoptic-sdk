import {
  type Address,
  type Hex,
  type PublicClient,
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
} from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { panopticPoolV2Abi } from '../../../generated'
import { PanopticError, UnsafePremiumSettlementError } from '../errors'
import { createTokenIdBuilder } from '../tokenId'
import { simulateManagedSettle } from './simulateManagedSettle'

const protection = vi.hoisted(() => vi.fn())
vi.mock('./simulateClosePremiumProtection', () => ({ simulateClosePremiumProtection: protection }))

const account = '0x0000000000000000000000000000000000000001'
const poolAddress = '0x0000000000000000000000000000000000000002'
const signerAddress = '0x0000000000000000000000000000000000000003'
const managerAddress = '0x0000000000000000000000000000000000000004'
const buyer = '0x0000000000000000000000000000000000000005'
const mixed = createTokenIdBuilder(10n << 48n)
  .addPut({ strike: 0n, width: 10n, optionRatio: 1n, isLong: false, asset: 0n })
  .addCall({ strike: 100n, width: 10n, optionRatio: 1n, isLong: false, asset: 1n })
  .addCall({ strike: 200n, width: 10n, optionRatio: 1n, isLong: true, asset: 1n })
  .build()
const long = createTokenIdBuilder(10n << 48n)
  .addCall({ strike: 300n, width: 10n, optionRatio: 1n, isLong: true })
  .build()
const readContract = vi.fn()
const simulateBlocks = vi.fn()
const client = { readContract, simulateBlocks } as unknown as PublicClient
const params = {
  client,
  poolAddress,
  account,
  signerAddress,
  signerPositionIdList: [99n],
  positionIdList: [mixed, long, 88n],
  tokenIds: [mixed, long],
  token0Decimals: 6n,
  token1Decimals: 18n,
  targets: [{ user: buyer, tokenId: 77n, positionIdList: [66n, 77n] }],
  buildManageCall: (data: Hex) => ({ to: managerAddress, data }),
  builderCode: 123n,
} satisfies Parameters<typeof simulateManagedSettle>[0]
const meta = { blockNumber: 42n, blockTimestamp: 100n, blockHash: '0x1234' }

function assets(token0: bigint, token1: bigint) {
  return encodeFunctionResult({
    abi: panopticPoolV2Abi,
    functionName: 'getAssetsOf',
    result: [token0, token1],
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  protection.mockResolvedValue({
    success: true,
    data: { owed0: 0n, owed1: 0n, forfeit0: 0n, forfeit1: 0n },
    _meta: meta,
  })
  readContract.mockResolvedValue([0n, 0n, [100n, 200n], [], []])
  simulateBlocks.mockResolvedValue([
    {
      calls: [assets(1000n, 2000n), '0x', '0x', assets(1100n, 1950n)].map((data) => ({
        status: 'success',
        data,
      })),
    },
  ])
})

describe('simulateManagedSettle', () => {
  it('settles mixed-asset legs at their stored sizes and preserves the full held list', async () => {
    const result = await simulateManagedSettle(params)
    expect(result.success).toBe(true)
    if (!result.success) throw result.error
    expect(result.data).toMatchObject({
      positionSizes: [100n, 200n],
      collateralDelta0: 100n,
      collateralDelta1: -50n,
      settledBuyerCount: 1,
    })
    const dispatch = decodeFunctionData({ abi: panopticPoolV2Abi, data: result.data.dispatchData })
    if (dispatch.functionName !== 'dispatch') throw new Error('Expected dispatch')
    expect(dispatch.args[1]).toEqual(params.positionIdList)
    expect(dispatch.args[5]).toBe(123n)
    for (const [index, tokenId] of dispatch.args[0].entries()) {
      if (tokenId === mixed) expect(dispatch.args[2][index]).toBe(100n)
      if (tokenId === long) expect(dispatch.args[2][index]).toBe(200n)
      if (dispatch.args[2][index] === 0n) expect(params.positionIdList).not.toContain(tokenId)
    }
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ blockNumber: 42n }))
    expect(protection).toHaveBeenCalledWith(
      expect.objectContaining({ closingTokenIds: params.tokenIds, signerAddress }),
    )
    const request = simulateBlocks.mock.calls[0]?.[0]
    expect(request.blockNumber).toBe(42n)
    expect(
      request.blocks[0].calls.map((call: { to: string; account: string }) => [
        call.to,
        call.account,
      ]),
    ).toEqual([
      [poolAddress, signerAddress],
      [poolAddress, signerAddress],
      [managerAddress, signerAddress],
      [poolAddress, signerAddress],
    ])
    const settle = decodeFunctionData({
      abi: panopticPoolV2Abi,
      data: request.blocks[0].calls[1].data,
    })
    expect(settle.args).toEqual([[99n], buyer, [66n, 77n], [66n, 77n], 0n])
  })

  it.each([
    [63n, 0n],
    [1n, 0n],
    [0n, 101n],
  ])('blocks residuals above the token dust allowance (%s, %s)', async (forfeit0, forfeit1) => {
    protection.mockResolvedValue({
      success: true,
      data: { owed0: forfeit0, owed1: forfeit1, forfeit0, forfeit1 },
      _meta: meta,
    })
    const result = await simulateManagedSettle(params)
    expect(result.success).toBe(false)
    if (result.success) throw new Error('Expected protection failure')
    expect(result.error).toBeInstanceOf(UnsafePremiumSettlementError)
    expect(simulateBlocks).not.toHaveBeenCalled()
  })

  it.each([
    { decimals: [6n, 18n], forfeit: [0n, 63n] },
    { decimals: [6n, 18n], forfeit: [0n, 100n] },
    { decimals: [18n, 6n], forfeit: [63n, 0n] },
    { decimals: [18n, 6n], forfeit: [100n, 0n] },
    { decimals: [18n, 18n], forfeit: [100n, 100n] },
  ] as const)(
    'allows only bounded aggregate dust across mixed legs: $forfeit',
    async ({ decimals, forfeit }) => {
      protection.mockResolvedValue({
        success: true,
        data: { owed0: forfeit[0], owed1: forfeit[1], forfeit0: forfeit[0], forfeit1: forfeit[1] },
        _meta: meta,
      })
      const result = await simulateManagedSettle({
        ...params,
        token0Decimals: decimals[0],
        token1Decimals: decimals[1],
      })
      expect(result.success && result.data).toMatchObject({
        forfeit0: forfeit[0],
        forfeit1: forfeit[1],
        positionSizes: [100n, 200n],
      })
      expect(simulateBlocks).toHaveBeenCalled()
    },
  )

  it('does not multiply the allowance by the number of positions or legs', async () => {
    protection.mockResolvedValue({
      success: true,
      data: { owed0: 0n, owed1: 101n, forfeit0: 0n, forfeit1: 101n },
      _meta: meta,
    })
    const result = await simulateManagedSettle(params)
    expect(result.success).toBe(false)
    expect(simulateBlocks).not.toHaveBeenCalled()
  })

  it.each([
    {
      before: [1000000n, 2000000000000000000n],
      after: [1234567n, 1999000000000000000n],
      delta: [234567n, -1000000000000000n],
    },
    {
      before: [2000000000000000000n, 1000000n],
      after: [1999000000000000000n, 1234567n],
      delta: [-1000000000000000n, 234567n],
    },
  ])(
    'preserves token denominations in either token ordering: $delta',
    async ({ before, after, delta }) => {
      const [before0 = 0n, before1 = 0n] = before
      const [after0 = 0n, after1 = 0n] = after
      simulateBlocks.mockResolvedValueOnce([
        {
          calls: [assets(before0, before1), '0x', '0x', assets(after0, after1)].map((data) => ({
            status: 'success',
            data,
          })),
        },
      ])
      const result = await simulateManagedSettle(params)
      expect(result.success && result.data).toMatchObject({
        collateralDelta0: delta[0],
        collateralDelta1: delta[1],
      })
    },
  )

  it.each([63n, 100n, 101n])(
    'checks the actual short settlement events against the dust cap: %s',
    async (unpaid) => {
      protection.mockResolvedValue({
        success: true,
        data: { owed0: 1000n, owed1: 2000n, forfeit0: 0n, forfeit1: 0n },
        _meta: meta,
      })
      const settledLog = (
        tokenId: bigint,
        legIndex: bigint,
        amount0: bigint,
        amount1: bigint,
        user: Address = account,
        address: Address = poolAddress,
      ) => ({
        address,
        topics: encodeEventTopics({
          abi: panopticPoolV2Abi,
          eventName: 'PremiumSettled',
          args: { user, tokenId },
        }),
        data: encodeAbiParameters(
          [{ type: 'uint256' }, { type: 'int256' }],
          [legIndex, (amount1 << 128n) | amount0],
        ),
      })
      simulateBlocks.mockResolvedValueOnce([
        {
          calls: [
            { status: 'success', data: assets(1000n, 2000n) },
            { status: 'success', data: '0x' },
            {
              status: 'success',
              data: '0x',
              logs: [
                settledLog(mixed, 0n, 1000n, 0n),
                settledLog(mixed, 1n, 0n, 2000n - unpaid),
                settledLog(mixed, 2n, 1000000n, 1000000n),
                settledLog(long, 0n, 1000000n, 1000000n),
                settledLog(88n, 0n, 1000000n, 1000000n),
                settledLog(mixed, 0n, 1000000n, 1000000n, buyer),
                settledLog(mixed, 0n, 1000000n, 1000000n, account, managerAddress),
              ],
            },
            { status: 'success', data: assets(1100n, 1950n) },
          ],
        },
      ])
      const result = await simulateManagedSettle(params)
      expect(result.success).toBe(unpaid <= 100n)
      if (result.success) expect(result.data.forfeit1).toBe(unpaid)
      else expect(result.error).toBeInstanceOf(UnsafePremiumSettlementError)
    },
  )

  it('fails closed if non-dust premium cannot be verified from settlement events', async () => {
    protection.mockResolvedValue({
      success: true,
      data: { owed0: 1000n, owed1: 2000n, forfeit0: 0n, forfeit1: 0n },
      _meta: meta,
    })
    const result = await simulateManagedSettle(params)
    expect(result.success).toBe(false)
    if (result.success) throw new Error('Expected an unverifiable settlement to fail')
    expect(result.error).toBeInstanceOf(UnsafePremiumSettlementError)
  })

  it.each([[0n, 200n], [100n]])('rejects zero or incomplete stored sizes: %s', async (...sizes) => {
    readContract.mockResolvedValue([0n, 0n, sizes, [], []])
    const result = await simulateManagedSettle(params)
    expect(result.success).toBe(false)
    expect(simulateBlocks).not.toHaveBeenCalled()
  })

  it('preserves an unsuccessful funding simulation', async () => {
    const failure = { success: false, error: new PanopticError('Buyer failed'), _meta: meta }
    protection.mockResolvedValue(failure)
    await expect(simulateManagedSettle(params)).resolves.toBe(failure)
    expect(simulateBlocks).not.toHaveBeenCalled()
  })

  it('blocks a manager revert and incomplete simulation results', async () => {
    simulateBlocks.mockResolvedValueOnce([
      { calls: [{ status: 'failure', error: new Error('Unauthorized') }, {}, {}, {}] },
    ])
    const reverted = await simulateManagedSettle(params)
    expect(!reverted.success && reverted.error.message).toContain('Unauthorized')
    simulateBlocks.mockResolvedValueOnce([{ calls: [] }])
    const incomplete = await simulateManagedSettle(params)
    expect(!incomplete.success && incomplete.error.message).toContain('incomplete')
  })

  it('collects with no buyers using the same manager flow', async () => {
    simulateBlocks.mockResolvedValueOnce([
      {
        calls: [assets(1n, 2n), '0x', assets(3n, 5n)].map((data) => ({ status: 'success', data })),
      },
    ])
    const result = await simulateManagedSettle({ ...params, targets: [] })
    expect(result.success && result.data).toMatchObject({
      collateralDelta0: 2n,
      collateralDelta1: 3n,
      settledBuyerCount: 0,
    })
  })
})
