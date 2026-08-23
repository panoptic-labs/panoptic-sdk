/**
 * The mint-time margin buffer — the single place the SDK and every UI surface
 * turn a maintenance requirement into the figure the contract actually enforces
 * at mint.
 *
 * `RiskEngine._checkSolvencyAtTick` applies `BP_DECREASE_BUFFER / DECIMALS` to
 * the NATIVE token0 and token1 requirements, with `Math.mulDivRoundingUp`, and
 * only then compares each side against that side's balance. Three properties of
 * that sentence are load-bearing and were each wrong somewhere in the UI:
 *
 *  1. **Scale.** The ratio is `10_666_667 / 10_000_000`, not `10_666 / 10_000`.
 *     The truncated form understates the requirement by ~6.3 ppm of notional.
 *  2. **Rounding.** The contract rounds UP. Flooring lets a position read as
 *     affordable at exactly the boundary and then revert at mint.
 *  3. **Order.** The buffer is applied per token BEFORE any price conversion.
 *     Buffering an already-quote-converted total re-rounds the conversion dust
 *     through the buffer, so the two disagree by more than the ratio implies.
 *
 * @module v2/reads/mintBuffer
 */

import { PanopticValidationError } from '../errors'
import type { MintBufferRatio } from '../types/mintBuffer'

export type { MintBufferRatio } from '../types/mintBuffer'

/**
 * `RiskEngine.BP_DECREASE_BUFFER` — the numerator of the mint-time buffer.
 *
 * Exported so callers can display the constant; prefer {@link applyMintBuffer}
 * over multiplying by it directly, which is how the rounding bug reappears.
 */
export const MINT_BUFFER = 10_666_667n

/** `RiskEngine.DECIMALS` — the denominator {@link MINT_BUFFER} is taken over. */
export const MINT_BUFFER_DENOMINATOR = 10_000_000n

/** The compiled-in default, matching the deployed RiskEngine. */
export const DEFAULT_MINT_BUFFER: MintBufferRatio = {
  numerator: MINT_BUFFER,
  denominator: MINT_BUFFER_DENOMINATOR,
}

/**
 * Apply the mint buffer to ONE token's NATIVE requirement, rounding up exactly
 * as `Math.mulDivRoundingUp` does on-chain.
 *
 * Call this on the native token0/token1 requirement, never on a quote-converted
 * total — see the module docstring for why the order matters.
 *
 * @param required - Maintenance requirement in that token's own units
 * @param buffer - Optional live on-chain ratio; defaults to {@link DEFAULT_MINT_BUFFER}
 * @returns The mint-time requirement the solvency check enforces
 */
export function applyMintBuffer(
  required: bigint,
  buffer: MintBufferRatio = DEFAULT_MINT_BUFFER,
): bigint {
  const { numerator, denominator } = buffer
  if (denominator <= 0n) {
    throw new PanopticValidationError('applyMintBuffer: buffer denominator must be positive')
  }
  if (required <= 0n) return 0n
  return (required * numerator + denominator - 1n) / denominator
}

/**
 * Apply the mint buffer to both tokens' NATIVE requirements, independently.
 *
 * This is the shape the solvency check itself uses: two separate per-side
 * comparisons, never a pooled total.
 *
 * @param required0 - Maintenance requirement in token0 units
 * @param required1 - Maintenance requirement in token1 units
 * @param buffer - Optional live on-chain ratio
 * @returns `[buffered0, buffered1]`
 */
export function applyMintBufferPerToken(
  required0: bigint,
  required1: bigint,
  buffer: MintBufferRatio = DEFAULT_MINT_BUFFER,
): [bigint, bigint] {
  return [applyMintBuffer(required0, buffer), applyMintBuffer(required1, buffer)]
}

/**
 * Collateral still deployable on one side before the mint solvency check fails:
 * `balance - bufferedRequired`, floored at zero.
 *
 * Both arguments must be in the SAME token's units.
 *
 * @param balance - That side's collateral balance
 * @param required - That side's maintenance requirement (unbuffered)
 * @param buffer - Optional live on-chain ratio
 * @returns Mintable headroom, never negative
 */
export function mintableAfterBuffer(
  balance: bigint,
  required: bigint,
  buffer: MintBufferRatio = DEFAULT_MINT_BUFFER,
): bigint {
  const requiredAtMint = applyMintBuffer(required, buffer)
  return balance > requiredAtMint ? balance - requiredAtMint : 0n
}
