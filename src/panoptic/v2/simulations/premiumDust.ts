/** Aggregate dust is at most 1e-16 tokens; lower-precision assets remain exact. */
export function getPremiumDustTolerance(token0Decimals: bigint, token1Decimals: bigint) {
  return [token0Decimals >= 18n ? 100n : 0n, token1Decimals >= 18n ? 100n : 0n] as const
}
