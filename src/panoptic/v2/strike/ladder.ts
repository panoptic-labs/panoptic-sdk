/**
 * Human price ladder for option strike construction, scaled by leg width.
 *
 * Strikes for new positions live on a "nice number" ladder whose rung spacing
 * follows the leg's range: the increment is the nice value (1 / 2.5 / 5 × 10ⁿ)
 * closest to `price · (1.0001^(width·tickSpacing / TARGET_STRIKES) − 1)`, so every
 * expiry exposes roughly the same number of strikes across its range (≈16). At
 * $1,880 on a 10-tick pool that gives $2.5 rungs for 1H, $10 for 1D, $25 for 1W,
 * $50 for 1M and $250 for 1Y.
 *
 * Prices are normalised to `max(price, 1 / price)` before laddering, so both quote
 * orientations of a pool resolve to reciprocal rungs (2,500 USDC/ETH ↔ 0.0004
 * ETH/USDC). Normalised prices above 1,000,000 are outside the ladder.
 *
 * Nominal prices generally cannot be encoded exactly as Uniswap ticks, so an
 * "on-ladder" strike is the deterministic nearest *valid* Panoptic strike tick for
 * the requested width and pool tick spacing. Validity follows the on-chain rule
 * (`PanopticMath.getRangesFromStrike`): `rangeDown = floor(width·ts/2)`,
 * `rangeUp = ceil(width·ts/2)`, and both `strike - rangeDown` and
 * `strike + rangeUp` must be multiples of `ts`, i.e. `strike ≡ rangeDown (mod ts)`.
 *
 * All arithmetic is bigint / exact rational. Prices are decimal strings.
 *
 * @module v2/strike/ladder
 */

import { PanopticValidationError } from '../errors'
import { priceToTick, tickToPriceDecimalScaled } from '../formatters/tick'
import { MAX_TICK, MIN_TICK } from '../utils/constants'

// ============================================================================
// Configuration
// ============================================================================

/** Target number of rungs across a leg's full range (lower tick → upper tick). */
export const STRIKE_LADDER_TARGET_STRIKES = 16n

/** Nice increment mantissas, in tenths (1, 2.5, 5) × 10ⁿ. */
const NICE_MANTISSAS_TENTHS = [10n, 25n, 50n] as const

/** Upper bound on rung hops when searching for a tick-changing step. */
const MAX_STEP_ITERATIONS = 512

/** Decimal precision used when rendering exact tick prices as strings. */
const PRICE_PRECISION = 30n

// ============================================================================
// Types
// ============================================================================

/**
 * Quote orientation for a pool. `asset` is the token whose price we quote
 * (0 → token0 priced in token1, 1 → token1 priced in token0).
 */
export interface StrikeOrientation {
  asset: 0n | 1n
  assetDecimals: bigint
  quoteDecimals: bigint
}

/** A strike on the ladder: the valid on-chain tick plus the nominal price it represents. */
export interface LadderStrike {
  /** Valid Panoptic strike tick (absolute, not oriented). */
  tick: bigint
  /** Nominal ladder price in the caller's quote orientation, as a decimal string. */
  nominalPrice: string
}

export type StrikeClassification =
  | { kind: 'ladder'; nominalPrice: string }
  | { kind: 'off-ladder' }
  | { kind: 'outside-ladder' }

interface StrikeGeometry {
  width: bigint
  tickSpacing: bigint
  orient: StrikeOrientation
}

/** Exact positive rational. */
interface Fraction {
  numerator: bigint
  denominator: bigint
}

/** A rung: exact normalised price plus whether the caller's price is its reciprocal. */
interface Rung {
  price: Fraction
  reciprocal: boolean
}

// ============================================================================
// Bigint / fraction helpers
// ============================================================================

function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q
}

function floorMod(a: bigint, b: bigint): bigint {
  return a - floorDiv(a, b) * b
}

function ceilDiv(a: bigint, b: bigint): bigint {
  return -floorDiv(-a, b)
}

