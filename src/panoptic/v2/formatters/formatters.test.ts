/**
 * Tests for formatter utilities.
 * @module v2/formatters/formatters.test
 */

import { describe, expect, it } from 'vitest'

import { MAX_TICK, MIN_TICK } from '../utils/constants'
import {
  formatTokenAmount,
  formatTokenAmountSigned,
  formatTokenDelta,
  formatTokenFlow,
  parseTokenAmount,
} from './amount'
import {
  formatCompact,
  formatDatetime,
  formatDuration,
  formatDurationSeconds,
  formatGas,
  formatGwei,
  formatPoolIdHex,
  formatTimestamp,
  formatTokenIdHex,
  formatTokenIdShort,
  formatTxHash,
  formatWei,
} from './display'
import { formatBps, formatRatioPercent, formatUtilization, parseBps } from './percentage'
import {
  formatPriceRange,
  formatTickRange,
  getPricesAtTick,
  getTickSpacing,
  priceToTick,
  roundToTickSpacing,
  sqrtPriceX96ToPriceDecimalScaled,
  sqrtPriceX96ToTick,
  tickToPrice,
  tickToPriceDecimalScaled,
  tickToSqrtPriceX96,
} from './tick'
import { formatFeeTier, getPoolDisplayId, getTokenListId, parseTokenListId } from './tokenList'
import { formatRateWad, formatWad, formatWadPercent, formatWadSigned, parseWad } from './wad'

describe('tick formatters', () => {
  it('formats raw tick price at zero', () => {
    expect(tickToPrice(0n)).toBe('1')
  })

  it('applies decimal scaling at zero tick', () => {
    expect(tickToPriceDecimalScaled(0n, 18n, 6n, 2n)).toBe('1000000000000.00')
  })

  it('round-trips neutral prices to tick 0', () => {
    expect(priceToTick('1', 18n, 18n)).toBe(0n)
    expect(priceToTick('1000000000000', 18n, 6n)).toBe(0n)
  })

  it('formats sqrtPriceX96 values', () => {
    const q96 = 2n ** 96n
    expect(sqrtPriceX96ToPriceDecimalScaled(q96, 18n, 18n, 2n)).toBe('1.00')
    expect(sqrtPriceX96ToTick(q96)).toBe(0n)
  })

  it('round-trips sqrtPriceX96 to tick', () => {
    const tick = 123n
    const sqrtPriceX96 = tickToSqrtPriceX96(tick)
    expect(sqrtPriceX96ToTick(sqrtPriceX96)).toBe(tick)
  })

  it('enforces sqrtPriceX96 bounds', () => {
    const minSqrt = tickToSqrtPriceX96(MIN_TICK)
    const maxSqrt = tickToSqrtPriceX96(MAX_TICK)
    expect(() => sqrtPriceX96ToTick(0n)).toThrow(Error)
    expect(() => sqrtPriceX96ToTick(minSqrt - 1n)).toThrow(RangeError)
    expect(() => sqrtPriceX96ToTick(maxSqrt + 1n)).toThrow(RangeError)
  })

  it('returns inverse prices at a tick', () => {
    const prices = getPricesAtTick(0n, 6n, 6n, 4n)
    expect(prices.token0PerToken1).toBe('1.0000')
    expect(prices.token1PerToken0).toBe('1.0000')
  })

  it('formats tick and price ranges', () => {
    expect(formatTickRange(-50000n, 200000n)).toBe('-50000 - 200000')
    expect(formatPriceRange(0n, 0n, 18n, 18n, 2n)).toBe('1.00 - 1.00')
  })

  it('handles tick spacing helpers', () => {
    expect(getTickSpacing(100n)).toBe(1n)
    expect(getTickSpacing(500n)).toBe(10n)
    expect(getTickSpacing(3000n)).toBe(60n)
    expect(getTickSpacing(150n)).toBe(3n)

    expect(roundToTickSpacing(12345n, 10n)).toBe(12350n)
    expect(roundToTickSpacing(12345n, 60n)).toBe(12360n)
    expect(roundToTickSpacing(-12345n, 10n)).toBe(-12350n)
  })

  it('rounding to tick spacing yields multiples', () => {
    const ticks = [-12345n, -1n, 0n, 1n, 12345n]
    const spacings = [1n, 10n, 60n]
    for (const tick of ticks) {
      for (const spacing of spacings) {
        const rounded = roundToTickSpacing(tick, spacing)
        expect(rounded % spacing).toBe(0n)
      }
    }
  })

  it('tickToSqrtPriceX96 is strictly increasing', () => {
    const ticks = [-1000n, -10n, 0n, 10n, 1000n]
    for (let i = 1; i < ticks.length; i += 1) {
      const prev = tickToSqrtPriceX96(ticks[i - 1])
      const next = tickToSqrtPriceX96(ticks[i])
      expect(next > prev).toBe(true)
    }
  })

  it('priceToTick rejects non-positive prices', () => {
    expect(() => priceToTick('0', 18n, 18n)).toThrow(Error)
    expect(() => priceToTick('-1', 18n, 18n)).toThrow(Error)
  })
})

