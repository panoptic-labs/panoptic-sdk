/**
 * Tests for the width-scaled strike ladder.
 * @module v2/strike/ladder.test
 */

import { describe, expect, it } from 'vitest'

import { PanopticValidationError } from '../errors'
import { priceToTick, tickToPriceDecimalScaled } from '../formatters/tick'
import { MAX_TICK, MIN_TICK } from '../utils/constants'
import {
  type StrikeOrientation,
  classifyStrike,
  ladderStrikeSequence,
  resolveLadderStrike,
  STRIKE_LADDER_TARGET_STRIKES,
} from './ladder'

// Pool with token0 = 18-decimal asset (ETH), token1 = 6-decimal quote (USDC).
const ETH_USDC: StrikeOrientation = { asset: 0n, assetDecimals: 18n, quoteDecimals: 6n }
// Same pool quoted the other way: USDC priced in ETH.
const USDC_ETH: StrikeOrientation = { asset: 1n, assetDecimals: 6n, quoteDecimals: 18n }
// Same-decimals pool with asset = token1.
const SAME_DEC_ASSET1: StrikeOrientation = { asset: 1n, assetDecimals: 18n, quoteDecimals: 18n }
const SAME_DEC_ASSET0: StrikeOrientation = { asset: 0n, assetDecimals: 18n, quoteDecimals: 18n }

const must = <T>(v: T | null | undefined): T => {
  if (v === null || v === undefined) throw new Error('expected a value')
  return v
}

const tickFor = (price: string, o: StrikeOrientation): bigint => {
  const t = priceToTick(price, o.assetDecimals, o.quoteDecimals)
  return o.asset === 0n ? t : -t
}
const priceAt = (tick: bigint, o: StrikeOrientation): number =>
  Number(
    tickToPriceDecimalScaled(o.asset === 0n ? tick : -tick, o.assetDecimals, o.quoteDecimals, 18n),
  )

const isValidStrike = (strike: bigint, width: bigint, ts: bigint) => {
  const down = (width * ts) / 2n
  const up = width * ts - down
  const lower = strike - down
  const upper = strike + up
  return (
    ((lower % ts) + ts) % ts === 0n &&
    ((upper % ts) + ts) % ts === 0n &&
    lower >= MIN_TICK &&
    upper <= MAX_TICK
  )
}

/** Mantissa of a decimal string must be 1, 2.5 or 5 (× 10ⁿ). */
const isNice = (decimal: string): boolean => {
  const digits = decimal.replace('.', '').replace(/^0+/, '').replace(/0+$/, '')
  return digits === '1' || digits === '25' || digits === '5'
}

/** Consecutive-rung difference for the rung nearest `price`. */
const incrementAround = (price: string, width: bigint, ts: bigint, o: StrikeOrientation) => {
  const geom = { width, tickSpacing: ts, orient: o }
  const a = must(resolveLadderStrike({ tick: tickFor(price, o), ...geom }))
  const b = must(resolveLadderStrike({ tick: a.tick, step: 1n, ...geom }))
  return Number(b.nominalPrice) - Number(a.nominalPrice)
}

// Standard widths on a 10-tick pool: 1H, 1D, 1W, 1M, 1Y.
const WIDTHS_TS10 = { '1H': 24n, '1D': 72n, '1W': 240n, '1M': 480n, '1Y': 1500n }

