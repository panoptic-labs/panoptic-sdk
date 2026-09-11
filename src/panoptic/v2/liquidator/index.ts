/**
 * PanopticLiquidator helpers for liquidation bots.
 *
 * RPC-only (no external services): an exact block-pinned reproduction of the
 * pool's liquidation gate, and an `eth_call` wrapper around the helper's
 * state-mutating `quoteLiquidation`.
 *
 * @module v2/liquidator
 */

import type { Address, PublicClient, StateOverride } from 'viem'
import { decodeFunctionResult, encodeFunctionData } from 'viem'

import { panopticLiquidatorAbi, panopticPoolV2Abi, panopticQueryAbi } from '../../../generated'
import { PanopticError } from '../errors/base'
import {
  type MulticallBlockCall,
  readBlockAndAggregate,
  requireReturnData,
} from '../reads/multicallBlock'
import type { BlockMeta } from '../types'

/**
 * `PanopticLiquidator.LiquidateParams`, mirrored with viem-native types.
 * Field order and encoding match the on-chain struct exactly.
 */
export interface HelperLiquidateParams {
  pool: Address
  account: Address
  positionIdListTo: readonly bigint[]
  usePremiaAsCollateral: bigint
  flashToken: Address
  flashAmount: bigint
  nativeFundingAmount: bigint
  preSwapTarget: Address
  preSwapCallData: `0x${string}`
  preSwapTokenIn: Address
  preSwapAmountIn: bigint
  swapTarget: Address
  swapCallData: `0x${string}`
  swapTokenIn: Address
  swapAmountIn: bigint
  minDelta0: bigint
  minDelta1: bigint
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

/**
 * A LiquidateParams skeleton with every optional route zeroed: no flash loan,
 * no swaps, no native funding, zero floors. Spread and override.
 */
export function emptyLiquidateParams(
  pool: Address,
  account: Address,
  positionIdListTo: readonly bigint[],
): HelperLiquidateParams {
  return {
    pool,
    account,
    positionIdListTo,
    usePremiaAsCollateral: 0n,
    flashToken: ZERO_ADDRESS,
    flashAmount: 0n,
    nativeFundingAmount: 0n,
    preSwapTarget: ZERO_ADDRESS,
    preSwapCallData: '0x',
    preSwapTokenIn: ZERO_ADDRESS,
    preSwapAmountIn: 0n,
    swapTarget: ZERO_ADDRESS,
    swapCallData: '0x',
    swapTokenIn: ZERO_ADDRESS,
    swapAmountIn: 0n,
    minDelta0: 0n,
    minDelta1: 0n,
  }
}

// ---------------------------------------------------------------------------
// Exact four-tick screen
// ---------------------------------------------------------------------------

/** The four oracle ticks `dispatchFrom` gates liquidation on. */
export interface LiquidationGateTicks {
  spotTick: bigint
  twapTick: bigint
  latestTick: bigint
  currentTick: bigint
}

/** Result of an exact, single-block reproduction of the pool's liquidation gate. */
export interface ScreenAccountExactResult {
  /**
   * True only when the account is insolvent at ALL four gate ticks — the
   * exact precondition for `dispatchFrom`'s liquidation branch. Partial
   * insolvency (1-3 ticks) reverts `NotMarginCalled` on-chain.
   */
  isLiquidatable: boolean
  /** Per-tick solvency, same order as `ticks`. */
  solventAt: [boolean, boolean, boolean, boolean]
  ticks: LiquidationGateTicks
  /** Block every read in this screen was pinned to. */
  _meta: BlockMeta
}

/** Inputs required to screen one account against the pool's four liquidation ticks. */
export interface ScreenAccountExactParams {
  client: PublicClient
  poolAddress: Address
  queryAddress: Address
  account: Address
  /** The account's full position list (pool hash-validates it on-chain). */
  tokenIds: readonly bigint[]
  /** Pin to a specific block (defaults to latest, then pins the whole screen to it). */
  blockNumber?: bigint
}

/**
 * Reproduce the pool's liquidation gate exactly, pinned to one block.
 *
 * `dispatchFrom` checks solvency at `[spotTick, twapTick, latestTick,
 * currentTick]` — note `twapTick` (riskEngine EMA via `getTWAP()`)
 * deliberately REPLACES the `medianTick` that `getOracleTicks()` returns.
 * Never gate liquidatability on the 3-arg `checkCollateral` overload: it
 * iterates `getOracleTicks()` (which includes medianTick and omits twapTick)
 * and disagrees with the pool at the margin.
 *
 * Two phases, both pinned to the same block: (1) read the oracle ticks and
 * TWAP, (2) `isAccountSolvent` at each of the four gate ticks.
 */
export async function screenAccountExact(
  params: ScreenAccountExactParams,
): Promise<ScreenAccountExactResult> {
  const { client, poolAddress, queryAddress, account, tokenIds } = params

  const tickCalls: MulticallBlockCall[] = [
    {
      target: poolAddress,
      callData: encodeFunctionData({ abi: panopticPoolV2Abi, functionName: 'getOracleTicks' }),
    },
    {
      target: poolAddress,
      callData: encodeFunctionData({ abi: panopticPoolV2Abi, functionName: 'getTWAP' }),
    },
  ]
  const phase1 = await readBlockAndAggregate({
    client,
    calls: tickCalls,
    blockNumber: params.blockNumber,
  })

  const oracle = decodeFunctionResult({
    abi: panopticPoolV2Abi,
    functionName: 'getOracleTicks',
    data: requireReturnData(phase1.results, 0, 'PanopticPool.getOracleTicks'),
  }) as readonly [number, number, number, number, bigint]
  const twapTick = BigInt(
    decodeFunctionResult({
      abi: panopticPoolV2Abi,
      functionName: 'getTWAP',
      data: requireReturnData(phase1.results, 1, 'PanopticPool.getTWAP'),
    }),
  )
  const ticks: LiquidationGateTicks = {
    currentTick: BigInt(oracle[0]),
    spotTick: BigInt(oracle[1]),
    // oracle[2] is medianTick — intentionally unused (see docblock).
    latestTick: BigInt(oracle[3]),
    twapTick,
  }

  const gateTicks = [ticks.spotTick, ticks.twapTick, ticks.latestTick, ticks.currentTick]
  const solvencyCalls: MulticallBlockCall[] = gateTicks.map((atTick) => ({
    target: queryAddress,
    callData: encodeFunctionData({
      abi: panopticQueryAbi,
      functionName: 'isAccountSolvent',
      args: [poolAddress, account, tokenIds as bigint[], Number(atTick)],
    }),
  }))
  // Pin phase 2 to phase 1's block so the gate is evaluated on one state.
  const phase2 = await readBlockAndAggregate({
    client,
    calls: solvencyCalls,
    blockNumber: phase1._meta.blockNumber,
  })
  // Same number is not enough across a reorg: the two phases must have seen
  // the SAME block, or the four-tick gate was evaluated on mixed state.
  if (phase2._meta.blockHash !== phase1._meta.blockHash) {
    throw new PanopticError(
      `screenAccountExact: block ${phase1._meta.blockNumber} hash changed between phases ` +
        `(${phase1._meta.blockHash} -> ${phase2._meta.blockHash}); reorg mid-screen — retry`,
    )
  }

  const solventAt = gateTicks.map(
    (_, i) =>
      decodeFunctionResult({
        abi: panopticQueryAbi,
        functionName: 'isAccountSolvent',
        data: requireReturnData(phase2.results, i, `PanopticQuery.isAccountSolvent[${i}]`),
      }) as boolean,
  ) as [boolean, boolean, boolean, boolean]

  return {
    isLiquidatable: solventAt.every((solvent) => !solvent),
    solventAt,
    ticks,
    _meta: phase2._meta,
  }
}

// ---------------------------------------------------------------------------
// quoteLiquidation eth_call wrapper
// ---------------------------------------------------------------------------

/** Signed liquidation bonuses, required shortfalls, and realized protocol losses. */
export interface LiquidationQuote {
  /** Signed token0 bonus in assets (negative ⇒ token0 must be paid in). */
  bonus0: bigint
  bonus1: bigint
  /** Token the liquidator must supply: max(-bonus, 0). */
  shortfall0: bigint
  shortfall1: bigint
  /** Socialized loss realized in each CollateralTracker (assets). */
  protocolLoss0: bigint
  protocolLoss1: bigint
}

/** Inputs for simulating `PanopticLiquidator.quoteLiquidation` with `eth_call`. */
export interface QuoteLiquidationParams {
  client: PublicClient
  /** PanopticLiquidator helper address. */
  liquidatorAddress: Address
  /** The helper's owner — quoteLiquidation is onlyOwner, so eth_call `from` must be it. */
  owner: Address
  /**
   * Quote inputs. Only `pool`, `account`, `positionIdListTo`,
   * `usePremiaAsCollateral` matter: quoteLiquidation calls `_runLiquidation`
   * directly, ignoring flash-loan, swap, and minDelta fields. It does NOT
   * validate routes — only a full simulation of `liquidate` does.
   */
  params: HelperLiquidateParams
  /**
   * State overrides funding the helper for the negative-bonus pull. The quote
   * self-approves, so only BALANCE overrides are needed: a native balance on
   * the helper (native pools), and/or ERC20 balance-slot overrides discovered
   * by the caller. Merged verbatim into the eth_call.
   */
  stateOverride?: StateOverride
  /**
   * ETH attached to the quote call (native pools). NOTE the baseline
   * difference vs `liquidate`: the quote does NOT subtract attached value
   * from its snapshot, so value that gets spent reads as `bonus0 = -spent`
   * here but as `delta0 = 0` in `liquidate`. Prefer funding via a balance
   * override + `params.nativeFundingAmount`, which both paths treat alike.
   */
  value?: bigint
  blockNumber?: bigint
}

/**
 * Run `PanopticLiquidator.quoteLiquidation` via `eth_call` (it is
 * state-mutating by design and must never be mined).
 */
export async function quoteLiquidation(params: QuoteLiquidationParams): Promise<LiquidationQuote> {
  const { client, liquidatorAddress, owner, stateOverride, value, blockNumber } = params

  const response = await client.call({
    account: owner,
    to: liquidatorAddress,
    data: encodeFunctionData({
      abi: panopticLiquidatorAbi,
      functionName: 'quoteLiquidation',
      args: [params.params],
    }),
    value,
    stateOverride,
    blockNumber,
  })
  if (response.data === undefined) {
    throw new PanopticError('quoteLiquidation eth_call returned no data')
  }

  const [bonus0, bonus1, shortfall0, shortfall1, protocolLoss0, protocolLoss1] =
    decodeFunctionResult({
      abi: panopticLiquidatorAbi,
      functionName: 'quoteLiquidation',
      data: response.data,
    }) as readonly [bigint, bigint, bigint, bigint, bigint, bigint]

  return { bonus0, bonus1, shortfall0, shortfall1, protocolLoss0, protocolLoss1 }
}
