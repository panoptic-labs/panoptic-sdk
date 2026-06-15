import { describe, expect, it } from 'vitest'

import { buildBatchDispatchArgs } from './build'
import type { BatchDispatchArgs, BatchOp, BatchOpBurn, BatchOpMint } from './types'

const POOL_A = '0x1111111111111111111111111111111111111111' as const
const POOL_B = '0x2222222222222222222222222222222222222222' as const

const TOKEN_A = 0xaaaan
const TOKEN_B = 0xbbbbn
const TOKEN_C = 0xccccn
const TOKEN_D = 0xddddn

function mint(overrides: Partial<BatchOpMint> & Pick<BatchOpMint, 'tokenId'>): BatchOpMint {
  return {
    kind: 'mint',
    poolAddress: POOL_A,
    positionSize: 1_000_000_000_000_000n,
    spreadLimit: 0n,
    tickLimitLow: -100n,
    tickLimitHigh: 100n,
    swapAtMint: false,
    ...overrides,
  }
}

function burn(overrides: Partial<BatchOpBurn> & Pick<BatchOpBurn, 'tokenId'>): BatchOpBurn {
  return {
    kind: 'burn',
    poolAddress: POOL_A,
    tickLimitLow: -100n,
    tickLimitHigh: 100n,
    swapAtMint: false,
    ...overrides,
  }
}

function expectArgs(args: BatchDispatchArgs | null): BatchDispatchArgs {
  expect(args).not.toBeNull()
  if (args === null) throw new Error('unreachable')
  return args
}

