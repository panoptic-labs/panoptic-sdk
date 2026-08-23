import { describe, expect, it, vi } from 'vitest'

import { PanopticError } from '../errors'
import { addLegToTokenId, decodeAllLegs } from '../tokenId/encoding'
import {
  type CollateralStrategyKind,
  type EstimateCollateralBreakdownParams,
  type StrategyGroup,
  apportion,
  classifyStrategyGroups,
  collateralRuleKindFor,
  estimateCollateralBreakdown,
  isolateGroupTokenId,
} from './collateralBreakdown'
import { REQUIRED_BASE_ERROR_SENTINEL } from './collateralEstimate'

const POOL_ID = 0x1234_5678_9abc_def0n

interface LegSpec {
  isLong?: boolean
  /** 0 = call, 1 = put */
  tokenType?: bigint
  strike?: bigint
  /** 0 makes it a loan (short) / credit (long) */
  width?: bigint
  asset?: bigint
  optionRatio?: bigint
  /** Defaults to self (no partner) */
  riskPartner?: bigint
}

/** Build a tokenId from leg specs, defaulting everything that isn't the point of a test. */
const buildTokenId = (specs: LegSpec[]): bigint =>
  specs.reduce<bigint>((acc, spec, i) => {
    const index = BigInt(i)
    return addLegToTokenId(acc, {
      index,
      asset: spec.asset ?? 0n,
      tokenType: spec.tokenType ?? 0n,
      optionRatio: spec.optionRatio ?? 1n,
      isLong: spec.isLong ? 1n : 0n,
      riskPartner: spec.riskPartner ?? index,
      strike: spec.strike ?? 100n,
      width: spec.width ?? 2n,
    })
  }, POOL_ID)

/** Two mutually-partnered legs at indices 0 and 1. */
const pair = (a: LegSpec, b: LegSpec): bigint =>
  buildTokenId([
    { ...a, riskPartner: 1n },
    { ...b, riskPartner: 0n },
  ])

const kinds = (groups: StrategyGroup[]): CollateralStrategyKind[] => groups.map((g) => g.kind)

describe('classifyStrategyGroups — standalone legs', () => {
  it('names the four unpartnered option kinds', () => {
    expect(kinds(classifyStrategyGroups(buildTokenId([{ tokenType: 0n }])))).toEqual(['shortCall'])
    expect(kinds(classifyStrategyGroups(buildTokenId([{ tokenType: 1n }])))).toEqual(['shortPut'])
    expect(kinds(classifyStrategyGroups(buildTokenId([{ tokenType: 0n, isLong: true }])))).toEqual([
      'longCall',
    ])
    expect(kinds(classifyStrategyGroups(buildTokenId([{ tokenType: 1n, isLong: true }])))).toEqual([
      'longPut',
    ])
  })

  it('distinguishes a loan from a credit by direction at width 0', () => {
    expect(kinds(classifyStrategyGroups(buildTokenId([{ width: 0n }])))).toEqual(['loan'])
    expect(kinds(classifyStrategyGroups(buildTokenId([{ width: 0n, isLong: true }])))).toEqual([
      'credit',
    ])
  })

  it('charges every standalone leg (no single charged index)', () => {
    const [group] = classifyStrategyGroups(buildTokenId([{}]))
    expect(group.chargedLegIndex).toBeNull()
    expect(group.legIndices).toEqual([0n])
  })

  it('keeps unpartnered legs in separate groups', () => {
    const groups = classifyStrategyGroups(buildTokenId([{ tokenType: 0n }, { tokenType: 1n }]))
    expect(kinds(groups)).toEqual(['shortCall', 'shortPut'])
  })
})

