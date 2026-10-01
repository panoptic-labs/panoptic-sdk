import { BaseError, ContractFunctionRevertedError, encodeErrorResult } from 'viem'
import { describe, expect, it } from 'vitest'

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
