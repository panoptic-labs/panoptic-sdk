import { describe, expect, it } from 'vitest'

import { isIncorrectPositionListReadError, isTrustedVaultSharePriceStatus } from './errors'

describe('isIncorrectPositionListReadError', () => {
  it('finds IncorrectPositionList in a nested viem-shaped cause chain', () => {
    const error = Object.assign(new Error('outer computeNAV context'), {
      cause: {
        name: 'ContractFunctionExecutionError',
        cause: {
          name: 'ContractFunctionRevertedError',
          data: { errorName: 'IncorrectPositionList' },
        },
      },
    })

    expect(isIncorrectPositionListReadError(error)).toBe(true)
  })

  it('does not classify unrelated computeNAV failures as position-list failures', () => {
    const error = new Error('[computeNAV] StaleOraclePrice()')

    expect(isIncorrectPositionListReadError(error)).toBe(false)
  })
})

describe('isTrustedVaultSharePriceStatus', () => {
  it.each([
    ['ok', true],
    ['stale_oracle_override', true],
    ['offchain_estimate', false],
    ['nav_reverted', false],
    ['nonpositive_nav', false],
  ])('classifies %s', (status, expected) => {
    expect(isTrustedVaultSharePriceStatus(status)).toBe(expected)
  })
})