/** round(a / b) to nearest, ties up. */
function roundDiv(a: bigint, b: bigint): bigint {
  return floorDiv(2n * a + b, 2n * b)
}

function pow10(exp: bigint): bigint {
  let result = 1n
  for (let i = 0n; i < exp; i++) result *= 10n
  return result
}

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a
  b = b < 0n ? -b : b
  while (b !== 0n) [a, b] = [b, a % b]
  return a
}

function reduce(f: Fraction): Fraction {
  const g = gcd(f.numerator, f.denominator)
  return g <= 1n ? f : { numerator: f.numerator / g, denominator: f.denominator / g }
}

function fromBigint(n: bigint): Fraction {
  return { numerator: n, denominator: 1n }
}

function mul(a: Fraction, b: Fraction): Fraction {
  return reduce({
    numerator: a.numerator * b.numerator,
    denominator: a.denominator * b.denominator,
  })
}

function add(a: Fraction, b: Fraction): Fraction {
  return reduce({
    numerator: a.numerator * b.denominator + b.numerator * a.denominator,
    denominator: a.denominator * b.denominator,
  })
}

function sub(a: Fraction, b: Fraction): Fraction {
  return add(a, { numerator: -b.numerator, denominator: b.denominator })
}

/** -1 | 0 | 1 comparing a to b. */
function cmp(a: Fraction, b: Fraction): -1 | 0 | 1 {
  const l = a.numerator * b.denominator
  const r = b.numerator * a.denominator
  return l === r ? 0 : l < r ? -1 : 1
}

const LADDER_MIN: Fraction = fromBigint(1n)
/** Largest normalised price on the ladder. Prices above are "outside". */
const LADDER_MAX: Fraction = fromBigint(1_000_000n)

function parseDecimal(value: string): Fraction {
  const trimmed = value.trim()
  const [basePart, exponentPart] = trimmed.toLowerCase().split('e')
  const [integerStr, fractionalStr = ''] = basePart.split('.')
  let numerator = BigInt(`${integerStr === '' ? '0' : integerStr}${fractionalStr}`)
  let denominator = pow10(BigInt(fractionalStr.length))
  if (exponentPart !== undefined && exponentPart !== '') {
    const exponent = BigInt(exponentPart)
    if (exponent > 0n) numerator *= pow10(exponent)
    else if (exponent < 0n) denominator *= pow10(-exponent)
  }
  if (numerator <= 0n) throw new Error('Price must be positive')
  return reduce({ numerator, denominator })
}

/** Render a positive fraction as a decimal string with trailing zeros trimmed. */
function fractionToDecimal(f: Fraction, precision: bigint): string {
  const scaled = (f.numerator * pow10(precision)) / f.denominator
  const digits = scaled.toString().padStart(Number(precision) + 1, '0')
  const intPart = digits.slice(0, digits.length - Number(precision))
  const fracPart = digits.slice(digits.length - Number(precision)).replace(/0+$/, '')
  return fracPart.length === 0 ? intPart : `${intPart}.${fracPart}`
}

/** 10^k as an exact fraction, k may be negative. */
function powerOfTen(k: bigint): Fraction {
  return k >= 0n ? fromBigint(pow10(k)) : { numerator: 1n, denominator: pow10(-k) }
}

/** floor(log10(f)) for a positive fraction. */
function floorLog10(f: Fraction): bigint {
  let e = BigInt(f.numerator.toString().length - f.denominator.toString().length)
  while (cmp(f, powerOfTen(e)) < 0) e -= 1n
  while (cmp(f, powerOfTen(e + 1n)) >= 0) e += 1n
  return e
}

// ============================================================================
// Orientation: tick <-> caller price
// ============================================================================

function orientTick(tick: bigint, orient: StrikeOrientation): bigint {
  return orient.asset === 0n ? tick : -tick
}

