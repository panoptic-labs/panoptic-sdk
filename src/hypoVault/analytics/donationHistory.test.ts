import {
  createPublicClient,
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  http,
  zeroAddress,
} from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { HypoVaultAbi } from '../../abis/HypoVault'
import { PanopticVaultAccountantManagerInputAbi } from '../../abis/PanopticVaultAccountantManagerInput'
import { getMainnetVaultPoolConfigurationHistory } from '../mainnetVaultPoolHistory'
import { getVaultDonationTransfers, valueVaultDonationBlock } from './donationHistory'

const vaultAddress = '0x236d0558f06cd60780b232d4Ec4c92d2cb7e4D18'
const donor = '0x000000000000075E29Cdaa9cb640A69e148ca7da'
const tracker0 = '0x1111111111111111111111111111111111111111'
const tracker1 = '0x2222222222222222222222222222222222222222'
const tx = `0x${'ab'.repeat(32)}` as const
const configuration = getMainnetVaultPoolConfigurationHistory({ chainId: 1, vaultAddress })?.[0]
if (configuration === undefined) throw new Error('Missing test configuration')
const pool = configuration.poolInfos[0]
if (pool === undefined) throw new Error('Missing test pool')
const blockNumber = configuration.activationBlockNumber + 100n

function clientWithReads() {
  const client = createPublicClient({ transport: http('http://localhost:1') })
  vi.spyOn(client, 'readContract').mockImplementation(async (params) => {
    if (params.functionName === 'collateralToken0') return tracker0
    if (params.functionName === 'collateralToken1') return tracker1
    if (params.functionName === 'convertToAssets') return BigInt(String(params.args?.[0])) * 2n
    throw new Error('Unexpected read')
  })
  return client
}

describe('vault donation ledger', () => {
  it('combines donated assets in both pool legs using historical share conversion', async () => {
    const client = clientWithReads()
    const result = await valueVaultDonationBlock({
      client,
      chainId: 1,
      vaultAddress,
      underlyingToken: pool.token1,
      timestampSec: 100,
      transfers: [tracker0, tracker1].map((token) => ({
        blockNumber,
        token: getAddress(token),
        amount: 5n,
        transactionHash: tx,
        logIndex: 1,
        pools: [{ ...pool, trackers: [tracker0, tracker1] }],
      })),
      snapshot: {
        sharePrice: '1',
        nav: 100n,
        assetsDeposited: 0n,
        reservedWithdrawalAssets: 1n,
        shares: 100n,
        blockNumber,
        navSource: 'computeNAV',
        managerInputBytes: encodeAbiParameters(PanopticVaultAccountantManagerInputAbi, [
          [{ poolPrice: 0, token0Price: 0, token1Price: 0 }],
          [pool],
          [[]],
          [],
        ]),
        managerInputByteLength: 0,
        managerInputHash: tx,
        tokenIdCountsByPool: null,
        tokenIdsByPool: null,
      },
    })
    expect(result?.donatedAssetsRaw).toBe('20')
    expect(result?.retainedFactor).toBe('0.8')
  })
  it('excludes a confirmed transaction without excluding unrelated payments from its sender', async () => {
    const client = clientWithReads()
    const otherHash = `0x${'cd'.repeat(32)}` as const
    vi.spyOn(client, 'getContractEvents').mockResolvedValue(
      [tx, otherHash].map((transactionHash) => ({
        address: tracker0,
        args: { from: donor, to: vaultAddress, value: 10n },
        blockNumber,
        transactionHash,
        logIndex: 0,
      })) as never,
    )
    vi.spyOn(client, 'request').mockResolvedValue([])
    vi.spyOn(client, 'getTransactionReceipt').mockResolvedValue({
      status: 'success',
      logs: [],
    } as never)
    const params = {
      client,
      chainId: 1,
      vaultAddress: getAddress(vaultAddress),
      fromBlock: blockNumber,
      toBlock: blockNumber,
      sources: [],
    }
    expect(await getVaultDonationTransfers(params)).toEqual([])
    const result = await getVaultDonationTransfers({ ...params, confirmedTransactions: [tx] })
    expect(result.map((transfer) => transfer.transactionHash)).toEqual([tx])
  })
  it('excludes deposits and unrelated tokens, and includes native gifts', async () => {
    const client = clientWithReads()
    vi.spyOn(client, 'getContractEvents').mockResolvedValue([
      {
        address: tracker0,
        args: { from: donor, to: vaultAddress, value: 10n },
        blockNumber,
        transactionHash: tx,
        logIndex: 0,
      },
      {
        address: '0x3333333333333333333333333333333333333333',
        args: { from: donor, to: vaultAddress, value: 10n },
        blockNumber,
        transactionHash: tx,
        logIndex: 1,
      },
    ] as never)
    vi.spyOn(client, 'request').mockResolvedValue([
      {
        action: { from: donor, to: vaultAddress, value: '0xa', callType: 'call' },
        type: 'call',
        blockNumber: Number(blockNumber),
        transactionHash: tx,
      },
    ])
    const receipt = vi
      .spyOn(client, 'getTransactionReceipt')
      .mockResolvedValue({ status: 'success', logs: [] } as never)
    const params = {
      client,
      chainId: 1,
      vaultAddress: getAddress(vaultAddress),
      fromBlock: blockNumber,
      toBlock: blockNumber,
      sources: [donor.toLowerCase()],
    }
    const gifts = await getVaultDonationTransfers(params)
    expect(gifts.map((gift) => gift.token)).toEqual([tracker0, zeroAddress])
    receipt.mockResolvedValue({
      status: 'success',
      logs: [
        {
          address: vaultAddress,
          data: encodeAbiParameters([{ type: 'uint256' }], [10n]),
          topics: encodeEventTopics({
            abi: HypoVaultAbi,
            eventName: 'DepositRequested',
            args: { user: donor },
          }),
        },
      ],
    } as never)
    expect(await getVaultDonationTransfers(params)).toEqual([])
    receipt.mockResolvedValue({ status: 'reverted', logs: [] } as never)
    expect(await getVaultDonationTransfers(params)).toEqual([])
  })
})