describe('width-scaled increments', () => {
  it.each([
    ['1H', WIDTHS_TS10['1H'], 2.5],
    ['1D', WIDTHS_TS10['1D'], 10],
    ['1W', WIDTHS_TS10['1W'], 25],
    ['1M', WIDTHS_TS10['1M'], 50],
    ['1Y', WIDTHS_TS10['1Y'], 250],
  ])('uses $%s steps at $1,880 for %s', (_label, width, expected) => {
    expect(incrementAround('1880', width, 10n, ETH_USDC)).toBeCloseTo(expected, 9)
  })

  it('yields roughly TARGET_STRIKES rungs across the leg range for many geometries', () => {
    const cases: [bigint, bigint][] = [
      [10n, 24n],
      [10n, 72n],
      [10n, 240n],
      [10n, 480n],
      [10n, 1500n],
      [60n, 4n],
      [60n, 250n],
      [200n, 75n],
      [200n, 24n],
    ]
    for (const [ts, width] of cases) {
      for (const price of ['13.7', '1880', '3200', '99999']) {
        const geom = { width, tickSpacing: ts, orient: ETH_USDC }
        const center = tickFor(price, ETH_USDC)
        const seq = must(ladderStrikeSequence({ centerTick: center, count: 101, ...geom }))
        const half = (width * ts) / 2n
        const inRange = seq.filter((s) => s.tick > center - half && s.tick < center + half)
        // Coarse tick grids (2% per tick) cap how many distinct ticks fit in the range.
        const maxDistinct = Number(width) + 1
        const target = Math.min(Number(STRIKE_LADDER_TARGET_STRIKES), maxDistinct)
        expect(inRange.length).toBeGreaterThanOrEqual(Math.floor(target * 0.6))
        expect(inRange.length).toBeLessThanOrEqual(Math.ceil(target * 1.6) + 1)
      }
    }
  })

  it('produces nice increments in every range', () => {
    for (const price of ['1.3', '13.7', '137', '1880', '24000', '900000']) {
      const inc = incrementAround(price, 480n, 10n, ETH_USDC)
      expect(isNice(inc.toPrecision(6).replace(/\.?0+$/, ''))).toBe(true)
    }
  })

  it('works for ultra-stable pools near price 1', () => {
    const geom = { width: 20n, tickSpacing: 1n, orient: SAME_DEC_ASSET0 }
    const center = tickFor('1.0002', SAME_DEC_ASSET0)
    const seq = must(ladderStrikeSequence({ centerTick: center, count: 21, ...geom }))
    expect(seq.length).toBeGreaterThan(5)
    for (const s of seq) {
      expect(isValidStrike(s.tick, 20n, 1n)).toBe(true)
      expect(Number(s.nominalPrice)).toBeGreaterThan(0.99)
      expect(Number(s.nominalPrice)).toBeLessThan(1.01)
    }
    expect(incrementAround('1.0002', 20n, 1n, SAME_DEC_ASSET0)).toBeCloseTo(0.0001, 12)
  })
})

describe('invalid geometry', () => {
  const tick = tickFor('1880', ETH_USDC)
  it.each([
    ['zero width', 0n, 10n],
    ['negative width', -1n, 10n],
    ['zero tickSpacing', 480n, 0n],
    ['negative tickSpacing', 480n, -10n],
    ['span wider than the tick domain', 4095n, 16384n],
  ])('throws PanopticValidationError for %s', (_label, width, tickSpacing) => {
    const geom = { width, tickSpacing, orient: ETH_USDC }
    expect(() => classifyStrike({ tick, ...geom })).toThrow(PanopticValidationError)
    expect(() => resolveLadderStrike({ tick, ...geom })).toThrow(PanopticValidationError)
    expect(() => ladderStrikeSequence({ centerTick: tick, count: 5, ...geom })).toThrow(
      PanopticValidationError,
    )
  })

  it('returns an empty sequence for count 0', () => {
    expect(
      ladderStrikeSequence({
        centerTick: tick,
        count: 0,
        width: 480n,
        tickSpacing: 10n,
        orient: ETH_USDC,
      }),
    ).toEqual([])
  })
})