describe('classifyStrategyGroups — pure option pairs', () => {
  it('classifies two short options at different strikes as a strangle', () => {
    const groups = classifyStrategyGroups(
      pair({ tokenType: 0n, strike: 200n }, { tokenType: 1n, strike: 100n }),
    )
    expect(kinds(groups)).toEqual(['strangle'])
    // Both legs pay a reduced requirement, so neither is "the" charged leg.
    expect(groups[0].chargedLegIndex).toBeNull()
    expect(groups[0].legIndices).toEqual([0n, 1n])
  })

  it('classifies two short options at the same strike as a straddle', () => {
    expect(
      kinds(
        classifyStrategyGroups(
          pair({ tokenType: 0n, strike: 100n }, { tokenType: 1n, strike: 100n }),
        ),
      ),
    ).toEqual(['straddle'])
  })

  it('treats straddle and strangle as one collateral rule', () => {
    expect(collateralRuleKindFor('straddle')).toBe('strangle')
    expect(collateralRuleKindFor('strangle')).toBe('strangle')
  })

  it('classifies a same-strike long/short across tokenTypes as a synthetic, charging the short leg', () => {
    const groups = classifyStrategyGroups(
      pair({ tokenType: 0n, isLong: true, strike: 100n }, { tokenType: 1n, strike: 100n }),
    )
    expect(kinds(groups)).toEqual(['synthetic'])
    expect(groups[0].chargedLegIndex).toBe(1n)
  })

  it('rejects a synthetic whose legs are at different strikes', () => {
    // The contract requires the SAME strike; without it the pairing is not
    // recognized and both legs are charged standalone.
    expect(
      kinds(
        classifyStrategyGroups(
          pair({ tokenType: 0n, isLong: true, strike: 200n }, { tokenType: 1n, strike: 100n }),
        ),
      ),
    ).toEqual(['unrecognizedPair'])
  })

  it('classifies a same-tokenType long/short as a spread, charging the long leg', () => {
    const groups = classifyStrategyGroups(
      pair({ tokenType: 0n, strike: 200n }, { tokenType: 0n, isLong: true, strike: 100n }),
    )
    expect(kinds(groups)).toEqual(['spread'])
    expect(groups[0].chargedLegIndex).toBe(1n)
  })

  it('does not recognize two LONG options across tokenTypes (a long strangle)', () => {
    // The contract's cross-tokenType branch only nets two SHORTS (strangle) or a
    // same-strike long/short (synthetic). A partnered long strangle is an
    // ordinary position that simply has no capital-efficiency pairing — each leg
    // is charged individually. It is the most common trade to land in the
    // fallback, so it must not be mistaken for a mis-built position.
    expect(
      kinds(
        classifyStrategyGroups(
          pair(
            { tokenType: 0n, isLong: true, strike: 200n },
            { tokenType: 1n, isLong: true, strike: 100n },
          ),
        ),
      ),
    ).toEqual(['unrecognizedPair'])
  })

  it('does not recognize two same-direction, same-tokenType options', () => {
    expect(
      kinds(
        classifyStrategyGroups(
          pair({ tokenType: 0n, strike: 200n }, { tokenType: 0n, strike: 100n }),
        ),
      ),
    ).toEqual(['unrecognizedPair'])
  })
})

describe('classifyStrategyGroups — funded composites', () => {
  const composite = (optionIsLong: boolean, fundingIsLong: boolean) =>
    classifyStrategyGroups(
      pair({ isLong: optionIsLong, width: 2n }, { isLong: fundingIsLong, width: 0n }),
    )

  it('pairs a long option with a credit as a prepaid long option', () => {
    const groups = composite(true, true)
    expect(kinds(groups)).toEqual(['prepaidLongOption'])
    // Only the option leg is charged; the funding leg returns 0 on-chain.
    expect(groups[0].chargedLegIndex).toBe(0n)
  })

  it('pairs a short option with a credit as a cash-secured option', () => {
    expect(kinds(composite(false, true))).toEqual(['cashSecuredOption'])
  })

  it('pairs a long option with a loan as an option-protected loan', () => {
    expect(kinds(composite(true, false))).toEqual(['optionProtectedLoan'])
  })

  it('pairs a short option with a loan as an upfront short option', () => {
    expect(kinds(composite(false, false))).toEqual(['upfrontShortOption'])
  })

  it('classifies identically whichever leg comes first', () => {
    // The contract evaluates the same pair from both indices; the classifier
    // must not depend on which one it sees first.
    const optionFirst = classifyStrategyGroups(
      pair({ isLong: false, width: 2n }, { isLong: true, width: 0n }),
    )
    const fundingFirst = classifyStrategyGroups(
      pair({ isLong: true, width: 0n }, { isLong: false, width: 2n }),
    )
    expect(kinds(optionFirst)).toEqual(['cashSecuredOption'])
    expect(kinds(fundingFirst)).toEqual(['cashSecuredOption'])
    // ...and both point the charge at the option leg, wherever it sits.
    expect(optionFirst[0].chargedLegIndex).toBe(0n)
    expect(fundingFirst[0].chargedLegIndex).toBe(1n)
  })

  it('requires matching tokenTypes for a composite', () => {
    expect(
      kinds(
        classifyStrategyGroups(
          pair({ width: 2n, tokenType: 0n }, { width: 0n, isLong: true, tokenType: 1n }),
        ),
      ),
    ).toEqual(['unrecognizedPair'])
  })

  it('does not recognize two width-0 legs partnered together', () => {
    expect(kinds(classifyStrategyGroups(pair({ width: 0n }, { width: 0n, isLong: true })))).toEqual(
      ['unrecognizedPair'],
    )
  })
})