describe('display formatters', () => {
  it('formats durations with BigInt math', () => {
    expect(formatDuration(150n)).toBe('150ms')
    expect(formatDuration(1500n)).toBe('1.5s')
    expect(formatDuration(90000n)).toBe('1m 30s')
    expect(formatDuration(3661000n)).toBe('1h 1m')
    expect(formatDuration(-1500n)).toBe('-1.5s')
    expect(formatDurationSeconds(90n)).toBe('1m 30s')
    expect(formatDuration(60000n)).toBe('1m')
    expect(formatDuration(3600000n)).toBe('1h')
  })

  it('formats compact numbers with suffixes', () => {
    expect(formatCompact(999n)).toBe('999')
    expect(formatCompact(1234n, 1n)).toBe('1.2K')
    expect(formatCompact(1234567n, 1n)).toBe('1.2M')
    expect(formatCompact(1234567890n, 1n)).toBe('1.2B')
    expect(formatCompact(-1234n, 1n)).toBe('-1.2K')
    expect(formatCompact(1000n, 1n)).toBe('1.0K')
    expect(formatCompact(1_000_000n, 1n)).toBe('1.0M')
  })

  it('formats gas and wei units', () => {
    expect(formatGas(999n)).toBe('999')
    expect(formatWei(123n)).toBe('123 wei')
    expect(formatGwei(1_000_000_000n, 2n)).toBe('1.00 gwei')
  })

  it('formats token and pool ids', () => {
    expect(formatTokenIdHex(255n)).toBe('0xff')
    expect(formatPoolIdHex(1024n)).toBe('0x400')
    expect(formatTokenIdShort(0x1234567890abcdefn, 4)).toBe('0x1234...cdef')
  })

  it('formats timestamps', () => {
    expect(formatTimestamp(0n)).toBe('1970-01-01')
    expect(formatDatetime(0n)).toBe('1970-01-01T00:00:00.000Z')
  })

  it('truncates transaction hashes', () => {
    const hash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    expect(formatTxHash(hash)).toBe('0x123456...abcdef')
    expect(formatTxHash('0x1234')).toBe('0x1234')
  })
})

describe('token list helpers', () => {
  it('formats pool display ids', () => {
    expect(getPoolDisplayId('WETH', 'USDC', 500n)).toBe('WETH/USDC 0.05%')
    expect(getPoolDisplayId('WBTC', 'ETH', 3000n)).toBe('WBTC/ETH 0.30%')
    expect(getPoolDisplayId('ETH', 'USDC', 10000n)).toBe('ETH/USDC 1.0%')
  })

  it('formats fee tiers', () => {
    expect(formatFeeTier(500n)).toBe('0.05%')
    expect(formatFeeTier(3000n)).toBe('0.30%')
    expect(formatFeeTier(10000n)).toBe('1.0%')
  })

  it('round-trips token list ids', () => {
    const id = getTokenListId(1n, '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2')
    expect(id).toBe('1:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2')
    const parsed = parseTokenListId(id)
    expect(parsed.chainId).toBe(1n)
    expect(parsed.address).toBe('0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2')
  })

  it('rejects invalid token list ids', () => {
    expect(() => parseTokenListId('')).toThrow(Error)
    expect(() => parseTokenListId('1')).toThrow(Error)
    expect(() => parseTokenListId('1:')).toThrow(Error)
  })
})

