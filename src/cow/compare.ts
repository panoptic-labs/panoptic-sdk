/**
 * Venue selection between the Uniswap v4 router and CoW Swap.
 *
 * Pure amount comparison so it stays testable and reusable outside React.
 * Gas cost of the router tx is not factored in (CoW ERC20 sells are gasless);
 * TODO: optionally discount the Uniswap side by gasEstimate × gas price.
 *
 * @module cow/compare
 */

/** Swap venues the UI can route through. */
export type SwapVenue = 'uniswap' | 'cow'

const BPS_DENOMINATOR = 10_000n

/** Parameters for {@link pickBestVenue}. */
export interface PickBestVenueParams {
  /** 'sell' = exact-in (maximize output), 'buy' = exact-out (minimize input). */
  kind: 'sell' | 'buy'
  /** Uniswap quote amounts; omit when the quote failed or is unavailable. */
  uniswap?: {
    /** Quoted output (exact-in). */
    amountOut?: bigint
    /** Quoted input (exact-out). */
    amountIn?: bigint
  }
  /** CoW quote amounts; omit when the quote failed or is unavailable. */
  cow?: {
    /** Quoted net output (exact-in). */
    buyAmount?: bigint
    /** Quoted gross input including fee (exact-out). */
    sellAmountTotal?: bigint
  }
}

/** Result of {@link pickBestVenue}. */
export interface BestVenue {
  winner: SwapVenue
  /** Price advantage of the winner over the loser in bps (only when both quoted). */
  advantageBps?: bigint
}

/**
 * Pick the venue with the better effective price. Exact-in compares net
 * output (higher wins); exact-out compares gross input (lower wins). With a
 * single usable quote that venue wins; ties go to Uniswap (instant
 * settlement); with no usable quotes Uniswap wins by default.
 */
export function pickBestVenue(params: PickBestVenueParams): BestVenue {
  const { kind, uniswap, cow } = params

  const uniAmount = kind === 'sell' ? uniswap?.amountOut : uniswap?.amountIn
  const cowAmount = kind === 'sell' ? cow?.buyAmount : cow?.sellAmountTotal

  if (cowAmount === undefined || cowAmount <= 0n) return { winner: 'uniswap' }
  if (uniAmount === undefined || uniAmount <= 0n) return { winner: 'cow' }

  // 'sell': bigger output wins; 'buy': smaller input wins. Ties → Uniswap.
  const cowWins = kind === 'sell' ? cowAmount > uniAmount : cowAmount < uniAmount
  const [better, worse] = cowWins ? [cowAmount, uniAmount] : [uniAmount, cowAmount]
  const advantageBps =
    kind === 'sell'
      ? ((better - worse) * BPS_DENOMINATOR) / worse
      : ((worse - better) * BPS_DENOMINATOR) / better

  return { winner: cowWins ? 'cow' : 'uniswap', advantageBps }
}
