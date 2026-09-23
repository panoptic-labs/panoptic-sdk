import { keccak256 } from 'viem'
import { describe, expect, it } from 'vitest'

import { ROBINHOOD_PANOPTIC_VAULT_ACCOUNTANT_RUNTIME_BYTECODE } from './robinhoodAccountantRuntime'
import {
  getStaleOracleOverrideBytecodeForAccountant,
  getStaleOracleStateOverrideForAccountant,
} from './staleOracleOverride'

const MAINNET_ACCOUNTANT_ADDRESS = '0x65aA902AE3135658587FFC36ED51B61c927114e1'
const ROBINHOOD_ACCOUNTANT_ADDRESS = '0x9e345d862c41010F87D8E5A279e8D320D2831D36'
const UNSUPPORTED_ACCOUNTANT_ADDRESS = '0x0000000000000000000000000000000000000001'
const ORIGINAL_STALE_ORACLE_GUARD = /131561[0-9a-f]{4}57604051631510fe5b60e31b/g
const BYPASSED_STALE_ORACLE_GUARD = /135061[0-9a-f]{4}56604051631510fe5b60e31b/g
const STALE_ORACLE_REVERT_BODY = /604051631510fe5b60e31b/g

function countMatches(value: string, pattern: RegExp): number {
  return [...value.matchAll(pattern)].length
}

describe('stale oracle state override', () => {
  it('bypasses only the three manager-price guards in the read-only runtime', () => {
    const bytecode = getStaleOracleOverrideBytecodeForAccountant(MAINNET_ACCOUNTANT_ADDRESS)

    expect(bytecode).toBeDefined()
    if (bytecode === undefined) {
      throw new Error('Expected a mainnet accountant override.')
    }

    expect((bytecode.length - 2) / 2).toBe(12_840)
    expect(countMatches(bytecode, ORIGINAL_STALE_ORACLE_GUARD)).toBe(0)
    expect(countMatches(bytecode, BYPASSED_STALE_ORACLE_GUARD)).toBe(3)
    // The revert bodies remain intact; only their conditional branches are bypassed.
    expect(countMatches(bytecode, STALE_ORACLE_REVERT_BODY)).toBe(3)
  })

  it('uses the patched runtime in the state override', () => {
    const bytecode = getStaleOracleOverrideBytecodeForAccountant(MAINNET_ACCOUNTANT_ADDRESS)

    expect(getStaleOracleStateOverrideForAccountant(MAINNET_ACCOUNTANT_ADDRESS)).toEqual([
      {
        address: MAINNET_ACCOUNTANT_ADDRESS,
        code: bytecode,
      },
    ])
  })

  it('patches the four stale-price guards in the Robinhood accountant runtime', () => {
    expect(keccak256(ROBINHOOD_PANOPTIC_VAULT_ACCOUNTANT_RUNTIME_BYTECODE)).toBe(
      '0x1c8a46e0adfa6e9d49663d0d1a00837dee5791f0fffef870eb44905b66372520',
    )
    const bytecode = getStaleOracleOverrideBytecodeForAccountant(ROBINHOOD_ACCOUNTANT_ADDRESS)

    expect(bytecode).toBeDefined()
    if (bytecode === undefined) {
      throw new Error('Expected a Robinhood accountant override.')
    }

    expect((bytecode.length - 2) / 2).toBe(12_919)
    expect(countMatches(bytecode, ORIGINAL_STALE_ORACLE_GUARD)).toBe(0)
    expect(countMatches(bytecode, BYPASSED_STALE_ORACLE_GUARD)).toBe(4)
    expect(countMatches(bytecode, STALE_ORACLE_REVERT_BODY)).toBe(4)
    expect(getStaleOracleStateOverrideForAccountant(ROBINHOOD_ACCOUNTANT_ADDRESS)).toEqual([
      {
        address: ROBINHOOD_ACCOUNTANT_ADDRESS,
        code: bytecode,
      },
    ])
  })

  it('does not create an override for an unsupported accountant', () => {
    expect(getStaleOracleStateOverrideForAccountant(UNSUPPORTED_ACCOUNTANT_ADDRESS)).toBeUndefined()
  })
})