describe('classifyStrategyGroups — partnership gating', () => {
  it('rejects a pairing whose legs hold different assets', () => {
    expect(
      kinds(
        classifyStrategyGroups(
          pair(
            { tokenType: 0n, asset: 0n, strike: 200n },
            { tokenType: 1n, asset: 1n, strike: 100n },
          ),
        ),
      ),
    ).toEqual(['unrecognizedPair'])
  })

  it('rejects a pairing whose legs hold different option ratios', () => {
    expect(
      kinds(
        classifyStrategyGroups(
          pair(
            { tokenType: 0n, optionRatio: 1n, strike: 200n },
            { tokenType: 1n, optionRatio: 2n, strike: 100n },
          ),
        ),
      ),
    ).toEqual(['unrecognizedPair'])
  })

  it('treats a non-mutual partnership as two standalone legs', () => {
    // Leg 0 points at leg 1, but leg 1 points at itself.
    const tokenId = buildTokenId([
      { tokenType: 0n, riskPartner: 1n },
      { tokenType: 1n, riskPartner: 1n },
    ])
    expect(kinds(classifyStrategyGroups(tokenId))).toEqual(['shortCall', 'shortPut'])
  })

  it('handles a four-leg position as two independent pairs', () => {
    const tokenId = buildTokenId([
      { tokenType: 0n, strike: 200n, riskPartner: 1n },
      { tokenType: 1n, strike: 100n, riskPartner: 0n },
      { tokenType: 0n, strike: 300n, riskPartner: 3n },
      { tokenType: 0n, isLong: true, strike: 400n, riskPartner: 2n },
    ])
    expect(kinds(classifyStrategyGroups(tokenId))).toEqual(['strangle', 'spread'])
  })
})

describe('isolateGroupTokenId', () => {
  it('re-indexes an isolated pair to 0/1 and keeps them partnered', () => {
    const tokenId = buildTokenId([
      { tokenType: 0n },
      { tokenType: 0n, strike: 200n, riskPartner: 2n },
      { tokenType: 0n, isLong: true, strike: 300n, riskPartner: 1n },
    ])
    const isolated = isolateGroupTokenId(tokenId, [1n, 2n])
    const legs = decodeAllLegs(isolated)

    expect(legs).toHaveLength(2)
    expect(legs[0].index).toBe(0n)
    expect(legs[1].index).toBe(1n)
    // The partnership survives, remapped onto the new indices.
    expect(legs[0].riskPartner).toBe(1n)
    expect(legs[1].riskPartner).toBe(0n)
    // Leg data is preserved.
    expect(legs[0].strike).toBe(200n)
    expect(legs[1].strike).toBe(300n)
    expect(legs[1].isLong).toBe(true)
    // Same pool.
    expect(isolated & ((1n << 64n) - 1n)).toBe(POOL_ID)
  })

  it('self-partners a leg whose partner is left behind', () => {
    const tokenId = pair({ tokenType: 0n, strike: 200n }, { tokenType: 1n, strike: 100n })
    const legs = decodeAllLegs(isolateGroupTokenId(tokenId, [1n]))
    expect(legs).toHaveLength(1)
    expect(legs[0].riskPartner).toBe(0n)
    expect(legs[0].index).toBe(0n)
  })

  it('round-trips the groups of a classified position', () => {
    const tokenId = buildTokenId([
      { tokenType: 0n, strike: 200n, riskPartner: 1n },
      { tokenType: 1n, strike: 100n, riskPartner: 0n },
      { width: 0n },
    ])
    const groups = classifyStrategyGroups(tokenId)
    expect(kinds(groups)).toEqual(['strangle', 'loan'])
    for (const group of groups) {
      expect(decodeAllLegs(isolateGroupTokenId(tokenId, group.legIndices))).toHaveLength(
        group.legIndices.length,
      )
    }
  })

  it('throws for a leg that is not in the tokenId', () => {
    expect(() => isolateGroupTokenId(buildTokenId([{}]), [3n])).toThrow()
  })
})