describe('resolveLadderStrike (step 0)', () => {
  const geom = { width: WIDTHS_TS10['1W'], tickSpacing: 10n, orient: ETH_USDC }

  it.each([
    ['1597', '1600'],
    ['1607', '1600'],
    ['1613', '1625'],
    ['2488', '2500'],
    ['3212', '3200'],
  ])('resolves %s to the nominal rung %s (1W, $25 steps)', (input, expected) => {
    const res = resolveLadderStrike({ tick: tickFor(input, ETH_USDC), ...geom })
    expect(res?.nominalPrice).toBe(expected)
  })

  it('returns null above the ladder', () => {
    expect(resolveLadderStrike({ tick: tickFor('1300000', ETH_USDC), ...geom })).toBeNull()
    expect(
      resolveLadderStrike({ tick: tickFor('1300000', ETH_USDC), ...geom, orient: USDC_ETH }),
    ).toBeNull()
  })

  it('is idempotent: the resolved tick classifies as ladder with the same label', () => {
    for (const width of Object.values(WIDTHS_TS10)) {
      for (const p of ['1597', '2488', '804', '0.0004', '12.3']) {
        const g = { ...geom, width }
        const res = must(resolveLadderStrike({ tick: tickFor(p, ETH_USDC), ...g }))
        expect(classifyStrike({ tick: res.tick, ...g })).toEqual({
          kind: 'ladder',
          nominalPrice: res.nominalPrice,
        })
        expect(resolveLadderStrike({ tick: res.tick, ...g })).toEqual(res)
      }
    }
  })

  it('lands within one tick spacing of the nominal price', () => {
    // 1W at ~$2,500: raw = 2517·0.271/16 ≈ 43 → $50 steps.
    const res = must(resolveLadderStrike({ tick: tickFor('2517', ETH_USDC), ...geom }))
    expect(res.nominalPrice).toBe('2500')
    expect(Math.abs(priceAt(res.tick, ETH_USDC) / 2500 - 1)).toBeLessThan(0.001)
  })
})

describe('reciprocal orientation', () => {
  const geom = { width: WIDTHS_TS10['1W'], tickSpacing: 10n }

  it('ETH-USDC 2500 and USDC-ETH 0.0004 resolve to the same tick', () => {
    const a = must(
      resolveLadderStrike({ tick: tickFor('2500', ETH_USDC), ...geom, orient: ETH_USDC }),
    )
    const b = must(
      resolveLadderStrike({ tick: tickFor('0.0004', USDC_ETH), ...geom, orient: USDC_ETH }),
    )
    expect(a.nominalPrice).toBe('2500')
    expect(b.nominalPrice).toBe('0.0004')
    expect(a.tick).toBe(b.tick)
    expect(classifyStrike({ tick: a.tick, ...geom, orient: USDC_ETH })).toEqual({
      kind: 'ladder',
      nominalPrice: '0.0004',
    })
  })

  it('same-decimals pool 528.31 ↔ 0.001892 resolve to reciprocal rungs on the same tick', () => {
    const g = { width: 80n, tickSpacing: 60n }
    const t = tickFor('528.311189557', SAME_DEC_ASSET0)
    const a = must(resolveLadderStrike({ tick: t, ...g, orient: SAME_DEC_ASSET0 }))
    const b = must(resolveLadderStrike({ tick: t, ...g, orient: SAME_DEC_ASSET1 }))
    expect(Number(b.nominalPrice)).toBeCloseTo(1 / Number(a.nominalPrice), 12)
    expect(a.tick).toBe(b.tick)
  })

  it('steps in the caller price direction under inversion', () => {
    const g = { ...geom, orient: USDC_ETH }
    const start = must(resolveLadderStrike({ tick: tickFor('0.0004', USDC_ETH), ...g }))
    const up = must(resolveLadderStrike({ tick: start.tick, step: 1n, ...g }))
    const down = must(resolveLadderStrike({ tick: start.tick, step: -1n, ...g }))
    // higher USDC price in ETH = lower ETH price in USDC → rung 2450 ($50 steps for 1W at $2,500)
    expect(Number(up.nominalPrice)).toBeCloseTo(1 / 2450, 12)
    expect(Number(down.nominalPrice)).toBeCloseTo(1 / 2550, 12)
    expect(priceAt(up.tick, USDC_ETH)).toBeGreaterThan(priceAt(start.tick, USDC_ETH))
    expect(priceAt(down.tick, USDC_ETH)).toBeLessThan(priceAt(start.tick, USDC_ETH))
  })
})

