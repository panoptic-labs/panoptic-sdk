import {
  type Address,
  type TransactionReceipt,
  createPublicClient,
  custom,
  encodeAbiParameters,
  encodeEventTopics,
  erc20Abi,
  zeroAddress,
} from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { collateralTrackerV2Abi, panopticPoolV2Abi } from '../../../generated'
import { getBlockMeta } from '../clients'
import { buildEarnCoveredCallTokenId } from '../tokenId/coveredCall'
import { getAccountCollateral, getAccountSummaryBasic } from './account'
import {
  type ClosedCallProceeds,
  getClosedCallProceeds,
  spendClosedCallProceeds,
} from './closedCallProceeds'
import { convertToAssets, convertToShares } from './erc4626'
import { type AccountTrade, getAccountHistory } from './history'
import { getPoolMetadata } from './pool'

vi.mock('./account', () => ({ getAccountCollateral: vi.fn(), getAccountSummaryBasic: vi.fn() }))
vi.mock('./erc4626', () => ({ convertToAssets: vi.fn(), convertToShares: vi.fn() }))
vi.mock('./history', () => ({ getAccountHistory: vi.fn() }))
vi.mock('./pool', () => ({ getPoolMetadata: vi.fn() }))
vi.mock('../clients', () => ({ getBlockMeta: vi.fn() }))
const owner = '0x0000000000000000000000000000000000000001'
const poolAddress = '0x0000000000000000000000000000000000000002'
const trackers = [
  '0x0000000000000000000000000000000000000003',
  '0x0000000000000000000000000000000000000004',
] as const
const hash = (n: bigint) => `0x${n.toString(16).padStart(64, '0')}` as const
const client = createPublicClient({ transport: custom({ request: async () => null }) })
const lot = (n: bigint): ClosedCallProceeds => ({
  transactionHash: hash(n),
  blockNumber: n,
  logIndex: 1n,
  tokenIds: [1n],
  timestamp: n,
  shares0: 100n,
  shares1: 20n,
  remainingShares0: 100n,
  remainingShares1: 20n,
  remainingAssets0: 0n,
  remainingAssets1: 0n,
})
describe('closed proceeds FIFO', () => {
  it('consumes each native token independently, oldest close first', () => {
    const lots = [lot(10n), lot(20n)]
    spendClosedCallProceeds(lots, 0, 130n)
    expect(lots.map((entry) => entry.remainingShares0)).toEqual([0n, 70n])
    expect(lots.map((entry) => entry.remainingShares1)).toEqual([20n, 20n])
    spendClosedCallProceeds(lots, 1, 100n)
    expect(lots.map((entry) => entry.remainingShares1)).toEqual([0n, 0n])
    expect(() => spendClosedCallProceeds(lots, 0, -1n)).toThrow()
  })
})
function setup(
  assetIdx: 0n | 1n,
  {
    withdrawal = false,
    deposit = false,
    reuse = false,
    mismatch = false,
    reverted = false,
    closeDeposit = false,
    closeGift = false,
    duplicate = false,
    activeBacking = false,
    partial = false,
  } = {},
) {
  const tokenId = buildEarnCoveredCallTokenId({
    poolId: 1n,
    assetIdx,
    strike: assetIdx === 0n ? -200000n : 200000n,
    width: 10n,
    loanStrike: 0n,
  })
  const baseUnit = assetIdx === 0n ? 10n ** 18n : 10n ** 6n
  const quoteUnit = assetIdx === 0n ? 10n ** 6n : 10n ** 18n
  const beforeBase = 10n * baseUnit
  const afterBase = beforeBase - baseUnit / 10n + (closeDeposit || closeGift ? 5n * baseUnit : 0n)
  const afterQuote = 5n * quoteUnit + quoteUnit / 4n
  const scale = (base: bigint, quote: bigint) => (assetIdx === 0n ? [base, quote] : [quote, base])
  const token = (assets: bigint) => ({
    assets,
    shares: assets * 2n,
    lockedAssets: 0n,
    availableAssets: assets,
  })
  const collateral = (base: bigint, quote: bigint, legCount = 0n) => {
    const [a, b] = scale(base, quote)
    return { token0: token(a), token1: token(b), legCount }
  }
  const trades: AccountTrade[] = [
    {
      action: 'mint',
      tokenId,
      positionSize: partial ? 2n * baseUnit : baseUnit,
      blockNumber: 10n,
      logIndex: 5n,
      transactionHash: hash(10n),
    },
    {
      action: 'burn',
      tokenId,
      positionSize: baseUnit,
      blockNumber: 20n,
      logIndex: 5n,
      transactionHash: hash(20n),
    },
    ...(reuse
      ? [
          {
            action: 'mint' as const,
            tokenId,
            positionSize: baseUnit,
            blockNumber: 40n,
            logIndex: 5n,
            transactionHash: hash(40n),
          },
        ]
      : []),
  ]
  const active = {
    tokenId: buildEarnCoveredCallTokenId({
      poolId: 1n,
      assetIdx,
      strike: assetIdx === 0n ? -200000n : 200000n,
      width: 20n,
      loanStrike: 0n,
    }),
    positionSize: (95n * baseUnit) / 10n,
  }
  if (activeBacking)
    trades.push({
      action: 'mint',
      ...active,
      blockNumber: 11n,
      logIndex: 5n,
      transactionHash: hash(11n),
    })
  if (duplicate) trades.push(...trades.map((trade) => ({ ...trade })))
  const metadata = { collateralToken0Address: trackers[0], collateralToken1Address: trackers[1] }
  vi.mocked(getPoolMetadata).mockResolvedValue(
    metadata as unknown as Awaited<ReturnType<typeof getPoolMetadata>>,
  )
  vi.mocked(getAccountHistory).mockResolvedValue({ trades } as Awaited<
    ReturnType<typeof getAccountHistory>
  >)
  vi.mocked(getBlockMeta).mockImplementation(
    async ({ blockNumber }) =>
      ({ blockNumber, blockTimestamp: 1000n }) as Awaited<ReturnType<typeof getBlockMeta>>,
  )
  vi.mocked(convertToShares).mockImplementation(
    async ({ amount }) => ({ result: amount * 2n }) as Awaited<ReturnType<typeof convertToShares>>,
  )
  vi.mocked(convertToAssets).mockImplementation(
    async ({ amount }) => ({ result: amount / 2n }) as Awaited<ReturnType<typeof convertToAssets>>,
  )
  const before = {
    positions: [
      { tokenId, positionSize: partial ? 2n * baseUnit : baseUnit },
      ...(activeBacking ? [active] : []),
    ],
    collateral: collateral(beforeBase, 5n * quoteUnit, activeBacking ? 4n : 2n),
  }
  const remainingBase =
    afterBase - (withdrawal ? baseUnit / 4n : 0n) + (deposit ? 100n * baseUnit : 0n)
  const current = {
    positions: reuse
      ? before.positions
      : activeBacking
        ? [active]
        : partial
          ? [{ tokenId, positionSize: baseUnit }]
          : [],
    collateral: collateral(remainingBase, afterQuote, reuse || activeBacking || partial ? 2n : 0n),
  }
  vi.mocked(getAccountSummaryBasic).mockImplementation(
    async ({ blockNumber }) =>
      (blockNumber === 19n ? before : current) as Awaited<
        ReturnType<typeof getAccountSummaryBasic>
      >,
  )
  const after = collateral(afterBase, afterQuote)
  if (mismatch) after.token0.shares++
  vi.mocked(getAccountCollateral).mockResolvedValue(
    after as Awaited<ReturnType<typeof getAccountCollateral>>,
  )
  const transfer = (
    index: number,
    incoming: boolean,
    value: bigint,
    block: bigint,
    logIndex: number,
    origin: Address = zeroAddress,
  ) => {
    const from = incoming ? origin : owner
    const to = incoming ? owner : zeroAddress
    return {
      address: trackers[index],
      blockNumber: block,
      blockHash: hash(block),
      transactionHash: hash(block),
      transactionIndex: 0,
      logIndex,
      removed: false,
      eventName: 'Transfer',
      args: { from, to, value },
      topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from, to } }),
      data: encodeAbiParameters([{ type: 'uint256' }], [value]),
    }
  }
  const transfers = [
    transfer(Number(assetIdx), false, baseUnit / 5n, 20n, 1),
    transfer(Number(1n - assetIdx), true, quoteUnit / 2n, 20n, 2),
    ...(withdrawal ? [transfer(Number(assetIdx), false, baseUnit / 2n, 30n, 1)] : []),
    ...(deposit ? [transfer(Number(assetIdx), true, 200n * baseUnit, 35n, 1)] : []),
    ...(closeDeposit ? [transfer(Number(assetIdx), true, 10n * baseUnit, 20n, 3)] : []),
    ...(closeGift
      ? [
          transfer(
            Number(assetIdx),
            true,
            10n * baseUnit,
            20n,
            3,
            '0x0000000000000000000000000000000000000009',
          ),
        ]
      : []),
  ]
  const read = vi
    .spyOn(client, 'getContractEvents')
    .mockImplementation(
      async (params) =>
        transfers.filter(
          (log) =>
            log.address === params.address &&
            ('from' in (params.args ?? {}) ? log.args.from === owner : log.args.to === owner),
        ) as unknown as Awaited<ReturnType<typeof client.getContractEvents>>,
    )
  const burn = {
    address: poolAddress,
    blockNumber: 20n,
    blockHash: hash(20n),
    transactionHash: hash(20n),
    transactionIndex: 0,
    logIndex: 5,
    removed: false,
    topics: encodeEventTopics({
      abi: panopticPoolV2Abi,
      eventName: 'OptionBurnt',
      args: { recipient: owner, tokenId },
    }),
    data: encodeAbiParameters(
      [{ type: 'uint128' }, { type: 'int256[4]' }],
      [baseUnit, [0n, 0n, 0n, 0n]],
    ),
  }
  const depositLog = {
    ...burn,
    address: trackers[Number(assetIdx)],
    logIndex: 4,
    topics: encodeEventTopics({
      abi: collateralTrackerV2Abi,
      eventName: 'Deposit',
      args: { sender: owner, owner },
    }),
    data: encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'uint256' }],
      [5n * baseUnit, 10n * baseUnit],
    ),
  }
  vi.spyOn(client, 'getTransactionReceipt').mockResolvedValue({
    status: reverted ? 'reverted' : 'success',
    blockNumber: 20n,
    logs: [
      ...transfers.filter((log) => log.blockNumber === 20n),
      burn,
      ...(closeDeposit ? [depositLog] : []),
    ],
  } as unknown as TransactionReceipt)
  return { read, baseUnit, quoteUnit }
}
beforeEach(() => vi.restoreAllMocks())
describe('confirmed closed-call proceeds', () => {
  it.each([0n, 1n] as const)(
    'includes a confirmed withdrawal when range logs lag in native ordering %s',
    async (assetIdx) => {
      const { baseUnit } = setup(assetIdx)
      const closeReceipt = await client.getTransactionReceipt({ hash: hash(20n) })
      const withdrawal = {
        ...closeReceipt.logs[0],
        address: trackers[Number(assetIdx)],
        blockNumber: 30n,
        transactionHash: hash(30n),
        logIndex: 1,
        args: { from: owner, to: zeroAddress, value: 2n * baseUnit },
        topics: encodeEventTopics({
          abi: erc20Abi,
          eventName: 'Transfer',
          args: { from: owner, to: zeroAddress },
        }),
        data: encodeAbiParameters([{ type: 'uint256' }], [2n * baseUnit]),
      }
      vi.spyOn(client, 'getTransactionReceipt').mockImplementation(async ({ hash: id }) =>
        id === hash(20n)
          ? closeReceipt
          : ({
              status: 'success',
              blockNumber: 30n,
              transactionHash: hash(30n),
              logs: [withdrawal],
            } as unknown as TransactionReceipt),
      )
      vi.spyOn(client, 'getBlockNumber').mockResolvedValue(29n)
      const result = await getClosedCallProceeds({
        client,
        chainId: 1n,
        poolAddress,
        account: owner,
        confirmedTransactions: [hash(30n), hash(30n)],
      })
      expect(assetIdx === 0n ? result.availableAssets0 : result.availableAssets1).toBe(0n)
      expect(
        assetIdx === 0n
          ? result.proceeds[0]?.remainingShares0
          : result.proceeds[0]?.remainingShares1,
      ).toBe(0n)
    },
  )
  it('rejects a snapshot from before the confirmed withdrawal', async () => {
    setup(0n)
    await expect(
      getClosedCallProceeds({
        client,
        chainId: 1n,
        poolAddress,
        account: owner,
        toBlock: 19n,
        confirmedTransactions: [hash(20n)],
      }),
    ).rejects.toThrow('predates confirmed withdrawal')
  })
  it('excludes unrelated share transfers received in the close transaction', async () => {
    const { baseUnit } = setup(0n, { closeGift: true })
    const result = await getClosedCallProceeds({
      client,
      chainId: 1n,
      poolAddress,
      account: owner,
      toBlock: 50n,
    })
    expect(result.availableAssets0).toBe((9n * baseUnit) / 10n)
  })
  it('excludes deposits made in the close transaction and deduplicates history logs', async () => {
    const { baseUnit } = setup(0n, { closeDeposit: true, duplicate: true })
    const result = await getClosedCallProceeds({
      client,
      chainId: 1n,
      poolAddress,
      account: owner,
      toBlock: 50n,
    })
    expect(result.proceeds).toHaveLength(1)
    expect(result.availableAssets0).toBe((9n * baseUnit) / 10n)
  })
  it.each([0n, 1n] as const)(
    'protects backing for remaining calls in native ordering %s',
    async (assetIdx) => {
      const { baseUnit } = setup(assetIdx, { activeBacking: true })
      const result = await getClosedCallProceeds({
        client,
        chainId: 1n,
        poolAddress,
        account: owner,
        toBlock: 50n,
      })
      expect(assetIdx === 0n ? result.availableAssets0 : result.availableAssets1).toBe(
        (4n * baseUnit) / 10n,
      )
    },
  )
  it('withholds partial closes whose attributed proceeds cannot be isolated', async () => {
    setup(0n, { partial: true })
    const result = await getClosedCallProceeds({
      client,
      chainId: 1n,
      poolAddress,
      account: owner,
      toBlock: 50n,
    })
    expect(result.proceeds).toEqual([])
    expect(result.unverified).toHaveLength(1)
  })
  it.each([0n, 1n] as const)(
    'tracks only allocated backing plus the receipt flows in mixed-decimal order %s',
    async (assetIdx) => {
      const { baseUnit, quoteUnit } = setup(assetIdx)
      const result = await getClosedCallProceeds({
        client,
        chainId: 1n,
        poolAddress,
        account: owner,
        toBlock: 50n,
      })
      const closed = result.proceeds[0]
      expect(result.unverified).toEqual([])
      expect(assetIdx === 0n ? closed?.remainingAssets0 : closed?.remainingAssets1).toBe(
        (9n * baseUnit) / 10n,
      )
      expect(assetIdx === 0n ? closed?.remainingAssets1 : closed?.remainingAssets0).toBe(
        quoteUnit / 4n,
      )
    },
  )
  it('does not replenish withdrawn proceeds with an unrelated later deposit', async () => {
    const { baseUnit } = setup(0n, { withdrawal: true, deposit: true })
    const result = await getClosedCallProceeds({
      client,
      chainId: 1n,
      poolAddress,
      account: owner,
      toBlock: 50n,
    })
    expect(result.proceeds[0]?.remainingAssets0).toBe((65n * baseUnit) / 100n)
  })
  it('consumes released backing when it is reused for a new short call', async () => {
    setup(0n, { reuse: true })
    const result = await getClosedCallProceeds({
      client,
      chainId: 1n,
      poolAddress,
      account: owner,
      toBlock: 50n,
    })
    expect(result.proceeds[0]?.remainingShares0).toBe(0n)
  })
  it.each(['mismatch', 'reverted'] as const)(
    'excludes an unverified %s instead of exposing general collateral',
    async (failure) => {
      setup(0n, { [failure]: true })
      const result = await getClosedCallProceeds({
        client,
        chainId: 1n,
        poolAddress,
        account: owner,
        toBlock: 50n,
      })
      expect(result.proceeds).toEqual([])
      expect(result.unverified).toHaveLength(1)
    },
  )
})
