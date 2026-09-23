import { describe, expect, it } from 'vitest'

import { tickToSqrtPriceX96 } from '../formatters/tick'
import { encodeLeg, encodePoolId } from '../tokenId/encoding'
import {
  positionValueKey,
  positionValueTicks,
  preparePositionValueCurve,
} from './positionValueCurve'

describe('position value curve', () => {
  it('includes every boundary for mixed-asset multi-leg positions, including odd widths', () => {
    const poolId = encodePoolId('0x0000000000000000000000000000000000000001', 1n)
    const leg0 = encodeLeg({
      index: 0n,
      asset: 0n,
      optionRatio: 1n,
      isLong: 0n,
      tokenType: 1n,
      riskPartner: 0n,
      strike: -10n,
      width: 3n,
    })
    const leg1 = encodeLeg({
      index: 1n,
      asset: 1n,
      optionRatio: 2n,
      isLong: 1n,
      tokenType: 0n,
      riskPartner: 1n,
      strike: 20n,
      width: 4n,
    })
    const loan = encodeLeg({
      index: 0n,
      asset: 1n,
      optionRatio: 1n,
      isLong: 0n,
      tokenType: 1n,
      riskPartner: 0n,
      strike: 50n,
      width: 0n,
    })
    const positions = [
      { tokenId: poolId | leg0 | leg1, positionSize: 10n ** 18n },
      { tokenId: poolId | loan, positionSize: 100n },
    ]
    expect(positionValueTicks(positions)).toEqual([-887272n, -11n, -8n, 18n, 22n, 887272n])
  })

  it('rejects invalid sizes and malformed cached curves', () => {
    expect(() => positionValueTicks([{ tokenId: 1n, positionSize: 0n }])).toThrow()
    expect(() => positionValueTicks([{ tokenId: 1n << 256n, positionSize: 1n }])).toThrow()
    expect(() =>
      preparePositionValueCurve([
        { tick: 0n, value0: 0n, value1: 0n },
        { tick: 0n, value0: 1n, value1: 1n },
      ]),
    ).toThrow()
  })
  it('keys positions by IDs and raw sizes independently of order', () => {
    const positions = [
      { tokenId: 2n, positionSize: 10n ** 30n },
      { tokenId: 1n, positionSize: 4n },
    ]
    expect(positionValueKey(positions)).toBe(positionValueKey([...positions].reverse()))
    expect(positionValueKey(positions)).not.toBe(positionValueKey(positions.slice(1)))
    expect(positionValueKey(positions)).not.toBe(
      positionValueKey(positions.map((p) => ({ ...p, positionSize: p.positionSize + 1n }))),
    )
  })

  it.each([1n, -1n])('interpolates both token legs with bigint arithmetic (sign %s)', (sign) => {
    const lower = -1000n
    const upper = 1000n
    const sqrtLower = tickToSqrtPriceX96(lower)
    const sqrtUpper = tickToSqrtPriceX96(upper)
    const offset = 10n ** 35n
    const sample = (tick: bigint) => {
      const sqrt = tickToSqrtPriceX96(tick)
      return {
        tick,
        value0: sign * (offset + (sqrtLower * sqrtUpper) / sqrt),
        value1: sign * (offset + sqrt),
      }
    }
    const atTick = preparePositionValueCurve([sample(lower), sample(upper)])
    for (const tick of [lower, -1n, 0n, 1n, upper]) {
      const actual = atTick(tick)
      const expected = sample(tick)
      expect(typeof actual.value0).toBe('bigint')
      expect(typeof actual.value1).toBe('bigint')
      const error0 = actual.value0 - expected.value0
      expect(error0 >= -1n && error0 <= 1n).toBe(true)
      expect(actual.value1).toBe(expected.value1)
    }
    expect(atTick(lower)).toEqual({ value0: sample(lower).value0, value1: sample(lower).value1 })
    expect(atTick(upper)).toEqual({ value0: sample(upper).value0, value1: sample(upper).value1 })
    expect(() => atTick(lower - 1n)).toThrow('Tick outside')
    expect(() => atTick(upper + 1n)).toThrow('Tick outside')
  })
})