describe('stepping', () => {
  const geom = { width: WIDTHS_TS10['1W'], tickSpacing: 10n, orient: ETH_USDC }

  it('moves exactly one rung and crosses increment boundaries', () => {
    // 1W at ~$1,600: raw = 1600·0.271/16 ≈ 27 → $25; below ~$1,300 the increment is $10.
    const at1600 = must(resolveLadderStrike({ tick: tickFor('1600', ETH_USDC), ...geom }))
    expect(resolveLadderStrike({ tick: at1600.tick, step: 1n, ...geom })?.nominalPrice).toBe('1625')
    expect(resolveLadderStrike({ tick: at1600.tick, step: -1n, ...geom })?.nominalPrice).toBe(
      '1575',
    )
    let cur = must(resolveLadderStrike({ tick: tickFor('1300', ETH_USDC), ...geom }))
    for (let i = 0; i < 40; i++) {
      const prev = cur
      cur = must(resolveLadderStrike({ tick: cur.tick, step: -1n, ...geom }))
      expect(Number(cur.nominalPrice)).toBeLessThan(Number(prev.nominalPrice))
      expect(classifyStrike({ tick: cur.tick, ...geom }).kind).toBe('ladder')
    }
    expect(Number(cur.nominalPrice)).toBeLessThan(1000)
  })

  it('steps from an off-ladder tick to the nearest rung strictly beyond it', () => {
    const t = tickFor('1603', ETH_USDC)
    expect(resolveLadderStrike({ tick: t, step: 1n, ...geom })?.nominalPrice).toBe('1625')
    expect(resolveLadderStrike({ tick: t, step: -1n, ...geom })?.nominalPrice).toBe('1600')
  })

  it('skips rungs that collapse onto the same tick on a coarse grid', () => {
    // 2% per tick (tickSpacing 200), 1H-like width 2 → $2.5 rungs collide heavily.
    const coarse = { width: 2n, tickSpacing: 200n, orient: ETH_USDC }
    let cur = must(resolveLadderStrike({ tick: tickFor('1600', ETH_USDC), ...coarse }))
    for (let i = 0; i < 10; i++) {
      const next = must(resolveLadderStrike({ tick: cur.tick, step: 1n, ...coarse }))
      expect(next.tick).toBeGreaterThan(cur.tick)
      expect(classifyStrike({ tick: next.tick, ...coarse }).kind).toBe('ladder')
      cur = next
    }
  })

  it('returns null when stepping past the top of the ladder', () => {
    const top = must(resolveLadderStrike({ tick: tickFor('1000000', ETH_USDC), ...geom }))
    expect(top.nominalPrice).toBe('1000000')
    expect(resolveLadderStrike({ tick: top.tick, step: 1n, ...geom })).toBeNull()
  })
})

describe('tick validity (strike ≡ rangeDown mod tickSpacing)', () => {
  const cases: [bigint, bigint][] = [
    [1n, 3n],
    [1n, 20n],
    [10n, 480n],
    [10n, 75n],
    [60n, 250n],
    [60n, 3n],
    [200n, 75n],
    [200n, 24n],
  ]
  it.each(cases)(
    'tickSpacing %s width %s produces valid ticks in both orientations',
    (ts, width) => {
      for (const price of ['0.5', '1', '13.7', '1597', '2500', '99999']) {
        for (const orient of [ETH_USDC, USDC_ETH, SAME_DEC_ASSET1]) {
          const res = resolveLadderStrike({
            tick: tickFor(price, orient),
            width,
            tickSpacing: ts,
            orient,
          })
          if (res === null) continue
          expect(isValidStrike(res.tick, width, ts)).toBe(true)
        }
      }
    },
  )

  it('handles negative ticks with odd widths', () => {
    const res = must(
      resolveLadderStrike({
        tick: -50_000n,
        width: 75n,
        tickSpacing: 200n,
        orient: SAME_DEC_ASSET1,
      }),
    )
    expect(isValidStrike(res.tick, 75n, 200n)).toBe(true)
    expect(res.tick).toBeLessThan(0n)
  })
})