describe('apportion', () => {
  const groups: StrategyGroup[] = [
    { kind: 'strangle', legIndices: [0n, 1n], chargedLegIndex: null },
    { kind: 'loan', legIndices: [2n], chargedLegIndex: null },
  ]

  it('splits the total in proportion to the isolated prices', () => {
    const result = apportion(groups, [300n, 100n], 1000n)
    expect(result[0].allocated).toBe(750n)
    expect(result[1].allocated).toBe(250n)
  })

  it('sums to the authoritative total exactly, residue to the last priced group', () => {
    const result = apportion(groups, [1n, 2n], 100n)
    const sum = result.reduce<bigint>((acc, a) => acc + (a.allocated ?? 0n), 0n)
    expect(sum).toBe(100n)
    // 100 * 1 / 3 = 33 floored; the last group absorbs the remaining 67.
    expect(result[0].allocated).toBe(33n)
    expect(result[1].allocated).toBe(67n)
  })

  it('drops an unpriced group from the split but keeps the total whole', () => {
    const result = apportion(groups, [null, 100n], 1000n)
    expect(result[0].allocated).toBeNull()
    expect(result[0].isolatedRequired0).toBeNull()
    // The remaining group takes the whole total rather than a fabricated share.
    expect(result[1].allocated).toBe(1000n)
  })

  it('allocates nothing rather than zero when no group could be priced', () => {
    const result = apportion(groups, [null, null], 1000n)
    // A displayed 0 would read as "this part is free" — a different, wrong claim.
    expect(result.every((a) => a.allocated === null)).toBe(true)
  })

  it('allocates nothing when there is no authoritative total', () => {
    const result = apportion(groups, [300n, 100n], null)
    expect(result.every((a) => a.allocated === null)).toBe(true)
    // The isolated prices are still reported.
    expect(result[0].isolatedRequired0).toBe(300n)
  })

  it('allocates nothing when every weight is zero', () => {
    const result = apportion(groups, [0n, 0n], 1000n)
    expect(result.every((a) => a.allocated === null)).toBe(true)
  })

  it('preserves the classification fields', () => {
    const result = apportion(groups, [300n, 100n], 1000n)
    expect(result[0].kind).toBe('strangle')
    expect(result[0].legIndices).toEqual([0n, 1n])
  })

  it('rejects mismatched groups and isolated prices', () => {
    expect(() => apportion(groups, [300n], 1000n)).toThrow(PanopticError)
  })
})

