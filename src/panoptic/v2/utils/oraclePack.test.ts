import { describe, expect, it } from 'vitest'

import { decodeOraclePack, decodeOracleTiming, oracleEpochAt } from './oraclePack'

const MASK_22 = (1n << 22n) - 1n

function signed22(value: bigint): bigint {
  return value & MASK_22
}

describe('OraclePack decoding', () => {
  it('decodes signed ticks, EMAs, lock mode, and epoch', () => {
    const epoch = 123n
    const blockTimestamp = epoch * 64n + 12n
    const oraclePack =
      (epoch << 232n) |
      (signed22(-456n) << 96n) |
      (3n << 118n) |
      (signed22(-100n) << 120n) |
      (signed22(200n) << 142n) |
      (signed22(-300n) << 164n) |
      (signed22(400n) << 186n)

    expect(decodeOraclePack(oraclePack, blockTimestamp)).toEqual({
      referenceTick: -456n,
      lockMode: 3n,
      spotEMA: -100n,
      fastEMA: 200n,
      slowEMA: -300n,
      eonsEMA: 400n,
      epoch,
      timestamp: epoch * 64n,
    })
  })

  it('decodes signed 22-bit boundaries and every lock mode', () => {
    const minimum = -(1n << 21n)
    const maximum = (1n << 21n) - 1n

    for (const lockMode of [0n, 1n, 2n, 3n]) {
      const oraclePack =
        (signed22(minimum) << 96n) |
        (lockMode << 118n) |
        (signed22(maximum) << 120n) |
        (signed22(minimum) << 142n) |
        (signed22(maximum) << 164n) |
        (signed22(minimum) << 186n)
      expect(decodeOraclePack(oraclePack, 0n)).toMatchObject({
        referenceTick: minimum,
        lockMode,
        spotEMA: maximum,
        fastEMA: minimum,
        slowEMA: maximum,
        eonsEMA: minimum,
      })
    }
  })

  it('resolves the modulo epoch to an absolute timestamp across wraparound', () => {
    const timestamp = (1n << 30n) + 130n
    const epoch = oracleEpochAt(timestamp)

    expect(epoch).toBe(2n)
    expect(decodeOracleTiming(epoch << 232n, timestamp)).toEqual({
      epoch,
      timestamp: (1n << 30n) + 128n,
    })
    expect(decodeOracleTiming(((1n << 24n) - 1n) << 232n, 1n << 30n)).toEqual({
      epoch: (1n << 24n) - 1n,
      timestamp: (1n << 30n) - 64n,
    })
  })
})
