import { type Address, type PublicClient, padHex, zeroAddress } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { riskEngineAbi } from '../../../generated'
import { getOracleRiskParameters, getPool, getRiskParameters } from './pool'
import { riskEngineMulticall } from './riskEngineDeployment'

const blueChip = '0x000000000000ffE5eFdB5AE76b9200263C58b4c0'
const xStocks = '0x000000000000FfADa7c641E2aD6B13b51b50Cc94'
const blueChipImplementation = '0x000000000000F0b287c19f606bC3A471F260c502'
const xStocksImplementation = '0x000000000000F4901018445c697e1e358DAb8dAD'
const poolAddress = '0x1111111111111111111111111111111111111111'
const blockNumber = 123n
const meta = { blockNumber, blockTimestamp: 1000n, blockHash: padHex('0x01') }
const tiers = [
  {
    address: blueChip,
    implementation: blueChipImplementation,
    margin: 1_000_000n,
    ticks: 724n,
    spot: 60n,
  },
  {
    address: xStocks,
    implementation: xStocksImplementation,
    margin: 2_500_000n,
    ticks: 953n,
    spot: 120n,
  },
] as const

function fixture(implementation: Address = blueChipImplementation) {
  const getStorageAt = vi.fn().mockResolvedValue(padHex(implementation))
  const multicall = vi.fn().mockResolvedValue([])
  const client = {
    getStorageAt,
    multicall,
    getBlockNumber: vi.fn().mockResolvedValue(blockNumber),
    getBlock: vi
      .fn()
      .mockResolvedValue({ number: blockNumber, timestamp: 1000n, hash: meta.blockHash }),
  } as unknown as PublicClient
  return { client, getStorageAt, multicall }
}

