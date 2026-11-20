/**
 * Plan a self-funded covered call minted directly on the v3 SFPM.
 * @module v2/sfpmCoveredCall/open
 */
import { type Address, type Hex, encodeFunctionData } from 'viem'

import { semiFungiblePositionManagerV3Abi as sfpmV3Abi } from '../../../generated'
import { PanopticValidationError } from '../errors'
import { sqrtPriceX96ToTick, tickToSqrtPriceX96 } from '../formatters/tick'
import { getLegLiquidityRange } from '../greeks/legLiquidity'
import { buildSfpmSwapCalldata, buildSfpmSwapPlan, slippageBpsToTickDistance } from '../sfpmSwap'
import { encodeV3PoolKeyBytes } from '../simulations/sfpm'
import { createTokenIdBuilder, decodeTickSpacing } from '../tokenId'
import { MAX_TICK, MIN_TICK } from '../utils/constants'

const Q96 = 1n << 96n
const FEE_DENOMINATOR = 1_000_000n
const BPS = 10_000n

export interface PlanSfpmCoveredCallOpenParams {
  /** SemiFungiblePositionManagerV3 address */
  sfpmAddress: Address
  /** Underlying Uniswap v3 pool */
  poolAddress: Address
  /** SFPM poolId from `fetchSfpmV3PoolId` */
  poolId: bigint
  /** Pool index of the token the user locks */
  assetIdx: 0n | 1n
  strike: bigint
  /** Range width in tick spacings */
  width: bigint
  /** Asset the user locks */
  deposit: bigint
  currentTick: bigint
  /**
   * The pool's exact `slot0` sqrt price. Sizes the mint at the real price inside the tick;
   * without it the price is taken at `currentTick`'s lower boundary.
   */
  sqrtPriceX96?: bigint
  /** The pool's active liquidity, which sets the swap's price impact */
  liquidity: bigint
  /** Uniswap fee tier in hundredths of a bip (3000 = 0.30%) */
  fee: number
  /** Bound on how far the pool tick may move during the transaction */
  slippageBps: bigint
}

/** One SFPM multicall that swaps asset for the range's quote share, then mints the call. */
export interface SfpmCoveredCallOpen {
  /** The SFPM address */
  to: Address
  /** `multicall(bytes[])` calldata */
  data: Hex
  /** Inner calls in order: `[swapMint, swapBurn, mint]`, or `[mint]` when no quote is needed. */
  calls: Hex[]
  /** Single short-call leg the account will hold on the SFPM */
  tokenId: bigint
  positionSize: bigint
  /** Quote token bought for the range; zero when the range holds only the asset. */
  quoteBought: bigint
  /** Asset the account should approve: the expected spend plus the slippage margin, at most `deposit`. */
  maxAssetIn: bigint
}

function ceilDiv(numerator: bigint, denominator: bigint) {
  return (numerator + denominator - 1n) / denominator
}

/** Tokens the SFPM pulls to mint `positionSize` of the call at `sqrtPrice`, rounded up like Uniswap. */
function mintAmounts(
  leg: Parameters<typeof getLegLiquidityRange>[0],
  positionSize: bigint,
  tickSpacing: bigint,
  sqrtPrice: bigint,
) {
  const { sqrtLower, sqrtUpper, liquidity } = getLegLiquidityRange(leg, positionSize, tickSpacing)
  const sqrtA = sqrtLower <= sqrtUpper ? sqrtLower : sqrtUpper
  const sqrtB = sqrtLower <= sqrtUpper ? sqrtUpper : sqrtLower
  const sqrtC = sqrtPrice < sqrtA ? sqrtA : sqrtPrice > sqrtB ? sqrtB : sqrtPrice
  // SqrtPriceMath.getAmount0Delta / getAmount1Delta with roundUp = true.
  const amount0 =
    sqrtC < sqrtB ? ceilDiv(ceilDiv(liquidity * Q96 * (sqrtB - sqrtC), sqrtB), sqrtC) : 0n
  const amount1 = sqrtC > sqrtA ? ceilDiv(liquidity * (sqrtC - sqrtA), Q96) : 0n
  return [amount0, amount1] as const
}

/**
 * The tick Uniswap v3 records after a swap ends at `sqrtPrice`: the floor tick, except
 * that a downward swap landing exactly on a tick boundary steps below it.
 */
function executionTick(sqrtPrice: bigint, zeroForOne: boolean) {
  let tick = sqrtPriceX96ToTick(sqrtPrice)
  const atTick = tickToSqrtPriceX96(tick)
  if (atTick > sqrtPrice) tick -= 1n
  else if (zeroForOne && atTick === sqrtPrice) tick -= 1n
  return tick
}

/**
 * Exact-output swap of `quote` against the pool's active liquidity: the asset it
 * costs (fee included) and the tick it leaves. Assumes the swap does not cross an
 * initialized tick; the SFPM tick band catches a larger move.
 */
function quoteSwap(
  quote: bigint,
  assetIdx: 0n | 1n,
  sqrtPrice: bigint,
  liquidity: bigint,
  fee: number,
) {
  const reserve = liquidity * Q96
  let sqrtNext: bigint
  let amountIn: bigint
  if (assetIdx === 0n) {
    sqrtNext = sqrtPrice - ceilDiv(quote * Q96, liquidity)
    if (sqrtNext <= 0n) return undefined
    amountIn = ceilDiv(reserve * (sqrtPrice - sqrtNext), sqrtNext * sqrtPrice)
  } else {
    const denominator = reserve - quote * sqrtPrice
    if (denominator <= 0n) return undefined
    sqrtNext = ceilDiv(reserve * sqrtPrice, denominator)
    amountIn = ceilDiv(liquidity * (sqrtNext - sqrtPrice), Q96)
  }
  return {
    assetIn: ceilDiv(amountIn * FEE_DENOMINATOR, FEE_DENOMINATOR - BigInt(fee)),
    sqrtNext,
    finalTick: executionTick(sqrtNext, assetIdx === 0n),
  }
}

