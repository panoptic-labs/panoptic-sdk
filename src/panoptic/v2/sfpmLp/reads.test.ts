import type { PublicClient } from 'viem'
import { describe, expect, it } from 'vitest'

import { buildSfpmLpTokenId, decodeSfpmLpLegs, sfpmLpLegLiquidity } from './position'
import { getSfpmLpPosition } from './reads'

// tickSpacing 10, vegoid 4.
const POOL_ID = 0xa0488e6a0c2ddn
const tokenId = buildSfpmLpTokenId({
  poolId: POOL_ID,
  ranges: [{ tickLower: 200_000n, tickUpper: 200_100n, asset: 0n }],
})
const NOW = 200n
const OPENED = 100n
const STORED_PREMIUM_TICK = 8388607
const LIQUIDITY = 10n ** 18n
const Q64 = 1n << 64n

/**
 * Fake client: the chunk holds LIQUIDITY with nothing removed. The stored premium
 * accumulator is 1000 at the open block and 3000 now (a collect happened since);
 * the live one is 3500 now.
 */
function fakeClient(): PublicClient {
  const premium = (blockNumber: bigint, atTick: number) => {
    const value = blockNumber === OPENED ? 1000n : atTick === STORED_PREMIUM_TICK ? 3000n : 3500n
    return [value * Q64, 2n * value * Q64] as const
  }
  type Call = { functionName: string; args: readonly unknown[] }
  const answer = (call: Call, blockNumber: bigint) => {
    switch (call.functionName) {
      case 'balanceOf':
        return 5n
      case 'getCurrentTick':
        return blockNumber === OPENED ? 199_990 : 200_050
      case 'getAccountLiquidity':
        return LIQUIDITY
      case 'getAccountPremium':
        return premium(blockNumber, call.args[5] as number)
      default:
        throw new Error(`unexpected ${call.functionName}`)
    }
  }
  return {
    getBlock: async () => ({ number: NOW, hash: '0x01', timestamp: 1n }),
    multicall: async ({ contracts, blockNumber }: { contracts: Call[]; blockNumber: bigint }) =>
      contracts.map((call) => answer(call, blockNumber)),
    readContract: async (call: Call & { blockNumber: bigint }) => answer(call, call.blockNumber),
  } as unknown as PublicClient
}

const params = {
  client: fakeClient(),
  sfpmAddress: '0x00000000000005E4693aDc8Ec0f12D686f728198',
  poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
  account: '0x000000000000000000000000000000000000dEaD',
  tokenId,
} as const

describe('getSfpmLpPosition', () => {
  it('omits opening data without openedAtBlock', async () => {
    const position = await getSfpmLpPosition(params)
    expect(position.openingTick).toBeUndefined()
    expect(position.legs[0]?.lifetimeFees0).toBeUndefined()
  })

  it('reads lifetime fees from the accumulator at the open block, past collects', async () => {
    const position = await getSfpmLpPosition({ ...params, openedAtBlock: OPENED })
    const [leg] = position.legs
    if (!leg) throw new Error('no leg')
    expect(position.openingTick).toBe(199_990n)
    // Pending covers 3000 → 3500; lifetime covers 1000 → 3500, i.e. five times as much.
    expect(leg.attributedFees0).toBeGreaterThan(0n)
    expect(leg.lifetimeFees0).toBe(leg.attributedFees0 * 5n)
    expect(leg.lifetimeFees1).toBe(leg.attributedFees1 * 5n)
  })
})

