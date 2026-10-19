import { describe, expect, it } from 'vitest'

import { type LegConfig, createTokenIdBuilder } from './builder'
import { getTokenIdValidationError } from './validate'

const leg: LegConfig = {
  asset: 1n,
  optionRatio: 1n,
  isLong: true,
  tokenType: 0n,
  strike: 198490n,
  width: 480n,
}

function position(legs: LegConfig[]) {
  const builder = createTokenIdBuilder(0x000a0888e6a0c2ddn)
  for (const config of legs) builder.addLeg(config)
  return builder.build()
}

describe('getTokenIdValidationError', () => {
  it('rejects the reported three-put RFQ', () => {
    expect(
      getTokenIdValidationError(0x1e003075a9031e003075a5031e00308fe103000a0888e6a0c2ddn),
    ).toMatch(/duplicate legs/)
  })

  it.each([{}, { asset: 0n }, { optionRatio: 2n }, { isLong: false }])(
    'rejects shared chunks regardless of other leg fields: %o',
    (override) => {
      expect(getTokenIdValidationError(position([leg, { ...leg, ...override }]))).toMatch(
        /duplicate legs/,
      )
    },
  )

  it.each([0n, 1n])('accepts discrete chunks with either asset ordering: %s', (asset) => {
    expect(
      getTokenIdValidationError(
        position([
          { ...leg, asset, riskPartner: 1n },
          { ...leg, asset, strike: 198910n, isLong: false, riskPartner: 0n },
          { ...leg, asset: 1n - asset, tokenType: 1n },
          { ...leg, asset, width: 0n },
        ]),
      ),
    ).toBeNull()
  })

  it.each([-1n, 1n << 256n])('rejects values outside uint256: %s', (tokenId) => {
    expect(getTokenIdValidationError(tokenId)).toMatch(/uint256/)
  })

  it('rejects empty positions and gaps, including nonzero data with a zero ratio', () => {
    expect(getTokenIdValidationError(0n)).toMatch(/at least one leg/)
    const single = position([leg])
    const encodedLeg = single >> 64n
    expect(getTokenIdValidationError(single | (encodedLeg << 160n))).toMatch(/non-contiguous/)
    expect(getTokenIdValidationError(single | (1n << 112n))).toMatch(/empty/)
  })

  it.each([-887272n, 887272n])('rejects boundary strikes: %s', (strike) => {
    expect(getTokenIdValidationError(position([{ ...leg, strike }]))).toMatch(/tick bounds/)
  })

  it('rejects missing and non-mutual risk partners', () => {
    expect(getTokenIdValidationError(position([{ ...leg, riskPartner: 1n }]))).toMatch(
      /risk partners/,
    )
    expect(
      getTokenIdValidationError(
        position([
          { ...leg, riskPartner: 1n },
          { ...leg, strike: 198910n },
        ]),
      ),
    ).toMatch(/risk partners/)
  })
})