/** Exact-enough price of `tick` in the caller's orientation. */
function tickToOrientedPrice(tick: bigint, orient: StrikeOrientation): Fraction {
  const price = tickToPriceDecimalScaled(
    orientTick(tick, orient),
    orient.assetDecimals,
    orient.quoteDecimals,
    PRICE_PRECISION,
  )
  return parseDecimal(price)
}

/** Nearest integer tick for a caller-oriented decimal price. */
function orientedPriceToTick(price: string, orient: StrikeOrientation): bigint {
  const t = priceToTick(price, orient.assetDecimals, orient.quoteDecimals)
  return orientTick(t, orient)
}

// ============================================================================
// Width-scaled increments
// ============================================================================

/**
 * Relative rung step for a leg: `1.0001^(round(width·tickSpacing / TARGET)) − 1`.
 * Rungs scale with price (they are multiples of a price-proportional increment), so
 * spacing them by the range's TARGET-th root yields ≈TARGET rungs across the range
 * regardless of how wide it is.
 */
function relativeStep(width: bigint, tickSpacing: bigint): Fraction {
  validateGeometry(width, tickSpacing)
  const ticks = roundDiv(width * tickSpacing, STRIKE_LADDER_TARGET_STRIKES)
  const ratio = parseDecimal(
    tickToPriceDecimalScaled(ticks < 1n ? 1n : ticks, 0n, 0n, PRICE_PRECISION),
  )
  return sub(ratio, fromBigint(1n))
}

/** Nice increment `m × 10ⁿ` (m ∈ {1, 2.5, 5}) with the smallest log-distance to `raw`. */
function niceIncrement(raw: Fraction): Fraction {
  const e = floorLog10(raw)
  // Candidates spanning [10^e, 10^(e+1)]: 1, 2.5, 5 and 10 (× 10^e).
  const scale = (tenths: bigint): Fraction => mul(fromBigint(tenths), powerOfTen(e - 1n))
  const candidates = [...NICE_MANTISSAS_TENTHS.map(scale), scale(100n)]
  let lo = candidates[0] ?? powerOfTen(e)
  for (const hi of candidates.slice(1)) {
    if (cmp(raw, hi) < 0) {
      // Geometric midpoint test: lo wins iff raw² ≤ lo·hi.
      return cmp(mul(raw, raw), mul(lo, hi)) <= 0 ? lo : hi
    }
    lo = hi
  }
  // floorLog10 guarantees raw < 10^(e+1), so the loop always returns.
  return lo
}

/** Rung increment at normalised price `p` for the given relative step. */
function incrementAt(p: Fraction, rf: Fraction): Fraction {
  return niceIncrement(mul(p, rf))
}

// ============================================================================
// Normalised ladder
// ============================================================================

/** Normalise a price to `max(p, 1/p)` and remember whether it was inverted. */
function normalise(price: Fraction): { value: Fraction; reciprocal: boolean } {
  if (price.numerator >= price.denominator) return { value: price, reciprocal: false }
  return {
    value: { numerator: price.denominator, denominator: price.numerator },
    reciprocal: true,
  }
}

/** Is `r` a multiple of `inc`? */
function isMultiple(r: Fraction, inc: Fraction): boolean {
  return (r.numerator * inc.denominator) % (r.denominator * inc.numerator) === 0n
}

/** Smallest multiple of `inc` strictly greater than `x`. */
function ceilMultipleStrict(x: Fraction, inc: Fraction): Fraction {
  const k = floorDiv(x.numerator * inc.denominator, x.denominator * inc.numerator) + 1n
  return mul(fromBigint(k), inc)
}

/** Largest multiple of `inc` strictly smaller than `x`. */
function floorMultipleStrict(x: Fraction, inc: Fraction): Fraction {
  const k = ceilDiv(x.numerator * inc.denominator, x.denominator * inc.numerator) - 1n
  return mul(fromBigint(k), inc)
}

/**
 * The rung set is `{ r : r is a multiple of incrementAt(r) }`. Because the
 * increment grows with price, a multiple of a finer increment can land inside a
 * coarser band where it is no longer a rung; these helpers push such a candidate
 * up/down until it is a multiple of its own band's increment.
 */
