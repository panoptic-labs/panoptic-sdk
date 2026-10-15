import { BaseError, ContractFunctionRevertedError, encodeErrorResult } from 'viem'
import { describe, expect, it } from 'vitest'

import { getNotEnoughTokensError } from '../simulations/tokenShortfallRecovery'
import { NotEnoughTokensError } from './contract'
import { panopticErrorsAbi } from './errorsAbi'
import { parsePanopticError } from './parser'

const tracker = '0x3CCdA7d5E841d6543D90BcEc20b36a724C184DE9'
const data = encodeErrorResult({
  abi: panopticErrorsAbi,
  errorName: 'NotEnoughTokens',
  args: [tracker, 30_000_000n, 29_990_994n],
})

describe('undecoded viem errors', () => {
  it.each(['viem', 'plain'] as const)(
    'recovers full arguments from raw revert data through a %s wrapper',
    (wrapper) => {
      const cause = new ContractFunctionRevertedError({ abi: [], functionName: 'dispatch', data })
      const error =
        wrapper === 'viem'
          ? new BaseError('Simulation failed', { cause })
          : Object.assign(new Error('Simulation failed'), { cause })
      const parsed = parsePanopticError(error)
      expect(parsed?.error).toBeInstanceOf(NotEnoughTokensError)
      expect(parsed?.error).toMatchObject({
        tokenAddress: tracker,
        assetsRequested: 30_000_000n,
        assetBalance: 29_990_994n,
      })
    },
  )

  it.each([
    'reverted with signature: 0x71c3730b',
    'reverted with signature 0x71c3730b',
    'Unable to decode signature "0x71c3730b"',
  ])('recognizes selector-only message: %s', (message) => {
    expect(parsePanopticError(new Error(message))?.errorName).toBe('NotEnoughTokens')
  })
})

describe('token shortfall signatures', () => {
  it.each([false, true])('decodes the account-address variant: %s', (withAccount) => {
    const data = withAccount
      ? encodeErrorResult({
          abi: panopticErrorsAbi,
          errorName: 'NotEnoughTokens',
          args: [tracker, '0x0000000000000000000000000000000000000001', 30_000_000n, 29_990_994n],
        })
      : encodeErrorResult({
          abi: panopticErrorsAbi,
          errorName: 'NotEnoughTokens',
          args: [tracker, 30_000_000n, 29_990_994n],
        })
    const parsed = getNotEnoughTokensError({ data })
    expect(parsed).toMatchObject({
      assetsRequested: 30_000_000n,
      assetBalance: 29_990_994n,
      deficit: 9_006n,
    })
  })

  it('unwraps nested executeBatch failures', () => {
    const inner = encodeErrorResult({
      abi: panopticErrorsAbi,
      errorName: 'NotEnoughTokens',
      args: [tracker, 10n, 4n],
    })
    const wrapped = encodeErrorResult({
      abi: panopticErrorsAbi,
      errorName: 'ExecuteError',
      args: [2n, inner],
    })
    const outer = encodeErrorResult({
      abi: panopticErrorsAbi,
      errorName: 'ExecuteError',
      args: [1n, wrapped],
    })
    expect(getNotEnoughTokensError({ data: outer })?.deficit).toBe(6n)
  })

  it('does not report a negative deficit', () => {
    expect(new NotEnoughTokensError(tracker, 4n, 10n).deficit).toBe(0n)
  })
})
