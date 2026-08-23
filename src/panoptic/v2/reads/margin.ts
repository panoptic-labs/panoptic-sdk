/**
 * Margin buffer and distance-to-liquidation convenience function.
 *
 * Sources current and required margin directly from
 * `PanopticPool.getFullPositionsData` + `CollateralTracker.assetsOf`,
 * rather than `PanopticQuery.checkCollateral`.
 *
 * Why: `checkCollateral` returns a `currentMargin` already netted of the
 * borrowing obligation of width=0 short ("loan") tokenIds, and a
 * `requiredMargin` that does NOT include the loan's collateral requirement.
 * That makes buying-power usage read 0% for accounts whose collateral
 * comes mostly from a loan, and double-subtracts the loan from Net Liq
 * when downstream callers add the position MtM (which already values the
 * loan at `-notional`).
 *
 * `getFullPositionsData.collateralRequirements[]` attributes the loan as
 * a margin requirement (the accurate primitive), and `assetsOf` returns
 * the gross collateral (deposits + borrowed shares) — pairing them yields
 * a consistent gross-collateral / gross-requirement view.
 *
 * @module v2/reads/margin
 */

import type { Address, PublicClient } from 'viem'
import { decodeFunctionResult, encodeFunctionData } from 'viem'

import { collateralTrackerV2Abi, panopticPoolV2Abi } from '../../../generated'
import { panopticQueryAbi } from '../abis/panopticQuery'
import { tickToSqrtPriceX96 } from '../formatters/tick'
import type { BlockMeta } from '../types'
import { decodeLeftRightUnsigned } from '../writes/utils'
import { type MintBufferRatio, mintableAfterBuffer } from './mintBuffer'
import { type MulticallBlockCall, readBlockAndAggregate, requireReturnData } from './multicallBlock'

// Sentinel ticks used by PanopticQuery to indicate "no liquidation at this boundary"
const MIN_TICK = -887272n
const MAX_TICK = 887272n

const FP96 = 1n << 96n
const Q128 = 1n << 128n

/** Cap for a usage ratio with no collateral behind it. */
const MAX_USAGE_BPS = 1_000_000n

const bigintMax = (a: bigint, b: bigint): bigint => (a > b ? a : b)
const bigintMin = (a: bigint, b: bigint): bigint => (a < b ? a : b)

// `RiskEngine.BP_DECREASE_BUFFER / DECIMALS` — the extra margin the solvency
// check demands at mint (and on collateral withdrawal), above the maintenance
// requirement that governs liquidation. It lives in `./mintBuffer` so the SDK
// and every UI surface share one implementation: applied per token, rounding
// up, before any price conversion.

/**
 * Convert a token0 amount to its token1-equivalent at the given sqrtPriceX96.
 *
 * Matches the on-chain `PanopticMath.convert0to1` truncation, with an
 * overflow-safe branch when `sqrtPriceX96^2` would not fit in uint256.
 */
function convert0to1(amount: bigint, sqrtPriceX96: bigint): bigint {
  if (sqrtPriceX96 < Q128) {
    return (amount * sqrtPriceX96 * sqrtPriceX96) >> 192n
  }
  // amount * (sqrtPriceX96 * sqrtPriceX96 >> 64n) >> 128n
  const sp2Hi = (sqrtPriceX96 * sqrtPriceX96) >> 64n
  return (amount * sp2Hi) >> 128n
}

/**
 * Convert a token1 amount to its token0-equivalent at the given sqrtPriceX96.
 */
function convert1to0(amount: bigint, sqrtPriceX96: bigint): bigint {
  if (sqrtPriceX96 < Q128) {
    const denom = sqrtPriceX96 * sqrtPriceX96
    return (amount * (1n << 192n)) / denom
  }
  const sp2Hi = (sqrtPriceX96 * sqrtPriceX96) >> 64n
  return (amount * (1n << 128n)) / sp2Hi
}