describe('getSfpmLpPosition with several size changes', () => {
  // Minted 3 at block 100, increased by 2 at block 150 (balance 5). Stored premium is
  // 1000 at 100 and 2000 at 150 (the increase reset it); live is 2500 now.
  const [leg] = decodeSfpmLpLegs(tokenId)
  if (!leg) throw new Error('no leg')
  const liquidity3 = sfpmLpLegLiquidity(leg, 3n * 10n ** 18n)
  const liquidity5 = sfpmLpLegLiquidity(leg, 5n * 10n ** 18n)
  type Call = { functionName: string; args: readonly unknown[] }
  const answer = (call: Call, blockNumber: bigint) => {
    switch (call.functionName) {
      case 'balanceOf':
        return 5n * 10n ** 18n
      case 'getCurrentTick':
        return blockNumber === 100n ? 199_990 : blockNumber === 150n ? 200_020 : 200_050
      case 'getAccountLiquidity':
        return liquidity5
      case 'getAccountPremium': {
        const stored = (call.args[5] as number) === STORED_PREMIUM_TICK
        const value = blockNumber === 100n ? 1000n : blockNumber === 150n || stored ? 2000n : 2500n
        return [value * Q64, 0n] as const
      }
      default:
        throw new Error(`unexpected ${call.functionName}`)
    }
  }
  const client = {
    getBlock: async () => ({ number: NOW, hash: '0x01', timestamp: 1n }),
    multicall: async ({ contracts, blockNumber }: { contracts: Call[]; blockNumber: bigint }) =>
      contracts.map((call) => answer(call, blockNumber)),
    readContract: async (call: Call & { blockNumber: bigint }) => answer(call, call.blockNumber),
  } as unknown as PublicClient

  it('prices each span at its own liquidity and returns the ticks of each change', async () => {
    const position = await getSfpmLpPosition({
      ...params,
      client,
      // Out of order and split within a block, as an event list can be.
      sizeChanges: [
        { blockNumber: 150n, sizeDelta: 2n * 10n ** 18n },
        { blockNumber: 100n, sizeDelta: 3n * 10n ** 18n },
      ],
    })
    expect(position.history).toEqual([
      {
        blockNumber: 100n,
        sizeDelta: 3n * 10n ** 18n,
        minted: 3n * 10n ** 18n,
        burned: 0n,
        tick: 199_990n,
      },
      {
        blockNumber: 150n,
        sizeDelta: 2n * 10n ** 18n,
        minted: 2n * 10n ** 18n,
        burned: 0n,
        tick: 200_020n,
      },
    ])
    expect(position.openingTick).toBe(199_990n)
    expect(position.legs[0]?.lifetimeFees0).toBe(1000n * liquidity3 + 500n * liquidity5)
  })

  const E18 = 10n ** 18n

  it('keeps a collect (same-transaction mint and burn) out of the cash flows', async () => {
    const position = await getSfpmLpPosition({
      ...params,
      client,
      sizeChanges: [
        { blockNumber: 100n, sizeDelta: 5n * E18, transactionHash: '0xa' },
        { blockNumber: 150n, sizeDelta: 5n * E18, transactionHash: '0xb' },
        { blockNumber: 150n, sizeDelta: -5n * E18, transactionHash: '0xB' },
      ],
    })
    expect(position.history?.[1]).toMatchObject({ sizeDelta: 0n, minted: 0n, burned: 0n })
    expect(position.legs[0]?.lifetimeFees0).toBeDefined()
  })

  it('keeps separate same-block deposits and withdrawals but omits lifetime fees', async () => {
    const position = await getSfpmLpPosition({
      ...params,
      client,
      sizeChanges: [
        { blockNumber: 100n, sizeDelta: 3n * E18, transactionHash: '0xa' },
        { blockNumber: 150n, sizeDelta: 4n * E18, transactionHash: '0xb' },
        { blockNumber: 150n, sizeDelta: -2n * E18, transactionHash: '0xc' },
      ],
    })
    expect(position.history?.[1]).toMatchObject({
      sizeDelta: 2n * E18,
      minted: 4n * E18,
      burned: 2n * E18,
    })
    expect(position.legs[0]?.lifetimeFees0).toBeUndefined()
  })

  it('omits the history when it does not add up to the balance', async () => {
    const position = await getSfpmLpPosition({
      ...params,
      client,
      sizeChanges: [{ blockNumber: 100n, sizeDelta: 3n * E18 }],
    })
    expect(position.history).toBeUndefined()
    expect(position.legs[0]?.lifetimeFees0).toBeUndefined()
  })

  it('ignores changes after the read block', async () => {
    const position = await getSfpmLpPosition({
      ...params,
      client,
      sizeChanges: [
        { blockNumber: 100n, sizeDelta: 3n * E18 },
        { blockNumber: 150n, sizeDelta: 2n * E18 },
        { blockNumber: NOW + 1n, sizeDelta: 7n * E18 },
      ],
    })
    expect(position.history).toHaveLength(2)
  })
})

describe('getSfpmLpPosition openedAtBlock', () => {
  it('ignores an opening block after the read block', async () => {
    const position = await getSfpmLpPosition({ ...params, openedAtBlock: NOW + 1n })
    expect(position.history).toBeUndefined()
    expect(position.legs[0]?.lifetimeFees0).toBeUndefined()
  })
})