describe('estimateCollateralBreakdown', () => {
  const POOL_ADDRESS = '0x1111111111111111111111111111111111111111' as const
  const QUERY_ADDRESS = '0x2222222222222222222222222222222222222222' as const
  const MAX_UINT64 = 2n ** 64n - 1n

  const createMockClient = () =>
    ({
      getBlock: vi.fn().mockResolvedValue({
        number: 12345678n,
        hash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as const,
        timestamp: 1700000000n,
      }),
      getBlockNumber: vi.fn().mockResolvedValue(12345678n),
      multicall: vi.fn(),
    }) satisfies EstimateCollateralBreakdownParams['client']

  /** A strangle (legs 0+1) plus a standalone loan (leg 2) — two groups. */
  const twoGroupTokenId = buildTokenId([
    { tokenType: 0n, strike: 200n, riskPartner: 1n },
    { tokenType: 1n, strike: 100n, riskPartner: 0n },
    { width: 0n },
  ])

  it('prices every group in ONE multicall at one tick and block', async () => {
    const client = createMockClient()
    vi.mocked(client.multicall).mockResolvedValue([
      { status: 'success', result: MAX_UINT64 * 3n },
      { status: 'success', result: MAX_UINT64 * 1n },
    ])

    const result = await estimateCollateralBreakdown({
      client,
      poolAddress: POOL_ADDRESS,
      queryAddress: QUERY_ADDRESS,
      tokenId: twoGroupTokenId,
      positionSize: 1n,
      atTick: 50n,
      authoritativeRequired0: 1000n,
    })

    expect(client.multicall).toHaveBeenCalledTimes(1)
    const call = vi.mocked(client.multicall).mock.calls[0][0]
    expect(call.contracts).toHaveLength(2)
    // Same tick and same pinned block for every group.
    expect(
      (call.contracts as { args?: readonly unknown[] }[]).every((c) => c.args?.[2] === 50),
    ).toBe(true)
    expect(call.blockNumber).toBe(12345678n)
    // An explicit atTick means no extra getCurrentTick round-trip.
    expect(result.allocations.map((a) => a.kind)).toEqual(['strangle', 'loan'])
    // getRequiredBase prices at uint64 max; results scale to positionSize.
    expect(result.allocations[0].isolatedRequired0).toBe(3n)
    expect(result.allocations[1].isolatedRequired0).toBe(1n)
    // 3:1 split of the authoritative total.
    expect(result.allocations[0].allocated).toBe(750n)
    expect(result.allocations[1].allocated).toBe(250n)
    expect(result.partial).toBe(false)
  })

  it('drops a group returning the getRequiredBase sentinel and flags the split partial', async () => {
    const client = createMockClient()
    vi.mocked(client.multicall).mockResolvedValue([
      { status: 'success', result: REQUIRED_BASE_ERROR_SENTINEL },
      { status: 'success', result: MAX_UINT64 * 1n },
    ])

    const result = await estimateCollateralBreakdown({
      client,
      poolAddress: POOL_ADDRESS,
      queryAddress: QUERY_ADDRESS,
      tokenId: twoGroupTokenId,
      positionSize: 1n,
      atTick: 50n,
      authoritativeRequired0: 1000n,
    })

    // The sentinel is type(uint128).max, not a requirement — never scaled.
    expect(result.allocations[0].isolatedRequired0).toBeNull()
    expect(result.allocations[0].allocated).toBeNull()
    expect(result.allocations[1].allocated).toBe(1000n)
    expect(result.partial).toBe(true)
    // The classification survives even where the pricing didn't.
    expect(result.allocations[0].kind).toBe('strangle')
  })

  it('treats a reverted group the same as a sentinel', async () => {
    const client = createMockClient()
    vi.mocked(client.multicall).mockResolvedValue([
      { status: 'failure', error: new Error('reverted') },
      { status: 'success', result: MAX_UINT64 * 1n },
    ])

    const result = await estimateCollateralBreakdown({
      client,
      poolAddress: POOL_ADDRESS,
      queryAddress: QUERY_ADDRESS,
      tokenId: twoGroupTokenId,
      positionSize: 1n,
      atTick: 50n,
      authoritativeRequired0: 1000n,
    })

    expect(result.allocations[0].allocated).toBeNull()
    expect(result.partial).toBe(true)
  })

  it('reads the current tick when none is supplied', async () => {
    const client = createMockClient()
    vi.mocked(client.multicall)
      .mockResolvedValueOnce([123])
      .mockResolvedValueOnce([
        { status: 'success', result: MAX_UINT64 },
        { status: 'success', result: MAX_UINT64 },
      ])

    await estimateCollateralBreakdown({
      client,
      poolAddress: POOL_ADDRESS,
      queryAddress: QUERY_ADDRESS,
      tokenId: twoGroupTokenId,
      positionSize: 1n,
    })

    expect(client.multicall).toHaveBeenCalledTimes(2)
    const call = vi.mocked(client.multicall).mock.calls[1][0]
    expect(
      (call.contracts as { args?: readonly unknown[] }[]).every((c) => c.args?.[2] === 123),
    ).toBe(true)
  })

  it('reports classification without allocations when no total is supplied', async () => {
    const client = createMockClient()
    vi.mocked(client.multicall).mockResolvedValue([
      { status: 'success', result: MAX_UINT64 * 3n },
      { status: 'success', result: MAX_UINT64 * 1n },
    ])

    const result = await estimateCollateralBreakdown({
      client,
      poolAddress: POOL_ADDRESS,
      queryAddress: QUERY_ADDRESS,
      tokenId: twoGroupTokenId,
      positionSize: 1n,
      atTick: 50n,
    })

    expect(result.authoritativeRequired0).toBeNull()
    expect(result.allocations.every((a) => a.allocated === null)).toBe(true)
    // Isolated prices are still useful on their own.
    expect(result.allocations[0].isolatedRequired0).toBe(3n)
  })

  it('rejects a blockNumber that disagrees with a pinned _meta', async () => {
    const client = createMockClient()
    await expect(
      estimateCollateralBreakdown({
        client,
        poolAddress: POOL_ADDRESS,
        queryAddress: QUERY_ADDRESS,
        tokenId: twoGroupTokenId,
        positionSize: 1n,
        blockNumber: 100n,
        _meta: { blockNumber: 200n, blockHash: '0x0', blockTimestamp: 0n },
      }),
    ).rejects.toThrow(/same-block/)
  })
})