/**
 * Parameters for {@link getMarginBuffer}.
 */
export interface GetMarginBufferParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Account address */
  account: Address
  /** TokenIds of open positions (loan/credit width=0 legs included) */
  tokenIds: bigint[]
  /** PanopticQuery address (required for liquidation prices) */
  queryAddress: Address
  /**
   * Optional pre-fetched collateral tracker addresses (saves an RPC).
   * If omitted, they are fetched from the pool.
   */
  collateralAddresses?: { collateralToken0: Address; collateralToken1: Address }
  /** Optional block number for historical queries */
  blockNumber?: bigint
  /** Optional pre-fetched block metadata (skips getBlockMeta RPC call) */
  _meta?: BlockMeta
  /** Optional live mint buffer returned by getRiskParameters. */
  mintBuffer?: MintBufferRatio
}

/**
 * Margin buffer result with distance-to-liquidation.
 *
 * **Denomination**: Both slots are populated with the account total
 * cross-converted into a single token denomination so they can be
 * compared directly.
 *
 * - `currentMargin0` / `requiredMargin0` / `buffer0` are denominated in **token0**.
 * - `currentMargin1` / `requiredMargin1` / `buffer1` are denominated in **token1**.
 *
 * `denominatedInToken` indicates which of the two pairs is "preferred":
 * 0 when `currentTick < 0`, 1 otherwise — matching the historical
 * `checkCollateral` convention so downstream consumers keep working
 * without changes.
 */
export interface MarginBuffer {
  /** Excess margin in token0 units (positive = safe, negative = shortfall) */
  buffer0: bigint
  /** Excess margin in token1 units (positive = safe, negative = shortfall) */
  buffer1: bigint
  /** Buffer as percentage of required margin in bps (slot 0). null if no requirement. */
  bufferPercent0: bigint | null
  /** Buffer as percentage of required margin in bps (slot 1). null if no requirement. */
  bufferPercent1: bigint | null
  /** Current (gross) account collateral, denominated in token0 */
  currentMargin0: bigint
  /** Current (gross) account collateral, denominated in token1 */
  currentMargin1: bigint
  /**
   * Sum of per-position collateral requirements from
   * `getFullPositionsData.collateralRequirements[]`, denominated in token0.
   * Loans/credits (width=0) contribute correctly.
   */
  requiredMargin0: bigint
  /** Same, denominated in token1 */
  requiredMargin1: bigint
  /**
   * Which token the "preferred" margin values are denominated in.
   * 0 = token0 (when currentTick < 0), 1 = token1 (when currentTick >= 0).
   */
  denominatedInToken: 0 | 1
  /** Tick distance to nearest liquidation boundary (null if no liquidation boundaries) */
  liquidationDistance: bigint | null
  /** Lower liquidation tick (null if safe at MIN_TICK) */
  lowerLiquidationTick: bigint | null
  /** Upper liquidation tick (null if safe at MAX_TICK) */
  upperLiquidationTick: bigint | null
  /**
   * Collateral usage against the constraint that actually liquidates, in bps
   * (10000 = at the liquidation threshold). Null when the account holds no
   * positions.
   *
   * NOT `requiredMargin / currentMargin`. That ratio pools both collateral
   * tokens into one number, which silently assumes cross-collateral is credited
   * at 100%. It is only credited at `RiskEngine.crossBufferRatio(utilization,
   * CROSS_BUFFER_n)`, which decays linearly from the configured buffer to ZERO
   * between 90% and 95% pool utilization. Measured on mainnet with
   * CROSS_BUFFER = 100% and the token0 tracker at 91.98% utilization, only
   * 60.4% of the token0 surplus counted toward the token1 requirement — the
   * pooled ratio read 40% while this one read ~90% and liquidation was 8.7%
   * away.
   *
   * Sourced from `PanopticQuery.checkCollateral` at the current tick, which
   * applies the live cross-buffer, and reported for whichever token side is
   * tighter. Solvency requires both to hold.
   */
  crossMarginUsageBps: bigint | null
  /** Usage of the token0 side alone, in bps. Null when no positions. */
  usageBps0: bigint | null
  /** Usage of the token1 side alone, in bps. Null when no positions. */
  usageBps1: bigint | null
  /**
   * Collateral still deployable before the mint solvency check would fail,
   * in `denominatedInToken` units. Null when the account holds no positions.
   *
   * The tighter of `balance - required * BP_DECREASE_BUFFER` across the two
   * token sides, from `checkCollateral` at the current tick. NOT
   * `currentMargin - requiredMargin * buffer`, which pools both collateral
   * tokens and so credits cross-collateral at 100% regardless of the live
   * `crossBufferRatio`. On a mainnet account that pooled figure read ~24,000
   * USDC of headroom while the binding side had ~890 — and a mint requiring
   * ~2,700 USDC duly reverted with AccountInsolvent.
   */
  mintableMarginBinding: bigint | null
  /** Current tick */
  currentTick: bigint
  /** Block metadata */
  _meta: BlockMeta
}

