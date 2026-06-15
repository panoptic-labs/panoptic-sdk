import { describe, expect, it } from 'vitest'

import {
  getXstockUnderlying,
  getXstockWrapper,
  isXstockUnderlying,
  isXstockWrapper,
  XSTOCK_WRAPPERS,
} from './xstockWrappers'

const MAINNET = 1

describe('xstockWrappers', () => {
  it('ships a non-empty mainnet registry', () => {
    expect((XSTOCK_WRAPPERS[MAINNET] ?? []).length).toBeGreaterThan(0)
  })

  it('every entry round-trips between underlying and wrapper', () => {
    for (const entry of XSTOCK_WRAPPERS[MAINNET] ?? []) {
      const byUnderlying = getXstockWrapper(MAINNET, entry.underlying)
      const byWrapper = getXstockUnderlying(MAINNET, entry.wrapper)
      expect(byUnderlying?.wrapper).toBe(entry.wrapper)
      expect(byWrapper?.underlying).toBe(entry.underlying)
    }
  })

  it('resolves case-insensitively', () => {
    const entry = (XSTOCK_WRAPPERS[MAINNET] ?? [])[0]
    expect(entry).toBeDefined()
    expect(getXstockWrapper(MAINNET, entry.underlying.toLowerCase() as `0x${string}`)).toBeDefined()
    expect(
      getXstockWrapper(
        MAINNET,
        entry.underlying.toUpperCase().replace('0X', '0x') as `0x${string}`,
      ),
    ).toBeDefined()
  })

  it('returns undefined for unknown tokens and unknown chains', () => {
    const unknown = '0x000000000000000000000000000000000000dEaD'
    expect(getXstockWrapper(MAINNET, unknown)).toBeUndefined()
    expect(getXstockUnderlying(MAINNET, unknown)).toBeUndefined()
    expect(isXstockUnderlying(MAINNET, unknown)).toBe(false)
    expect(isXstockWrapper(MAINNET, unknown)).toBe(false)
    const entry = (XSTOCK_WRAPPERS[MAINNET] ?? [])[0]
    expect(entry).toBeDefined()
    expect(getXstockWrapper(999_999, entry.underlying)).toBeUndefined()
  })

  it('flags known underlying / wrapper addresses', () => {
    const entry = (XSTOCK_WRAPPERS[MAINNET] ?? [])[0]
    expect(entry).toBeDefined()
    expect(isXstockUnderlying(MAINNET, entry.underlying)).toBe(true)
    expect(isXstockWrapper(MAINNET, entry.wrapper)).toBe(true)
  })
})
