import { describe, expect, it } from 'vitest'

import { PanopticValidationError } from '../errors'
import {
  applyMintBuffer,
  applyMintBufferPerToken,
  DEFAULT_MINT_BUFFER,
  MINT_BUFFER,
  MINT_BUFFER_DENOMINATOR,
  mintableAfterBuffer,
} from './mintBuffer'

/** Reference implementation of the contract's `Math.mulDivRoundingUp`. */
const mulDivRoundingUp = (a: bigint, b: bigint, d: bigint): bigint => (a * b + d - 1n) / d

describe('applyMintBuffer', () => {
  it('matches the on-chain BP_DECREASE_BUFFER / DECIMALS ratio', () => {
    expect(MINT_BUFFER).toBe(10_666_667n)
    expect(MINT_BUFFER_DENOMINATOR).toBe(10_000_000n)
  })

  it('agrees with mulDivRoundingUp across magnitudes', () => {
    for (const required of [1n, 2n, 3n, 999n, 1_000n, 123_456_789n, 10n ** 24n, 2n ** 100n]) {
      expect(applyMintBuffer(required)).toBe(
        mulDivRoundingUp(required, MINT_BUFFER, MINT_BUFFER_DENOMINATOR),
      )
    }
  })

  it('rounds UP rather than truncating', () => {
    // 3 * 10_666_667 = 32_000_001 -> /10_000_000 = 3.0000001 -> ceil 4, floor 3.
    expect(applyMintBuffer(3n)).toBe(4n)
    expect((3n * MINT_BUFFER) / MINT_BUFFER_DENOMINATOR).toBe(3n)
  })

  it('is strictly above the truncated 10_666/10_000 form the UI used', () => {
    const required = 1_000_000_000n
    const legacy = (required * 10_666n) / 10_000n
    expect(applyMintBuffer(required)).toBeGreaterThan(legacy)
  })

  it('returns 0 for zero or negative requirements', () => {
    expect(applyMintBuffer(0n)).toBe(0n)
    expect(applyMintBuffer(-5n)).toBe(0n)
  })

  it('honours a live on-chain ratio', () => {
    expect(applyMintBuffer(100n, { numerator: 20n, denominator: 10n })).toBe(200n)
  })

  it('rejects a non-positive denominator', () => {
    expect(() => applyMintBuffer(1n, { numerator: 1n, denominator: 0n })).toThrow(
      PanopticValidationError,
    )
  })

  it('exposes the defaults as a ratio', () => {
    expect(DEFAULT_MINT_BUFFER).toEqual({
      numerator: MINT_BUFFER,
      denominator: MINT_BUFFER_DENOMINATOR,
    })
  })
})

describe('applyMintBufferPerToken', () => {
  it('buffers each side independently, never pooling them', () => {
    const [b0, b1] = applyMintBufferPerToken(3n, 1_000_000n)
    expect(b0).toBe(applyMintBuffer(3n))
    expect(b1).toBe(applyMintBuffer(1_000_000n))
    // Pooling first would lose the per-side ceil on the small side.
    expect(b0 + b1).toBeGreaterThan(applyMintBuffer(3n + 1_000_000n) - 1n)
  })
})

describe('mintableAfterBuffer', () => {
  it('returns the headroom above the buffered requirement', () => {
    expect(mintableAfterBuffer(10_000_000n, 1_000_000n)).toBe(
      10_000_000n - applyMintBuffer(1_000_000n),
    )
  })

  it('floors at zero when the buffered requirement exceeds the balance', () => {
    expect(mintableAfterBuffer(1_000_000n, 1_000_000n)).toBe(0n)
    expect(mintableAfterBuffer(0n, 1n)).toBe(0n)
  })
})