/**
 * Get margin buffer and distance-to-liquidation for an account.
 *
 * Reads, all pinned to the same block:
 * - `getCurrentTick` (sequencing dependency for sqrtPrice conversion)
 * - `getFullPositionsData(account, true, tokenIds)` → collateralRequirements
 * - `CollateralTracker.assetsOf(account)` on both trackers → gross collateral
 * - `PanopticQuery.getLiquidationPrices(...)` → liquidation boundaries
 *
 * @param params - The parameters
 * @returns Margin buffer with liquidation distance and block metadata
 */
export async function getMarginBuffer(params: GetMarginBufferParams): Promise<MarginBuffer> {
  const { client, poolAddress, account, tokenIds, queryAddress, blockNumber, mintBuffer } = params

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())

  // Resolve collateral tracker addresses (immutable; cache-friendly).
  let collateralToken0: Address
  let collateralToken1: Address
  if (params.collateralAddresses) {
    collateralToken0 = params.collateralAddresses.collateralToken0
    collateralToken1 = params.collateralAddresses.collateralToken1
  } else {
    const addrs = await client.multicall({
      contracts: [
        { address: poolAddress, abi: panopticPoolV2Abi, functionName: 'collateralToken0' },
        { address: poolAddress, abi: panopticPoolV2Abi, functionName: 'collateralToken1' },
      ],
      blockNumber: targetBlockNumber,
      allowFailure: false,
    })
    collateralToken0 = addrs[0]
    collateralToken1 = addrs[1]
  }

  const hasPositions = tokenIds.length > 0
  const calls: MulticallBlockCall[] = [
    {
      target: poolAddress,
      callData: encodeFunctionData({
        abi: panopticPoolV2Abi,
        functionName: 'getCurrentTick',
      }),
    },
    {
      target: collateralToken0,
      callData: encodeFunctionData({
        abi: collateralTrackerV2Abi,
        functionName: 'assetsOf',
        args: [account],
      }),
    },
    {
      target: collateralToken1,
      callData: encodeFunctionData({
        abi: collateralTrackerV2Abi,
        functionName: 'assetsOf',
        args: [account],
      }),
    },
  ]

  const positionDataIndex = hasPositions ? calls.length : null
  if (positionDataIndex !== null) {
    calls.push({
      target: poolAddress,
      callData: encodeFunctionData({
        abi: panopticPoolV2Abi,
        functionName: 'getFullPositionsData',
        args: [account, true, tokenIds],
      }),
    })
  }

  const liqPricesIndex = hasPositions ? calls.length : null
  if (liqPricesIndex !== null) {
    calls.push({
      target: queryAddress,
      callData: encodeFunctionData({
        abi: panopticQueryAbi,
        functionName: 'getLiquidationPrices',
        args: [poolAddress, account, tokenIds],
      }),
    })
  }

  // 3-arg overload: evaluates at (currentTick, fastOracleTick, slowOracleTick,
  // latestObservation) so it needs no tick input and fits this same multicall.
  // We read index 0 (currentTick) to stay consistent with the liquidation price
  // and the risk chart, which are also anchored there.
  const checkCollateralIndex = hasPositions ? calls.length : null
  if (checkCollateralIndex !== null) {
    calls.push({
      target: queryAddress,
      callData: encodeFunctionData({
        abi: panopticQueryAbi,
        functionName: 'checkCollateral',
        args: [poolAddress, account, tokenIds],
      }),
    })
  }

  const { _meta, results } = await readBlockAndAggregate({
    client,
    calls,
    blockNumber: targetBlockNumber,
  })

  const currentTickResult = decodeFunctionResult({
    abi: panopticPoolV2Abi,
    functionName: 'getCurrentTick',
    data: requireReturnData(results, 0, 'PanopticPool.getCurrentTick'),
  })
  const currentTick = BigInt(currentTickResult)
  const assets0 = decodeFunctionResult({
    abi: collateralTrackerV2Abi,
    functionName: 'assetsOf',
    data: requireReturnData(results, 1, 'CollateralTracker.assetsOf token0'),
  })
  const assets1 = decodeFunctionResult({
    abi: collateralTrackerV2Abi,
    functionName: 'assetsOf',
    data: requireReturnData(results, 2, 'CollateralTracker.assetsOf token1'),
  })
  const positionDataResult =
    positionDataIndex === null
      ? null
      : (decodeFunctionResult({
          abi: panopticPoolV2Abi,
          functionName: 'getFullPositionsData',
          data: requireReturnData(results, positionDataIndex, 'PanopticPool.getFullPositionsData'),
        }) as readonly [bigint, bigint, readonly bigint[], readonly bigint[], readonly bigint[]])
  const liqPricesResult =
    liqPricesIndex === null
      ? null
      : (decodeFunctionResult({
          abi: panopticQueryAbi,
          functionName: 'getLiquidationPrices',
          data: requireReturnData(results, liqPricesIndex, 'PanopticQuery.getLiquidationPrices'),
        }) as readonly [number, number])

  const checkCollateralResult =
    checkCollateralIndex === null
      ? null
      : (decodeFunctionResult({
          abi: panopticQueryAbi,
          functionName: 'checkCollateral',
          data: requireReturnData(results, checkCollateralIndex, 'PanopticQuery.checkCollateral'),
        }) as readonly [readonly bigint[], readonly bigint[], readonly bigint[], readonly bigint[]])

  // Usage against the binding constraint, at the current tick (index 0).
  // checkCollateral has already applied the live cross-buffer, so this reflects
  // how much of the surplus in one token genuinely counts toward the other.
  let usageBps0: bigint | null = null
  let usageBps1: bigint | null = null
  let crossMarginUsageBps: bigint | null = null
  let mintableMarginBinding: bigint | null = null
  if (checkCollateralResult) {
    const [balances0, requireds0, balances1, requireds1] = checkCollateralResult
    const ratio = (required: bigint | undefined, balance: bigint | undefined): bigint | null => {
      if (required === undefined || balance === undefined) return null
      // No balance but a requirement is maximally used, not undefined.
      if (balance === 0n) return required > 0n ? MAX_USAGE_BPS : 0n
      return (required * 10_000n) / balance
    }
    usageBps0 = ratio(requireds0[0], balances0[0])
    usageBps1 = ratio(requireds1[0], balances1[0])
    if (usageBps0 !== null || usageBps1 !== null) {
      crossMarginUsageBps =
        usageBps0 === null
          ? usageBps1
          : usageBps1 === null
            ? usageBps0
            : bigintMax(usageBps0, usageBps1)
    }

    // Collateral still deployable before the mint solvency check would fail.
    // Per side: balance - required * mintBuffer, then the tighter of the two,
    // because the mint must satisfy BOTH. Both sides are already in
    // `denominatedInToken` units (checkCollateral branches on the same
    // sqrtPriceX96 < FP96 test), so the min is well defined.
    const mintable = (balance: bigint | undefined, required: bigint | undefined): bigint | null =>
      balance === undefined || required === undefined
        ? null
        : mintableAfterBuffer(balance, required, mintBuffer)
    const mintable0 = mintable(balances0[0], requireds0[0])
    const mintable1 = mintable(balances1[0], requireds1[0])
    if (mintable0 !== null || mintable1 !== null) {
      mintableMarginBinding =
        mintable0 === null
          ? mintable1
          : mintable1 === null
            ? mintable0
            : bigintMin(mintable0, mintable1)
    }
  }

  // Sum collateral requirements across all positions, per token.
  let required0Native = 0n
  let required1Native = 0n
  if (positionDataResult) {
    const collateralRequirements = positionDataResult[3]
    for (const packed of collateralRequirements) {
      const decoded = decodeLeftRightUnsigned(packed)
      required0Native += decoded.right // token0
      required1Native += decoded.left // token1
    }
  }

  // Cross-convert into a single denomination at current tick.
  // The conversion mirrors PanopticQuery.checkCollateral's effective-balance
  // shape so downstream callers keep their existing per-slot interpretation.
  const sqrtPriceX96 = tickToSqrtPriceX96(currentTick)
  const denominatedInToken: 0 | 1 = sqrtPriceX96 < FP96 ? 0 : 1

  // Token0-denominated totals
  const currentMargin0 = assets0 + convert1to0(assets1, sqrtPriceX96)
  const requiredMargin0 = required0Native + convert1to0(required1Native, sqrtPriceX96)
  // Token1-denominated totals
  const currentMargin1 = assets1 + convert0to1(assets0, sqrtPriceX96)
  const requiredMargin1 = required1Native + convert0to1(required0Native, sqrtPriceX96)

  const buffer0 = currentMargin0 - requiredMargin0
  const buffer1 = currentMargin1 - requiredMargin1
  const bufferPercent0 = requiredMargin0 === 0n ? null : (buffer0 * 10000n) / requiredMargin0
  const bufferPercent1 = requiredMargin1 === 0n ? null : (buffer1 * 10000n) / requiredMargin1

  // Liquidation prices: present only when the account has positions.
  let lowerLiquidationTick: bigint | null = null
  let upperLiquidationTick: bigint | null = null
  let liquidationDistance: bigint | null = null
  if (liqPricesResult) {
    const liqPriceDown = BigInt(liqPricesResult[0])
    const liqPriceUp = BigInt(liqPricesResult[1])
    lowerLiquidationTick = liqPriceDown === MIN_TICK ? null : liqPriceDown
    upperLiquidationTick = liqPriceUp === MAX_TICK ? null : liqPriceUp
    if (lowerLiquidationTick !== null && upperLiquidationTick !== null) {
      const distLower = currentTick - lowerLiquidationTick
      const distUpper = upperLiquidationTick - currentTick
      liquidationDistance = distLower < distUpper ? distLower : distUpper
    } else if (lowerLiquidationTick !== null) {
      liquidationDistance = currentTick - lowerLiquidationTick
    } else if (upperLiquidationTick !== null) {
      liquidationDistance = upperLiquidationTick - currentTick
    }
  }

  return {
    buffer0,
    buffer1,
    bufferPercent0,
    bufferPercent1,
    currentMargin0,
    currentMargin1,
    requiredMargin0,
    requiredMargin1,
    denominatedInToken,
    liquidationDistance,
    lowerLiquidationTick,
    upperLiquidationTick,
    crossMarginUsageBps,
    usageBps0,
    usageBps1,
    mintableMarginBinding,
    currentTick,
    _meta,
  }
}