describe('proxy RiskEngine parameters', () => {
  it.each(tiers)('resolves collateral and oracle parameters for $address', async (tier) => {
    const { client, getStorageAt, multicall } = fixture(tier.implementation)
    multicall.mockResolvedValue([[0n, 0]])
    const risk = await getRiskParameters({
      client,
      poolAddress,
      riskEngineAddress: tier.address,
      builderCode: 42n,
      blockNumber,
      _meta: meta,
    })
    expect(risk).toMatchObject({
      collateralRequirement: 2_000_000n,
      maintenanceMargin: tier.margin,
      commissionRate: 3n,
      itmSpreadMultiplier: 100_000n,
      targetUtilization: 6_666_667n,
      saturatedUtilization: 9_000_000n,
      mintBuffer: { numerator: 10_750_000n, denominator: 10_000_000n },
      _meta: meta,
    })
    expect(multicall).toHaveBeenCalledWith(
      expect.objectContaining({
        contracts: [
          expect.objectContaining({
            address: poolAddress,
            functionName: 'getRiskParameters',
            args: [42n],
          }),
        ],
        blockNumber,
        allowFailure: false,
      }),
    )
    multicall.mockClear()
    const oracle = await getOracleRiskParameters({
      client,
      riskEngineAddress: tier.address,
      blockNumber,
    })
    expect(oracle).toMatchObject({
      emaPeriods: {
        spot: tier.spot,
        fast: tier.spot * 2n,
        slow: tier.spot * 4n,
        eons: tier.spot * 16n,
      },
      maxTicksDelta: tier.ticks,
      maxClampDelta: 149n,
    })
    expect(multicall).not.toHaveBeenCalled()
    expect(getStorageAt).toHaveBeenCalledWith(
      expect.objectContaining({
        address: tier.address.toLowerCase(),
        blockNumber,
      }),
    )
  })

  it.each(tiers)('loads pools without calling removed getters for $address', async (tier) => {
    const { client, multicall } = fixture(tier.implementation)
    const live = [
      0,
      0,
      [1000n, 100n, 0n, 1000n],
      1000n,
      1n,
      [2000n, 200n, 0n, 1000n],
      2000n,
      2n,
      999n,
    ]
    multicall.mockResolvedValue(live.map((result) => ({ status: 'success', result })))
    const pool = await getPool({
      client,
      poolAddress,
      chainId: 1n,
      blockNumber,
      _meta: meta,
      poolMetadata: {
        poolKeyBytes: padHex(poolAddress),
        poolId: 1n,
        collateralToken0Address: poolAddress,
        collateralToken1Address: poolAddress,
        riskEngineAddress: tier.address,
        token0Asset: zeroAddress,
        token1Asset: poolAddress,
        token0Symbol: 'ETH',
        token1Symbol: 'USDC',
        token0Decimals: 18n,
        token1Decimals: 6n,
        token0Name: 'Ether',
        token1Name: 'USD Coin',
        underlyingPoolId: poolAddress,
        isV4: false,
        tickSpacing: 10n,
        fee: 500n,
        sfpmAddress: poolAddress,
      },
    })
    expect(pool.riskEngine).toMatchObject({
      collateralRequirement: 2_000_000n,
      maintenanceMargin: tier.margin,
      commissionRate: 3n,
      premiumFeeRate: 250n,
      vegoid: 8n,
      maxSpread: 90_000n,
    })
    expect(pool.uniswapPoolLiquidity).toBe(999n)
    expect(multicall.mock.calls[0][0].contracts).toHaveLength(9)
    expect(multicall.mock.calls[0][0].contracts).not.toContainEqual(
      expect.objectContaining({ address: tier.address }),
    )
  })

  it('resolves historical implementations at the requested block without caching proxy values', async () => {
    const { client, getStorageAt } = fixture()
    getStorageAt
      .mockResolvedValueOnce(padHex(blueChipImplementation))
      .mockResolvedValueOnce(padHex(xStocksImplementation))
    const contracts = [
      { address: blueChip, abi: riskEngineAbi, functionName: 'MAINT_MARGIN_RATE' },
    ] as const
    expect(
      await riskEngineMulticall(client, { contracts, blockNumber: 100n, allowFailure: false }),
    ).toEqual([1_000_000n])
    expect(
      await riskEngineMulticall(client, { contracts, blockNumber: 200n, allowFailure: false }),
    ).toEqual([2_500_000n])
    expect(getStorageAt.mock.calls.map(([params]) => params.blockNumber)).toEqual([100n, 200n])
  })

  it.each([undefined, padHex(zeroAddress), padHex(poolAddress)])(
    'rejects an unknown implementation (%s)',
    async (slot) => {
      const { client, getStorageAt, multicall } = fixture()
      getStorageAt.mockResolvedValue(slot)
      await expect(
        riskEngineMulticall(client, {
          contracts: [
            { address: blueChip, abi: riskEngineAbi, functionName: 'SELLER_COLLATERAL_RATIO' },
          ],
          blockNumber,
          allowFailure: true,
        }),
      ).rejects.toThrow('Unknown RiskEngine implementation')
      expect(multicall).not.toHaveBeenCalled()
    },
  )

  it('propagates RPC failures instead of substituting default parameters', async () => {
    const { client, getStorageAt } = fixture()
    getStorageAt.mockRejectedValue(new Error('RPC unavailable'))
    await expect(
      riskEngineMulticall(client, {
        contracts: [
          { address: blueChip, abi: riskEngineAbi, functionName: 'SELLER_COLLATERAL_RATIO' },
        ],
        blockNumber,
      }),
    ).rejects.toThrow('RPC unavailable')
  })

  it('preserves live failures and ordering when mixing legacy and proxy calls', async () => {
    const { client, multicall, getStorageAt } = fixture()
    const failure = { status: 'failure', error: new Error('live read failed') }
    multicall.mockResolvedValue([failure, { status: 'success', result: 123n }])
    const result = await riskEngineMulticall(client, {
      contracts: [
        { address: blueChip, abi: riskEngineAbi, functionName: 'GUARDIAN' },
        { address: blueChip, abi: riskEngineAbi, functionName: 'NOTIONAL_FEE' },
        { address: poolAddress, abi: riskEngineAbi, functionName: 'MAINT_MARGIN_RATE' },
      ],
      blockNumber,
    })
    expect(result).toEqual([
      failure,
      { status: 'success', result: 3 },
      { status: 'success', result: 123n },
    ])
    expect(getStorageAt).toHaveBeenCalledTimes(1)
  })
})
