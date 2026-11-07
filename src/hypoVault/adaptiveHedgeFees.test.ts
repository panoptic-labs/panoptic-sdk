import { createPublicClient, custom, defineChain, toHex } from 'viem'
import type * as ViemActions from 'viem/actions'
import { arbitrum, base, mainnet } from 'viem/chains'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as PoolReads from '../panoptic/v2/reads/pool'
import {
  getAdaptiveHedgeFeeQuote,
  getHedgeShock,
  resolveAdaptiveHedgeFeeQuote,
  resolveHedgeShock,
  VOLUSDC_HEDGE_FEE_POLICY,
  VOLUSDC_INCIDENT_GAS_ENVELOPE,
} from './adaptiveHedgeFees'
import {
  applyVaultTransactionGasCostLimit,
  getVaultTransactionReplacementFeeQuote,
  validateVaultSignedTransactionFeeCaps,
} from './transactionFees'

const mocks = vi.hoisted(() => ({
  getBlock: vi.fn(),
  readContract: vi.fn(),
  getPoolMetadata: vi.fn(),
}))
vi.mock('viem/actions', async (original) => ({
  ...(await original<typeof ViemActions>()),
  getBlock: mocks.getBlock,
  readContract: mocks.readContract,
}))
vi.mock('../panoptic/v2/reads/pool', async (original) => ({
  ...(await original<typeof PoolReads>()),
  getPoolMetadata: mocks.getPoolMetadata,
}))

const price = 10_000n

describe('volUSDC shock fees', () => {
  it('reads separate p75/p90 columns in one urgent RPC and rejects incomplete history', async () => {
    const history = {
      oldestBlock: '0x1',
      baseFeePerGas: Array.from({ length: 6 }, () => toHex(1_000_000_000n)),
      gasUsedRatio: [0.5, 0.5, 0.5, 0.5, 0.5],
      reward: [1n, 2n, 3n, 4n, 5n].map((value) => [
        toHex(value * 1_000_000_000n),
        toHex((100n + value) * 1_000_000_000n),
      ]),
    }
    let requested: unknown
    const client = createPublicClient({
      chain: mainnet,
      transport: custom({
        request: async ({ params }) => {
          requested = params
          return history
        },
      }),
    })
    const quote = await getAdaptiveHedgeFeeQuote(client, true)
    expect(requested).toEqual(['0x5', 'latest', [75, 90]])
    expect(quote.maxPriorityFeePerGas).toBe(103_000_000_000n)
    expect(quote.competitivePriorityFeePerGas).toBe(3_000_000_000n)
    history.reward[2] = [toHex(3_000_000_000n)]
    await expect(getAdaptiveHedgeFeeQuote(client, true)).rejects.toThrow('Incomplete')
  })
  it.each([0n, 1n] as const)('detects the same economic move in token ordering %s', (asset) => {
    const previous = asset === 0n ? price : 10_100n
    const current = asset === 0n ? 10_100n : price
    expect(
      resolveHedgeShock({
        sqrtPriceX96: current,
        previousSqrtPriceX96: previous,
        timestamp: 1_000n,
        priceAssetIndex: asset,
      }),
    ).toEqual({ shocked: true, active: true, activeUntil: 2_200n })
  })

  it('uses the price asset denominator at the threshold', () => {
    expect(
      resolveHedgeShock({
        sqrtPriceX96: 10_100n,
        previousSqrtPriceX96: price,
        timestamp: 1n,
        priceAssetIndex: 1n,
      }).shocked,
    ).toBe(false)
  })

  it('holds the latch for twenty minutes, extends it on another shock, then expires', () => {
    const quiet = {
      sqrtPriceX96: price,
      previousSqrtPriceX96: price,
      priceAssetIndex: 0n as const,
      activeUntil: 2_200n,
    }
    expect(resolveHedgeShock({ ...quiet, timestamp: 2_199n }).active).toBe(true)
    expect(resolveHedgeShock({ ...quiet, timestamp: 2_200n }).active).toBe(false)
    expect(
      resolveHedgeShock({ ...quiet, timestamp: 2_000n, sqrtPriceX96: 10_200n }).activeUntil,
    ).toBe(3_200n)
  })

  it('uses the p75 or p90 median directly with their respective floors', () => {
    const ordinary = resolveAdaptiveHedgeFeeQuote({
      baseFeePerGas: 1n,
      rewards: [100n, 500n, 200n, 300n, 400n],
      urgent: false,
    })
    expect(ordinary.maxPriorityFeePerGas).toBe(100_000_000n)
    const urgent = resolveAdaptiveHedgeFeeQuote({
      baseFeePerGas: 200_000_000_000n,
      rewards: [
        80_000_000_000n,
        96_000_000_001n,
        100_000_000_000n,
        96_000_000_001n,
        96_000_000_001n,
      ],
      urgent: true,
    })
    expect(urgent.rawPriorityFeePerGas).toBe(96_000_000_001n)
    expect(urgent.maxPriorityFeePerGas).toBe(96_000_000_001n)
    expect(urgent.maxFeePerGas).toBe(496_000_000_001n)
    expect(urgent.minimumMaxFeePerGas).toBe(296_000_000_001n)
    expect(urgent.minimumPriorityFeePerGas).toBe(96_000_000_001n)
    expect(
      resolveAdaptiveHedgeFeeQuote({ baseFeePerGas: 1n, rewards: [1n], urgent: true })
        .maxPriorityFeePerGas,
    ).toBe(3_000_000_000n)
  })

  it('keeps the routine budget while explicitly bounding a higher-fee risk intent', () => {
    const quote = resolveAdaptiveHedgeFeeQuote({
      baseFeePerGas: 200_000_000_000n,
      rewards: [96_000_000_000n],
      urgent: true,
    })
    expect(() => applyVaultTransactionGasCostLimit(quote, 2_000_000n)).toThrow('gas-cost limit')
    const allowed = applyVaultTransactionGasCostLimit(quote, 2_000_000n, VOLUSDC_HEDGE_FEE_POLICY)
    expect(allowed.maxFeePerGas * 2_000_000n * 9n).toBeLessThanOrEqual(
      VOLUSDC_INCIDENT_GAS_ENVELOPE * 8n,
    )
    expect(
      validateVaultSignedTransactionFeeCaps(
        {
          gasLimit: 2_000_000n,
          maxFeePerGas: allowed.maxFeePerGas,
          maxPriorityFeePerGas: allowed.maxPriorityFeePerGas,
        },
        quote,
        VOLUSDC_HEDGE_FEE_POLICY,
      ),
    ).toEqual({ valid: true })
    expect(
      validateVaultSignedTransactionFeeCaps(
        {
          gasLimit: 2_000_000n,
          maxFeePerGas: allowed.maxFeePerGas,
          maxPriorityFeePerGas: allowed.maxPriorityFeePerGas,
        },
        quote,
      ).valid,
    ).toBe(false)
  })

  it('bumps both caps, preserves base-fee headroom and refuses an unaffordable replacement', () => {
    const quote = resolveAdaptiveHedgeFeeQuote({
      baseFeePerGas: 100_000_000_000n,
      rewards: [40_000_000_000n],
      urgent: true,
    })
    const replacement = getVaultTransactionReplacementFeeQuote({
      originalQuote: { maxFeePerGas: 200_000_000_000n, maxPriorityFeePerGas: 45_000_000_000n },
      historicalQuote: quote,
      gasLimit: 2_000_000n,
      feePolicy: VOLUSDC_HEDGE_FEE_POLICY,
    })
    expect(replacement.maxFeePerGas).toBeGreaterThanOrEqual(225_000_000_000n)
    expect(replacement.maxPriorityFeePerGas).toBeGreaterThanOrEqual(50_625_000_000n)
    expect(() =>
      getVaultTransactionReplacementFeeQuote({
        originalQuote: replacement,
        historicalQuote: quote,
        gasLimit: 20_000_000n,
        feePolicy: VOLUSDC_HEDGE_FEE_POLICY,
      }),
    ).toThrow('GasCostCapExceeded')
  })
})

