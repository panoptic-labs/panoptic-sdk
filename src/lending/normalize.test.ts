import { describe, expect, it } from 'vitest'

import { normalizeTokenDecimals, normalizeUnsignedBigInt } from './normalize'

describe('portfolio value normalization', () => {
  it.each([
    [0n, 0n],
    ['42', 42n],
    [42, 42n],
  ])('normalizes unsigned integer value %s', (value, expected) => {
    expect(normalizeUnsignedBigInt(value)).toBe(expected)
  })

  it.each([-1n, '-1', -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1.5', null])(
    'rejects invalid unsigned integer value %s',
    (value) => {
      expect(() => normalizeUnsignedBigInt(value)).toThrow()
    },
  )

  it.each([
    [0, 0],
    ['18', 18],
    [255, 255],
  ])('normalizes token decimals %s', (value, expected) => {
    expect(normalizeTokenDecimals(value)).toBe(expected)
  })

  it.each([-1, 256, 1.5, Number.MAX_SAFE_INTEGER + 1, '-1', '1.5', null])(
    'rejects invalid token decimals %s',
    (value) => {
      expect(() => normalizeTokenDecimals(value)).toThrow()
    },
  )
})