describe('classifyStrike', () => {
  const geom = { width: WIDTHS_TS10['1W'], tickSpacing: 10n, orient: ETH_USDC }
  it('flags a real off-ladder chunk as off-ladder', () => {
    const raw = tickFor('2537', ETH_USDC)
    const chunk = raw - (((raw % 10n) + 10n) % 10n)
    expect(classifyStrike({ tick: chunk, ...geom }).kind).toBe('off-ladder')
  })
  it('flags prices above 1e6 as outside-ladder', () => {
    expect(classifyStrike({ tick: tickFor('2000000', ETH_USDC), ...geom }).kind).toBe(
      'outside-ladder',
    )
  })
  it('depends on width: a 1W rung is not necessarily a 1H rung', () => {
    const rung1W = must(resolveLadderStrike({ tick: tickFor('1613', ETH_USDC), ...geom }))
    expect(rung1W.nominalPrice).toBe('1625')
    // $1,625 is also a $2.5 rung and both widths are even, so the same tick is canonical for 1H.
    const as1H = classifyStrike({ tick: rung1W.tick, ...geom, width: WIDTHS_TS10['1H'] })
    expect(as1H).toEqual({ kind: 'ladder', nominalPrice: '1625' })
  })
})

describe('ladderStrikeSequence', () => {
  it('yields $250 rungs around $3,200 for 1Y', () => {
    const geom = { width: WIDTHS_TS10['1Y'], tickSpacing: 10n, orient: ETH_USDC }
    const seq = must(
      ladderStrikeSequence({ centerTick: tickFor('3200', ETH_USDC), count: 51, ...geom }),
    )
    const labels = seq.map((s) => s.nominalPrice)
    for (const l of ['2750', '3000', '3250', '3500']) expect(labels).toContain(l)
    for (let i = 1; i < seq.length; i++)
      expect(must(seq[i]).tick).toBeGreaterThan(must(seq[i - 1]).tick)
    for (const s of seq) expect(classifyStrike({ tick: s.tick, ...geom }).kind).toBe('ladder')
  })

  it('yields $2.5 rungs around $1,880 for 1H', () => {
    const geom = { width: WIDTHS_TS10['1H'], tickSpacing: 10n, orient: ETH_USDC }
    const seq = must(
      ladderStrikeSequence({ centerTick: tickFor('1880', ETH_USDC), count: 51, ...geom }),
    )
    const labels = seq.map((s) => s.nominalPrice)
    for (const l of ['1877.5', '1880', '1882.5']) expect(labels).toContain(l)
    expect(seq.length).toBe(51)
  })

  it('dedupes colliding rungs and stays sorted on a coarse grid', () => {
    const coarse = { width: 12n, tickSpacing: 200n, orient: ETH_USDC }
    const seq = must(
      ladderStrikeSequence({ centerTick: tickFor('1600', ETH_USDC), count: 51, ...coarse }),
    )
    const ticks = seq.map((s) => s.tick)
    expect(new Set(ticks).size).toBe(ticks.length)
    for (let i = 1; i < ticks.length; i++)
      expect(must(ticks[i])).toBeGreaterThan(must(ticks[i - 1]))
  })

  it('omits rungs past the ladder top and returns null when centred outside', () => {
    const geom = { width: WIDTHS_TS10['1Y'], tickSpacing: 10n, orient: ETH_USDC }
    const seq = must(
      ladderStrikeSequence({ centerTick: tickFor('900000', ETH_USDC), count: 51, ...geom }),
    )
    expect(seq.length).toBeLessThan(51)
    expect(seq.every((s) => Number(s.nominalPrice) <= 1_000_000)).toBe(true)
    expect(
      ladderStrikeSequence({ centerTick: tickFor('1500000', ETH_USDC), count: 51, ...geom }),
    ).toBeNull()
  })

  it('is ascending in caller price for the reciprocal orientation', () => {
    const seq = must(
      ladderStrikeSequence({
        centerTick: tickFor('0.0004', USDC_ETH),
        count: 11,
        width: WIDTHS_TS10['1W'],
        tickSpacing: 10n,
        orient: USDC_ETH,
      }),
    )
    const prices = seq.map((s) => Number(s.nominalPrice))
    for (let i = 1; i < prices.length; i++)
      expect(must(prices[i])).toBeGreaterThan(must(prices[i - 1]))
  })
})