describe('approximate shock lookback', () => {
  const head = 26_300_833n
  const poolAddress = '0x1111111111111111111111111111111111111111' as const
  const underlyingPool = '0x2222222222222222222222222222222222222222' as const
  const hash = `0x${'ab'.repeat(32)}` as const
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.getBlock.mockResolvedValue({ number: head, hash, timestamp: 10_000n })
    mocks.getPoolMetadata.mockResolvedValue({ isV4: false, underlyingPoolId: underlyingPool })
    mocks.readContract.mockImplementation(
      async (_client: unknown, args: { blockNumber: bigint }) => [
        args.blockNumber === head ? 10_200n : 10_000n,
        0n,
        0,
        0,
        0,
        0,
        true,
      ],
    )
  })

  it.each([
    [mainnet.name, mainnet.blockTime, 50n],
    [base.name, base.blockTime, 300n],
    [arbitrum.name, arbitrum.blockTime, 2_400n],
    ['13-second blocks', 13_000, 47n],
    ['20-minute blocks', 1_200_000, 1n],
  ] as const)(
    'uses %s metadata (%s ms) for a %s-block lookback with only one header read',
    async (_network, blockTime, blocks) => {
      const client = createPublicClient({
        chain: defineChain({ ...mainnet, blockTime }),
        transport: custom({
          request: async () => {
            throw new Error('Unexpected direct RPC')
          },
        }),
      })
      const shock = await getHedgeShock({ client, poolAddress, priceAssetIndex: 0n })
      expect(shock).toMatchObject({
        active: true,
        shocked: true,
        blockNumber: head,
        blockHash: hash,
        timestamp: 10_000n,
        activeUntil: 11_200n,
      })
      expect(mocks.getBlock).toHaveBeenCalledTimes(1)
      expect(mocks.getBlock).toHaveBeenCalledWith(client, { blockTag: 'latest' })
      expect(mocks.readContract.mock.calls.map(([, args]) => args.blockNumber)).toEqual([
        head,
        head - blocks,
      ])
      expect(mocks.readContract).toHaveBeenCalledTimes(2)
      expect(mocks.readContract).toHaveBeenCalledWith(
        client,
        expect.objectContaining({
          address: underlyingPool,
          functionName: 'slot0',
          blockNumber: head - blocks,
        }),
      )
    },
  )

  it('clamps the lookback at genesis on a young chain', async () => {
    mocks.getBlock.mockResolvedValueOnce({ number: 10n, hash, timestamp: 120n })
    const client = createPublicClient({
      chain: mainnet,
      transport: custom({ request: async () => undefined }),
    })
    await getHedgeShock({ client, poolAddress, priceAssetIndex: 1n })
    expect(mocks.readContract.mock.calls.map(([, args]) => args.blockNumber)).toEqual([10n, 0n])
  })

  it.each([undefined, 0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'does not guess a block time when metadata is %s',
    async (blockTime) => {
      const client = createPublicClient({
        chain: defineChain({ ...mainnet, blockTime }),
        transport: custom({ request: async () => undefined }),
      })
      await expect(getHedgeShock({ client, poolAddress, priceAssetIndex: 0n })).rejects.toThrow(
        'valid network block time',
      )
      expect(mocks.getBlock).not.toHaveBeenCalled()
      expect(mocks.readContract).not.toHaveBeenCalled()
    },
  )
})
