import { describe, expect, it } from 'vitest'

import { InvalidHistoryRangeError } from '../errors/sdk'
import { interpolateBlocks } from './interpolateBlocks'

describe('interpolateBlocks', () => {
  it('returns empty array for 0 points', () => {
    expect(interpolateBlocks(100n, 200n, 0)).toEqual([])
  })

  it('returns [endBlock] for 1 point', () => {
    expect(interpolateBlocks(100n, 200n, 1)).toEqual([200n])
  })

  it('returns evenly spaced blocks for multiple points', () => {
    const result = interpolateBlocks(100n, 200n, 3)
    expect(result).toEqual([100n, 150n, 200n])
  })

  it('returns start and end for 2 points', () => {
    expect(interpolateBlocks(0n, 100n, 2)).toEqual([0n, 100n])
  })

  it('handles same start and end block', () => {
    const result = interpolateBlocks(50n, 50n, 5)
    expect(result).toEqual([50n, 50n, 50n, 50n, 50n])
  })

  it('throws InvalidHistoryRangeError for negative points', () => {
    expect(() => interpolateBlocks(0n, 100n, -1)).toThrow(InvalidHistoryRangeError)
  })

  it('throws InvalidHistoryRangeError when startBlock > endBlock', () => {
    expect(() => interpolateBlocks(200n, 100n, 5)).toThrow(InvalidHistoryRangeError)
  })

  it('throws InvalidHistoryRangeError for non-integer points', () => {
    expect(() => interpolateBlocks(0n, 100n, 1.5)).toThrow(InvalidHistoryRangeError)
  })

  it('throws InvalidHistoryRangeError for NaN points', () => {
    expect(() => interpolateBlocks(0n, 100n, NaN)).toThrow(InvalidHistoryRangeError)
  })

  it('throws InvalidHistoryRangeError for Infinity points', () => {
    expect(() => interpolateBlocks(0n, 100n, Infinity)).toThrow(InvalidHistoryRangeError)
  })

  it('produces correct integer division for non-divisible ranges', () => {
    const result = interpolateBlocks(0n, 10n, 4)
    // 0, 10*1/3=3, 10*2/3=6, 10
    expect(result).toEqual([0n, 3n, 6n, 10n])
  })
})