describe('percentage and wad formatters', () => {
  it('formats basis points and utilization', () => {
    expect(formatBps(50n, 2n)).toBe('0.50%')
    expect(formatBps(-50n, 1n)).toBe('-0.5%')
    expect(formatUtilization(7500n, 0n)).toBe('75%')
  })

  it('parses basis points', () => {
    expect(parseBps('1.5%')).toBe(150n)
    expect(parseBps('1.5')).toBe(150n)
    expect(parseBps('-0.5')).toBe(-50n)
    expect(parseBps('1.234%')).toBe(123n)
  })

  it('formats ratios as percentages', () => {
    expect(formatRatioPercent(1n, 4n, 1n)).toBe('25.0%')
    expect(formatRatioPercent(1n, 0n, 2n)).toBe('0%')
  })

  it('formats and parses WAD values', () => {
    expect(formatWad(500000000000000000n, 2n)).toBe('0.50')
    expect(formatWadSigned(0n, 2n)).toBe('0.00')
    expect(parseWad('-1.22')).toBe(-1220000000000000000n)
  })

  it('formats WAD-based rates', () => {
    expect(formatWadPercent(50_000_000_000_000_000n, 2n)).toBe('5.00%')
    expect(formatRateWad(1_000_000_000_000_000_000n, 1n)).toBe('100.0%')
  })
})

describe('amount helpers', () => {
  it('formats token amounts with truncation', () => {
    expect(formatTokenAmount(1500500n, 6n, 2n)).toBe('1.50')
    expect(formatTokenAmount(1500000n, 6n, 0n)).toBe('1')
    expect(formatTokenAmountSigned(-500000n, 6n, 2n)).toBe('-0.50')
  })

  it('parses token amounts', () => {
    expect(parseTokenAmount('1.5', 6n)).toBe(1500000n)
    expect(parseTokenAmount('-0.5', 18n)).toBe(-500000000000000000n)
    expect(parseTokenAmount('1.23456789', 6n)).toBe(1234567n)
  })

  it('round-trips token amounts at full precision', () => {
    const amounts = [0n, 1n, 123456n, 999999999n]
    for (const amount of amounts) {
      const formatted = formatTokenAmount(amount, 6n, 6n)
      expect(parseTokenAmount(formatted, 6n)).toBe(amount)
    }
  })

  it('formats token deltas with signs', () => {
    expect(formatTokenDelta(1_500_000n, 6n, 2n)).toBe('+1.50')
    expect(formatTokenDelta(-500_000n, 6n, 2n)).toBe('-0.50')
    expect(formatTokenDelta(0n, 6n, 2n)).toBe('0.00')
  })

  it('formats token flow data', () => {
    const flow = {
      delta0: -1_500_000n,
      delta1: 2_000_000_000_000_000_000n,
      balanceBefore0: 5_000_000n,
      balanceBefore1: 1_000_000_000_000_000_000n,
      balanceAfter0: 3_500_000n,
      balanceAfter1: 3_000_000_000_000_000_000n,
    }

    const formatted = formatTokenFlow(flow, 6n, 18n, 2n, 2n)
    expect(formatted.delta0).toBe('-1.50')
    expect(formatted.delta1).toBe('+2.00')
    expect(formatted.balanceBefore0).toBe('5.00')
    expect(formatted.balanceAfter1).toBe('3.00')
  })
})