function isRung(r: Fraction, rf: Fraction): boolean {
  return r.numerator > 0n && isMultiple(r, incrementAt(r, rf))
}

function fixUp(c: Fraction, rf: Fraction): Fraction {
  for (let i = 0; i < 64 && !isRung(c, rf); i++) c = ceilMultipleStrict(c, incrementAt(c, rf))
  return c
}

function fixDown(c: Fraction, rf: Fraction): Fraction {
  for (let i = 0; i < 64 && c.numerator > 0n && !isRung(c, rf); i++)
    c = floorMultipleStrict(c, incrementAt(c, rf))
  return c
}

/** Smallest rung strictly above `x` (may exceed the ladder top). */
function nextRungAbove(x: Fraction, rf: Fraction): Fraction {
  const incHere = incrementAt(x, rf)
  // The band may coarsen between x and x + incHere; try both increments and keep the lowest rung.
  const incs = [incHere, incrementAt(add(x, incHere), rf)]
  let best: Fraction | null = null
  for (const inc of incs) {
    const c = fixUp(ceilMultipleStrict(x, inc), rf)
    if (cmp(c, x) > 0 && (best === null || cmp(c, best) < 0)) best = c
  }
  // ceilMultipleStrict always yields c > x and fixUp only moves up, so best is set.
  if (best === null) throw new PanopticValidationError('No ladder rung above price')
  return best
}

/** Largest rung strictly below `x` (may fall below the ladder floor). */
function prevRungBelow(x: Fraction, rf: Fraction): Fraction {
  const incHere = incrementAt(x, rf)
  // The band may be finer just below x; try both increments and keep the highest rung.
  const finer = incrementAt(sub(x, incHere), rf)
  let best: Fraction | null = null
  for (const inc of [incHere, finer]) {
    const c = fixDown(floorMultipleStrict(x, inc), rf)
    if (c.numerator > 0n && cmp(c, x) < 0 && (best === null || cmp(c, best) > 0)) best = c
  }
  return best ?? fromBigint(0n)
}

/** Nearest rung price to a normalised price, or null when above the ladder. */
function nearestRungPrice(normalised: Fraction, rf: Fraction): Fraction | null {
  let rung: Fraction
  if (isRung(normalised, rf)) {
    rung = normalised
  } else {
    const up = nextRungAbove(normalised, rf)
    const down = prevRungBelow(normalised, rf)
    if (down.numerator <= 0n) rung = up
    else rung = cmp(sub(normalised, down), sub(up, normalised)) <= 0 ? down : up
  }
  if (cmp(rung, LADDER_MIN) < 0) rung = LADDER_MIN
  if (cmp(rung, LADDER_MAX) > 0) return null
  return rung
}

/** Step one rung up (+1) or down (-1) on the normalised ladder. Null when leaving it. */
function stepRungPrice(rung: Fraction, direction: 1n | -1n, rf: Fraction): Fraction | null {
  const next = direction > 0n ? nextRungAbove(rung, rf) : prevRungBelow(rung, rf)
  if (cmp(next, LADDER_MIN) < 0 || cmp(next, LADDER_MAX) > 0) return null
  return next
}

/** Nominal caller-oriented price of a rung as an exact fraction. */
function rungToPrice(rung: Rung): Fraction {
  return rung.reciprocal
    ? { numerator: rung.price.denominator, denominator: rung.price.numerator }
    : rung.price
}

function rungToPriceString(rung: Rung): string {
  return fractionToDecimal(rungToPrice(rung), PRICE_PRECISION)
}

function nearestRung(price: Fraction, rf: Fraction): Rung | null {
  const { value, reciprocal } = normalise(price)
  const p = nearestRungPrice(value, rf)
  return p === null ? null : { price: p, reciprocal }
}

/**
 * Step a rung in the caller's price direction. For reciprocal quotes a higher
 * caller price is a lower normalised price, so the direction flips.
 */