describe('buildBatchDispatchArgs', () => {
  it('returns empty-batch diagnostic when items is empty', () => {
    const { args, diagnostics } = buildBatchDispatchArgs({ items: [], existingPositionIds: [] })
    expect(args).toBeNull()
    expect(diagnostics).toHaveLength(1)
    const [diag] = diagnostics
    expect(diag).toBeDefined()
    expect(diag?.code).toBe('empty-batch')
  })

  it('builds mint-only args', () => {
    const items: BatchOp[] = [mint({ tokenId: TOKEN_C }), mint({ tokenId: TOKEN_D })]
    const { args, diagnostics } = buildBatchDispatchArgs({
      items,
      existingPositionIds: [TOKEN_A, TOKEN_B],
    })
    expect(diagnostics).toEqual([])
    const a = expectArgs(args)
    expect(a.positionIdList).toEqual([TOKEN_C, TOKEN_D])
    expect(a.positionSizes).toEqual([1_000_000_000_000_000n, 1_000_000_000_000_000n])
    expect(a.finalPositionIdList).toEqual([TOKEN_A, TOKEN_B, TOKEN_C, TOKEN_D])
    expect(a.tickAndSpreadLimits).toEqual([
      [-100n, 100n, 0n],
      [-100n, 100n, 0n],
    ])
    expect(a.usePremiaAsCollateral).toBe(false)
    expect(a.builderCode).toBe(0n)
  })

  it('builds burn-only args with size 0n', () => {
    const items: BatchOp[] = [burn({ tokenId: TOKEN_A }), burn({ tokenId: TOKEN_B })]
    const { args, diagnostics } = buildBatchDispatchArgs({
      items,
      existingPositionIds: [TOKEN_A, TOKEN_B, TOKEN_C],
    })
    expect(diagnostics).toEqual([])
    const a = expectArgs(args)
    expect(a.positionIdList).toEqual([TOKEN_A, TOKEN_B])
    expect(a.positionSizes).toEqual([0n, 0n])
    expect(a.finalPositionIdList).toEqual([TOKEN_C])
  })

  it('builds mixed mint+burn args from the plan example [A, B] + [mint C, mint D, close A] -> final [B, C, D]', () => {
    const items: BatchOp[] = [
      mint({ tokenId: TOKEN_C }),
      mint({ tokenId: TOKEN_D }),
      burn({ tokenId: TOKEN_A }),
    ]
    const { args, diagnostics } = buildBatchDispatchArgs({
      items,
      existingPositionIds: [TOKEN_A, TOKEN_B],
    })
    expect(diagnostics).toEqual([])
    const a = expectArgs(args)
    expect(a.positionIdList).toEqual([TOKEN_C, TOKEN_D, TOKEN_A])
    expect(a.positionSizes).toEqual([1_000_000_000_000_000n, 1_000_000_000_000_000n, 0n])
    expect(a.finalPositionIdList).toEqual([TOKEN_B, TOKEN_C, TOKEN_D])
  })

  it('inverts tick limits when swapAtMint is true', () => {
    const items: BatchOp[] = [
      mint({
        tokenId: TOKEN_C,
        tickLimitLow: -100n,
        tickLimitHigh: 100n,
        swapAtMint: true,
        spreadLimit: 5n,
      }),
      mint({
        tokenId: TOKEN_D,
        tickLimitLow: -50n,
        tickLimitHigh: 50n,
        swapAtMint: false,
        spreadLimit: 7n,
      }),
    ]
    const { args } = buildBatchDispatchArgs({ items, existingPositionIds: [] })
    const a = expectArgs(args)
    expect(a.tickAndSpreadLimits).toEqual([
      [100n, -100n, 5n],
      [-50n, 50n, 7n],
    ])
  })

  it('flags mint-already-onchain', () => {
    const items: BatchOp[] = [mint({ tokenId: TOKEN_A })]
    const { args, diagnostics } = buildBatchDispatchArgs({
      items,
      existingPositionIds: [TOKEN_A],
    })
    expect(args).toBeNull()
    expect(diagnostics).toHaveLength(1)
    const [diag] = diagnostics
    expect(diag).toBeDefined()
    expect(diag?.code).toBe('mint-already-onchain')
    expect(diag?.tokenId).toBe(TOKEN_A)
    expect(diag?.itemIndex).toBe(0n)
  })

  it('flags burn-not-found', () => {
    const items: BatchOp[] = [burn({ tokenId: TOKEN_A })]
    const { args, diagnostics } = buildBatchDispatchArgs({
      items,
      existingPositionIds: [TOKEN_B],
    })
    expect(args).toBeNull()
    expect(diagnostics).toHaveLength(1)
    const [diag] = diagnostics
    expect(diag?.code).toBe('burn-not-found')
  })

  it('flags duplicate tokenId across items', () => {
    const items: BatchOp[] = [mint({ tokenId: TOKEN_C }), mint({ tokenId: TOKEN_C })]
    const { args, diagnostics } = buildBatchDispatchArgs({ items, existingPositionIds: [] })
    expect(args).toBeNull()
    expect(diagnostics.map((d) => d.code)).toContain('duplicate-tokenid-in-batch')
  })

  it('flags cross-pool batch', () => {
    const items: BatchOp[] = [
      mint({ tokenId: TOKEN_C, poolAddress: POOL_A }),
      mint({ tokenId: TOKEN_D, poolAddress: POOL_B }),
    ]
    const { args, diagnostics } = buildBatchDispatchArgs({ items, existingPositionIds: [] })
    expect(args).toBeNull()
    expect(diagnostics.map((d) => d.code)).toContain('cross-pool')
  })

  it('flags invalid tick limits', () => {
    const items: BatchOp[] = [mint({ tokenId: TOKEN_C, tickLimitLow: 200n, tickLimitHigh: 100n })]
    const { args, diagnostics } = buildBatchDispatchArgs({ items, existingPositionIds: [] })
    expect(args).toBeNull()
    expect(diagnostics.map((d) => d.code)).toContain('invalid-tick-limits')
  })

  it('flags non-positive mint size', () => {
    const items: BatchOp[] = [mint({ tokenId: TOKEN_C, positionSize: 0n })]
    const { args, diagnostics } = buildBatchDispatchArgs({ items, existingPositionIds: [] })
    expect(args).toBeNull()
    expect(diagnostics.map((d) => d.code)).toContain('invalid-position-size')
  })

  it('passes through usePremiaAsCollateral and builderCode', () => {
    const items: BatchOp[] = [mint({ tokenId: TOKEN_C })]
    const { args } = buildBatchDispatchArgs({
      items,
      existingPositionIds: [],
      usePremiaAsCollateral: true,
      builderCode: 0xdeadn,
    })
    const a = expectArgs(args)
    expect(a.usePremiaAsCollateral).toBe(true)
    expect(a.builderCode).toBe(0xdeadn)
  })

  it('handles a mint that re-creates a tokenId previously closed in the same batch (still flagged duplicate)', () => {
    const items: BatchOp[] = [burn({ tokenId: TOKEN_A }), mint({ tokenId: TOKEN_A })]
    const { args, diagnostics } = buildBatchDispatchArgs({
      items,
      existingPositionIds: [TOKEN_A],
    })
    expect(args).toBeNull()
    expect(diagnostics.map((d) => d.code)).toContain('duplicate-tokenid-in-batch')
  })
})
