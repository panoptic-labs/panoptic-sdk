import { describe, expect, it } from 'vitest'

import { logReturns, realizedBeta } from './beta'

describe('realizedBeta', () => {
  it('recovers a known slope: token = 2·ref exactly', () => {
    const ref = [0.01, -0.02, 0.03, -0.01, 0.02, 0.0, -0.03, 0.015, 0.005, -0.02]
    const token = ref.map((r) => 2 * r)
    const result = realizedBeta(token, ref)
    expect(result?.beta).toBeCloseTo(2, 9)
    expect(result?.rSquared).toBeCloseTo(1, 9)
    expect(result?.samples).toBe(ref.length)
  })
  it('recovers slope and intercept-free R² with added noise', () => {
    const ref = Array.from({ length: 50 }, (_, i) => Math.sin(i))
    const token = ref.map((r, i) => 1.5 * r + (i % 2 === 0 ? 0.01 : -0.01))
    const result = realizedBeta(token, ref)
    expect(result?.beta).toBeCloseTo(1.5, 1)
    expect(result?.rSquared).toBeGreaterThan(0.9)
  })
  it('returns null on too few samples', () => {
    expect(realizedBeta([0.01, 0.02], [0.01, 0.02])).toBeNull()
  })
  it('returns null when the reference is exactly constant (no variance)', () => {
    const flat = new Array(10).fill(0)
    expect(realizedBeta([0.01, 0.02, 0.03, 0.01, 0.02, 0, 0.03, 0.01, 0.02, 0], flat)).toBeNull()
  })
  it('ignores non-finite paired observations', () => {
    const ref = [0.01, Number.NaN, 0.03, -0.01, 0.02, 0.0, -0.03, 0.015, 0.005, -0.02]
    const token = ref.map((r) => (Number.isFinite(r) ? 2 * r : 999))
    const result = realizedBeta(token, ref)
    expect(result?.beta).toBeCloseTo(2, 9)
    expect(result?.samples).toBe(ref.length - 1)
  })
})

describe('logReturns', () => {
  it('computes log returns and is one shorter than input', () => {
    const r = logReturns([100, 110, 121])
    expect(r).toHaveLength(2)
    expect(r[0]).toBeCloseTo(Math.log(1.1), 12)
    expect(r[1]).toBeCloseTo(Math.log(1.1), 12)
  })
  it('emits NaN for non-positive prices to keep alignment', () => {
    const r = logReturns([100, 0, 121])
    expect(Number.isNaN(r[0])).toBe(true)
    expect(Number.isNaN(r[1])).toBe(true)
  })
})