function stepRung(rung: Rung, direction: 1n | -1n, rf: Fraction): Rung | null {
  const normalisedDir: 1n | -1n = rung.reciprocal ? (direction > 0n ? -1n : 1n) : direction
  const p = stepRungPrice(rung.price, normalisedDir, rf)
  return p === null ? null : { price: p, reciprocal: rung.reciprocal }
}

// ============================================================================
// Tick geometry
// ============================================================================

/** Reject geometry the ladder cannot place: non-positive inputs or a span wider than the tick domain. */
function validateGeometry(width: bigint, tickSpacing: bigint): void {
  if (width <= 0n) throw new PanopticValidationError('width must be positive')
  if (tickSpacing <= 0n) throw new PanopticValidationError('tickSpacing must be positive')
  if (width * tickSpacing > MAX_TICK - MIN_TICK)
    throw new PanopticValidationError('width * tickSpacing exceeds the tick domain')
}

/** `rangeDown`/`rangeUp` exactly as `PanopticMath.getRangesFromStrike`. */
function rangesFromStrike(
  width: bigint,
  tickSpacing: bigint,
): { rangeDown: bigint; rangeUp: bigint } {
  const span = width * tickSpacing
  return { rangeDown: span / 2n, rangeUp: ceilDiv(span, 2n) }
}

/**
 * Nearest valid strike tick to `exactTick` for `width`/`tickSpacing`.
 * Valid strikes satisfy `strike ≡ rangeDown (mod tickSpacing)`; the result is
 * shifted in whole tick spacings so the leg's ticks stay within `[MIN_TICK, MAX_TICK]`.
 */
function canonicalStrikeForWidth(exactTick: bigint, width: bigint, tickSpacing: bigint): bigint {
  validateGeometry(width, tickSpacing)
  const { rangeDown, rangeUp } = rangesFromStrike(width, tickSpacing)
  const offset = floorMod(rangeDown, tickSpacing)
  let strike = roundDiv(exactTick - offset, tickSpacing) * tickSpacing + offset
  while (strike - rangeDown < MIN_TICK) strike += tickSpacing
  while (strike + rangeUp > MAX_TICK) strike -= tickSpacing
  return strike
}

function rungToStrike(rung: Rung, geom: StrikeGeometry): LadderStrike {
  const nominalPrice = rungToPriceString(rung)
  const exactTick = orientedPriceToTick(nominalPrice, geom.orient)
  return { tick: canonicalStrikeForWidth(exactTick, geom.width, geom.tickSpacing), nominalPrice }
}

// ============================================================================
// Public API
// ============================================================================

function classifyTick(tick: bigint, geom: StrikeGeometry, rf: Fraction): StrikeClassification {
  const rung = nearestRung(tickToOrientedPrice(tick, geom.orient), rf)
  if (rung === null) return { kind: 'outside-ladder' }
  const canonical = rungToStrike(rung, geom)
  return canonical.tick === tick
    ? { kind: 'ladder', nominalPrice: canonical.nominalPrice }
    : { kind: 'off-ladder' }
}

/**
 * A rung's canonical tick is only usable when that tick classifies back to the
 * same rung (`classifyStrike` → 'ladder'). When rungs are finer than the tick
 * grid two rungs can share a tick and only one of them "owns" it; return the
 * owner's strike, or null when this rung does not own its tick.
 */
function ownedStrike(rung: Rung, geom: StrikeGeometry, rf: Fraction): LadderStrike | null {
  const strike = rungToStrike(rung, geom)
  const cls = classifyTick(strike.tick, geom, rf)
  return cls.kind === 'ladder' ? { tick: strike.tick, nominalPrice: cls.nominalPrice } : null
}

/**
 * Classify a strike tick against the ladder for its width.
 *
 * - `ladder`: the tick is the canonical tick of its nearest rung → show `nominalPrice`.
 * - `off-ladder`: an in-range tick that is not a rung's canonical tick (e.g. real AMM
 *   liquidity at an arbitrary strike) → show the exact price.
 * - `outside-ladder`: the normalised price exceeds 1,000,000 → legacy behaviour.
 */
