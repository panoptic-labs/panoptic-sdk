/**
 * Open position preview — combines buying power check with open position simulation.
 *
 * @module v2/reads/openPositionPreview
 */

import type { Address, Client, PublicClient } from 'viem'

import type { NotEnoughTokensError } from '../errors'
import { AccountInsolventError } from '../errors'
import { parsePanopticError } from '../errors/parser'
import type { SimulateOpenPositionParams } from '../simulations/simulateOpenPosition'
import { simulateOpenPosition } from '../simulations/simulateOpenPosition'
import { getNotEnoughTokensError } from '../simulations/tokenShortfallRecovery'
import type { OpenPositionSimulation, SimulationResult } from '../types'
import type { AccountBuyingPower } from './buyingPower'
import { getAccountBuyingPower } from './buyingPower'

/**
 * Parameters for getOpenPositionPreview.
 */
export interface GetOpenPositionPreviewParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Account address */
  account: Address
  /** Existing position IDs held by the account (before this mint) */
  existingPositionIds: bigint[]
  /** TokenId of position to open */
  tokenId: bigint
  /** Position size */
  positionSize: bigint
  /** PanopticQuery address */
  queryAddress: Address
  /** Lower tick limit */
  tickLimitLow: bigint
  /** Upper tick limit */
  tickLimitHigh: bigint
  /** Spread limit (default 0n) */
  spreadLimit?: bigint
  /** Whether to swap at mint */
  swapAtMint?: boolean
  /** Whether to use premia as collateral */
  usePremiaAsCollateral?: boolean
  /** Chain ID (for greeks calculation) */
  chainId?: bigint
  /** Optional block number */
  blockNumber?: bigint
}

/**
 * Result of getOpenPositionPreview.
 */
export interface OpenPositionPreview {
  /** Current buying power (from checkCollateral on existing positions) */
  currentBuyingPower: AccountBuyingPower
  /** Simulation result (from dry-run dispatch) */
  simulation: SimulationResult<OpenPositionSimulation>
  /**
   * Whether the account has enough *buying power* for the position.
   *
   * False only for a genuine `AccountInsolvent` revert. A token shortfall is
   * reported separately via {@link OpenPositionPreview.tokenShortfall} — the two
   * have different remedies (lower the size vs. source the missing token), so
   * do not collapse them back into one flag.
   */
  isSolvent: boolean
  /**
   * Set when the mint reverted because one collateral tracker lacked tokens,
   * not because the account is short on margin. The account may hold plenty of
   * value in the *other* token, in which case a collateral swap resolves it.
   */
  tokenShortfall: NotEnoughTokensError | null
  /** Token 0 amount required (negative delta = deposit). Null if simulation failed. */
  amount0Required: bigint | null
  /** Token 1 amount required. Null if simulation failed. */
  amount1Required: bigint | null
  /** Collateral balance in token 0 after mint. Null if simulation failed. */
  postCollateral0: bigint | null
  /** Collateral balance in token 1 after mint. Null if simulation failed. */
  postCollateral1: bigint | null
  /** Post-mint collateral requirement in token0 (per-token, not cross-margined). Null if sim failed. */
  postMintCollateralReqToken0: bigint | null
  /** Post-mint collateral requirement in token1 (per-token, not cross-margined). Null if sim failed. */
  postMintCollateralReqToken1: bigint | null
  /**
   * Collateral requirement for the new position only (last entry of perPositionCollateralReqs).
   * Use this for "Margin Used" display — postMintCollateralReqToken0/1 includes existing positions too.
   * Null if simulation failed or perPositionCollateralReqs is empty.
   */
  newPositionCollateralReqToken0: bigint | null
  /** Collateral requirement for the new position only, token1. Null if sim failed. */
  newPositionCollateralReqToken1: bigint | null
}

/**
 * Get a preview of opening a position.
 *
 * Composes two calls:
 * 1. `getAccountBuyingPower` — current margin state for existing positions
 * 2. `simulateOpenPosition` — dry-run dispatch to check feasibility & token flows
 *
 * @param params - Preview parameters
 * @returns Preview with buying power, simulation result, and derived convenience fields
 */
export async function getOpenPositionPreview(
  params: GetOpenPositionPreviewParams,
): Promise<OpenPositionPreview> {
  const {
    client,
    poolAddress,
    account,
    existingPositionIds,
    tokenId,
    positionSize,
    queryAddress,
    tickLimitLow,
    tickLimitHigh,
    spreadLimit,
    swapAtMint,
    usePremiaAsCollateral,
    chainId,
    blockNumber,
  } = params

  // Run both calls in parallel
  const [currentBuyingPower, simulation] = await Promise.all([
    getAccountBuyingPower({
      client: client as Client,
      poolAddress,
      account,
      tokenIds: existingPositionIds,
      queryAddress,
      blockNumber,
    }),
    simulateOpenPosition({
      client,
      poolAddress,
      account,
      existingPositionIds,
      tokenId,
      positionSize,
      tickLimitLow,
      tickLimitHigh,
      spreadLimit,
      swapAtMint,
      usePremiaAsCollateral,
      chainId,
      blockNumber,
    } satisfies SimulateOpenPositionParams),
  ])

  // Two distinct failures, kept apart because they have different remedies:
  //   AccountInsolvent  -> not enough buying power; the size must come down.
  //   NotEnoughTokens   -> one tracker is short tokens; the account may still be
  //                        well within its buying power, just holding the wrong
  //                        token, so sourcing it (swap / loan leg) resolves it.
  // Everything else (PriceBoundFail, EffectiveLiquidityAboveThreshold, …) is
  // neither, and must not read as a collateral problem.
  let isSolvent = true
  let tokenShortfall: NotEnoughTokensError | null = null
  if (!simulation.success) {
    const parsed = parsePanopticError(simulation.error)
    const err = parsed?.error ?? simulation.error
    isSolvent = !(err instanceof AccountInsolventError)
    tokenShortfall = getNotEnoughTokensError(err)
  }
  const data = simulation.success ? simulation.data : null

  return {
    currentBuyingPower,
    simulation,
    isSolvent,
    tokenShortfall,
    amount0Required: data?.amount0Required ?? null,
    amount1Required: data?.amount1Required ?? null,
    postCollateral0: data?.postCollateral0 ?? null,
    postCollateral1: data?.postCollateral1 ?? null,
    postMintCollateralReqToken0: data?.postMintCollateralReqToken0 ?? null,
    postMintCollateralReqToken1: data?.postMintCollateralReqToken1 ?? null,
    newPositionCollateralReqToken0:
      data?.perPositionCollateralReqs && data.perPositionCollateralReqs.length > 0
        ? (data.perPositionCollateralReqs[data.perPositionCollateralReqs.length - 1]?.token0 ??
          null)
        : null,
    newPositionCollateralReqToken1:
      data?.perPositionCollateralReqs && data.perPositionCollateralReqs.length > 0
        ? (data.perPositionCollateralReqs[data.perPositionCollateralReqs.length - 1]?.token1 ??
          null)
        : null,
  }
}