/**
 * Size and encode a covered call that locks at most `deposit` of the asset.
 *
 * When the price is inside the range, the call also holds some quote token. The
 * multicall first buys that quote with an exact-output SFPM swap paid in the
 * asset, then mints the range at the price the swap leaves. When it swaps, the
 * size leaves a `slippageBps` margin of the deposit unspent; approve the SFPM for exactly
 * {@link SfpmCoveredCallOpen.maxAssetIn} so a worse fill reverts instead of
 * pulling more. Rounding dust stays in the wallet.
 */
export function planSfpmCoveredCallOpen(
  params: PlanSfpmCoveredCallOpenParams,
): SfpmCoveredCallOpen {
  const {
    sfpmAddress,
    poolAddress,
    poolId,
    assetIdx,
    strike,
    width,
    deposit,
    currentTick,
    liquidity,
    fee,
    slippageBps,
  } = params
  if (deposit <= 0n) throw new PanopticValidationError(`deposit must be positive (got ${deposit})`)
  const tickSpacing = decodeTickSpacing(poolId)
  const quoteIdx = assetIdx === 0n ? 1n : 0n
  const leg = {
    asset: assetIdx,
    optionRatio: 1n,
    isLong: false,
    tokenType: assetIdx,
    strike,
    width,
  }
  const distance = slippageBpsToTickDistance(slippageBps)
  if (distance < 1n) throw new PanopticValidationError('slippage must cover at least one tick')
  const sqrtPrice = params.sqrtPriceX96 ?? tickToSqrtPriceX96(currentTick)

  const assetNeeded = (size: bigint) => {
    const quote = mintAmounts(leg, size, tickSpacing, sqrtPrice)[Number(quoteIdx)] ?? 0n
    const swap =
      quote > 0n
        ? quoteSwap(quote, assetIdx, sqrtPrice, liquidity, fee)
        : { assetIn: 0n, sqrtNext: sqrtPrice, finalTick: currentTick }
    if (!swap) return undefined
    const asset = mintAmounts(leg, size, tickSpacing, swap.sqrtNext)[Number(assetIdx)] ?? 0n
    return {
      quote,
      asset,
      finalTick: swap.finalTick,
      // Without a swap the mint is fixed by the size; with one it depends on the fill.
      total: quote > 0n ? ceilDiv((asset + swap.assetIn) * (BPS + slippageBps), BPS) : asset,
    }
  }
  const tooLarge = () =>
    new PanopticValidationError('the swap is too large for the pool; lower the amount')

  if (mintAmounts(leg, deposit, tickSpacing, sqrtPrice)[Number(assetIdx)] === 0n)
    throw new PanopticValidationError(
      'the range holds none of the asset at the current price; pick a higher strike',
    )
  const atDeposit = assetNeeded(deposit)
  if (!atDeposit) throw tooLarge()
  let positionSize = atDeposit.total <= deposit ? deposit : (deposit * deposit) / atDeposit.total
  let sized = assetNeeded(positionSize)
  // The swap's price impact makes the need slightly convex in size; step down until it fits.
  while (positionSize > 0n && (!sized || sized.total > deposit)) {
    positionSize -= ceilDiv(positionSize, 10_000n)
    sized = assetNeeded(positionSize)
  }
  if (!sized || positionSize <= 0n || sized.asset === 0n)
    throw new PanopticValidationError(
      'the range holds none of the asset at the current price; pick a higher strike',
    )
  // The SFPM's post-swap tick check is an open interval: the band's limits fail too.
  const moved = sized.finalTick - currentTick
  if (moved >= distance || -moved >= distance) throw tooLarge()
  if (sized.finalTick - distance <= MIN_TICK || sized.finalTick + distance >= MAX_TICK)
    throw new PanopticValidationError(
      `slippage band around tick ${sized.finalTick} leaves the valid tick range`,
    )

  const tokenId = createTokenIdBuilder(poolId).addLeg(leg).build()
  const d = Number(distance)
  const mint = encodeFunctionData({
    abi: sfpmV3Abi,
    functionName: 'mintTokenizedPosition',
    args: [
      encodeV3PoolKeyBytes(poolAddress),
      tokenId,
      positionSize,
      Number(sized.finalTick) - d,
      Number(sized.finalTick) + d,
    ],
  })
  const calls: Hex[] = []
  if (sized.quote > 0n) {
    const swap = buildSfpmSwapCalldata(
      buildSfpmSwapPlan({
        sfpmAddress,
        poolAddress,
        poolId,
        kind: 'exactOut',
        zeroForOne: assetIdx === 0n,
        amount: sized.quote,
        currentTick: Number(currentTick),
        slippageBps,
      }),
    )
    calls.push(swap.mintData, swap.burnData)
  }
  calls.push(mint)
  return {
    to: sfpmAddress,
    data: encodeFunctionData({ abi: sfpmV3Abi, functionName: 'multicall', args: [calls] }),
    calls,
    tokenId,
    positionSize,
    quoteBought: sized.quote,
    maxAssetIn: sized.total,
  }
}