export function classifyStrike(params: { tick: bigint } & StrikeGeometry): StrikeClassification {
  return classifyTick(params.tick, params, relativeStep(params.width, params.tickSpacing))
}

/**
 * Resolve a tick to a ladder strike.
 *
 * - `step` 0 (default): the ladder tick nearest to `tick` (the tick's own rung when
 *   it owns one, otherwise the closest owned neighbour).
 * - `step` ±1: the nearest ladder tick strictly beyond `tick` in that price direction
 *   (rungs finer than the tick grid can collapse onto one tick, so a single rung hop
 *   may not move the strike).
 *
 * Returns null when the target lies outside the ladder (normalised price > 1e6).
 */
export function resolveLadderStrike(
  params: { tick: bigint; step?: 0n | 1n | -1n } & StrikeGeometry,
): LadderStrike | null {
  const step = params.step ?? 0n
  const rf = relativeStep(params.width, params.tickSpacing)
  const start = nearestRung(tickToOrientedPrice(params.tick, params.orient), rf)
  if (start === null) return null
  const startOriented = orientTick(params.tick, params.orient)

  if (step === 0n) {
    const own = ownedStrike(start, params, rf)
    if (own !== null) return own
    // Walk outwards in both directions and return the closest owned tick.
    let lo: Rung | null = start
    let hi: Rung | null = start
    for (let i = 0; i < MAX_STEP_ITERATIONS; i++) {
      lo = lo === null ? null : stepRung(lo, -1n, rf)
      hi = hi === null ? null : stepRung(hi, 1n, rf)
      const a = lo === null ? null : ownedStrike(lo, params, rf)
      const b = hi === null ? null : ownedStrike(hi, params, rf)
      if (a !== null && b !== null) {
        const da = startOriented - orientTick(a.tick, params.orient)
        const db = orientTick(b.tick, params.orient) - startOriented
        return da <= db ? a : b
      }
      if (a !== null) return a
      if (b !== null) return b
      if (lo === null && hi === null) return null
    }
    return null
  }

  let rung: Rung | null = start
  for (let i = 0; i < MAX_STEP_ITERATIONS && rung !== null; i++) {
    const own = ownedStrike(rung, params, rf)
    if (own !== null) {
      const oriented = orientTick(own.tick, params.orient)
      if (step > 0n ? oriented > startOriented : oriented < startOriented) return own
    }
    rung = stepRung(rung, step, rf)
  }
  return null
}

/**
 * Generate up to `count` ladder strikes centred on `centerTick`, sorted by
 * ascending caller price and deduplicated by tick. Rungs beyond the ladder are
 * omitted (the result may be shorter than `count`). Returns null when the
 * centre itself lies outside the ladder and `[]` when `count` is 0.
 */
export function ladderStrikeSequence(
  params: { centerTick: bigint; count: number } & StrikeGeometry,
): LadderStrike[] | null {
  const rf = relativeStep(params.width, params.tickSpacing)
  if (params.count <= 0) return []
  const center = nearestRung(tickToOrientedPrice(params.centerTick, params.orient), rf)
  if (center === null) return null

  const half = Math.floor(params.count / 2)
  const below: Rung[] = []
  const above: Rung[] = []
  let r: Rung | null = center
  for (let i = 0; i < half && r !== null; i++) {
    r = stepRung(r, -1n, rf)
    if (r !== null) below.push(r)
  }
  r = center
  for (let i = 0; i < params.count - half - 1 && r !== null; i++) {
    r = stepRung(r, 1n, rf)
    if (r !== null) above.push(r)
  }

  const seen = new Set<bigint>()
  const out: LadderStrike[] = []
  for (const rung of [...below.reverse(), center, ...above]) {
    const strike = ownedStrike(rung, params, rf)
    if (strike === null || seen.has(strike.tick)) continue
    seen.add(strike.tick)
    out.push(strike)
  }
  return out
}
