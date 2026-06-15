import type { Address } from 'viem'
import { describe, expect, it } from 'vitest'

import type { PoolKey } from '../types'
import {
  computePoolIdV4,
  minePoolAddressLocal,
  numberOfLeadingHexZeros,
} from './minePoolAddressLocal'

const MOCK_FACTORY = '0x000000000000010a1DEc6c46371A28A071F8bb01' as Address
const MOCK_DEPLOYER = '0x557a1a07653a637d8e0c01074d9c33618c0956af' as Address
const MOCK_RISK_ENGINE = '0x0000000000000000000000000000000000000000' as Address
const MOCK_V3_POOL = '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640' as Address

const MOCK_POOL_KEY: PoolKey = {
  currency0: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address,
  currency1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
  fee: 500n,
  tickSpacing: 10n,
  hooks: '0x0000000000000000000000000000000000000000' as Address,
}

describe('numberOfLeadingHexZeros', () => {
  it('returns 40 for zero address', () => {
    expect(numberOfLeadingHexZeros(0n)).toBe(40)
  })

  it('returns 0 for max address', () => {
    expect(numberOfLeadingHexZeros((1n << 160n) - 1n)).toBe(0)
  })

  it('returns correct count for address with known leading zeros', () => {
    // 0x00000abc... has 4 leading hex zeros: MSN at nibble 35, so 39-35=4? Let's check
    // 0x0000000abc... = 0x0000000abc shifted — let's use a clean known value
    // 0x000001... — leading zeros: 5 (since first nonzero nibble is '1' at position 5)
    const addr = BigInt('0x000001' + '0'.repeat(34)) // 0x000001 followed by 34 zeros = 20 bytes
    expect(numberOfLeadingHexZeros(addr)).toBe(5)
  })

  it('returns 0 for typical address', () => {
    // 0xC02aaA39... — starts with C, so 0 leading zeros
    expect(numberOfLeadingHexZeros(BigInt('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'))).toBe(0)
  })
})

describe('computePoolIdV4', () => {
  it('returns a non-zero bigint for a valid pool key', () => {
    const id = computePoolIdV4(MOCK_POOL_KEY)
    expect(id).toBeTypeOf('bigint')
    expect(id).toBeGreaterThan(0n)
  })

  it('returns different ids for different pool keys', () => {
    const id1 = computePoolIdV4(MOCK_POOL_KEY)
    const id2 = computePoolIdV4({ ...MOCK_POOL_KEY, fee: 3000n })
    expect(id1).not.toBe(id2)
  })
})

describe('minePoolAddressLocal loops=0n', () => {
  it('returns initial salt with zero rarity for v3', () => {
    const result = minePoolAddressLocal({
      version: 'v3',
      factoryAddress: MOCK_FACTORY,
      deployerAddress: MOCK_DEPLOYER,
      v3Pool: MOCK_V3_POOL,
      riskEngine: MOCK_RISK_ENGINE,
      salt: 42n,
      loops: 0n,
      minTargetRarity: 99n,
    })

    expect(result.bestSalt).toBe(42n)
    expect(result.highestRarity).toBe(0n)
  })

  it('returns initial salt with zero rarity for v4', () => {
    const result = minePoolAddressLocal({
      version: 'v4',
      factoryAddress: MOCK_FACTORY,
      deployerAddress: MOCK_DEPLOYER,
      poolKey: MOCK_POOL_KEY,
      riskEngine: MOCK_RISK_ENGINE,
      salt: 42n,
      loops: 0n,
      minTargetRarity: 99n,
    })

    expect(result.bestSalt).toBe(42n)
    expect(result.highestRarity).toBe(0n)
  })
})

describe('minePoolAddressLocal V3', () => {
  it('runs for the given number of loops and returns a result', () => {
    const result = minePoolAddressLocal({
      version: 'v3',
      factoryAddress: MOCK_FACTORY,
      deployerAddress: MOCK_DEPLOYER,
      v3Pool: MOCK_V3_POOL,
      riskEngine: MOCK_RISK_ENGINE,
      salt: 0n,
      loops: 100n,
      minTargetRarity: 99n, // unreachably high — runs all 100 loops
    })

    expect(result.bestSalt).toBeTypeOf('bigint')
    expect(result.highestRarity).toBeTypeOf('bigint')
    expect(result.highestRarity).toBeGreaterThanOrEqual(0n)
    expect(result.bestSalt).toBeGreaterThanOrEqual(0n)
    expect(result.bestSalt).toBeLessThan(100n)
  })

  it('stops early when minTargetRarity is 0', () => {
    const result = minePoolAddressLocal({
      version: 'v3',
      factoryAddress: MOCK_FACTORY,
      deployerAddress: MOCK_DEPLOYER,
      v3Pool: MOCK_V3_POOL,
      riskEngine: MOCK_RISK_ENGINE,
      salt: 0n,
      loops: 1000n,
      minTargetRarity: 0n, // always satisfied on first iteration
    })

    // With minTargetRarity=0 (any rarity is enough), stops at salt=0
    expect(result.bestSalt).toBe(0n)
  })

  it('returns deterministic results', () => {
    const params = {
      version: 'v3' as const,
      factoryAddress: MOCK_FACTORY,
      deployerAddress: MOCK_DEPLOYER,
      v3Pool: MOCK_V3_POOL,
      riskEngine: MOCK_RISK_ENGINE,
      salt: 0n,
      loops: 50n,
      minTargetRarity: 99n,
    }
    const r1 = minePoolAddressLocal(params)
    const r2 = minePoolAddressLocal(params)
    expect(r1.bestSalt).toBe(r2.bestSalt)
    expect(r1.highestRarity).toBe(r2.highestRarity)
  })
})

describe('minePoolAddressLocal V4', () => {
  it('runs for the given number of loops and returns a result', () => {
    const result = minePoolAddressLocal({
      version: 'v4',
      factoryAddress: MOCK_FACTORY,
      deployerAddress: MOCK_DEPLOYER,
      poolKey: MOCK_POOL_KEY,
      riskEngine: MOCK_RISK_ENGINE,
      salt: 0n,
      loops: 100n,
      minTargetRarity: 99n,
    })

    expect(result.bestSalt).toBeTypeOf('bigint')
    expect(result.highestRarity).toBeTypeOf('bigint')
    expect(result.highestRarity).toBeGreaterThanOrEqual(0n)
    expect(result.bestSalt).toBeLessThan(100n)
  })

  it('returns deterministic results', () => {
    const params = {
      version: 'v4' as const,
      factoryAddress: MOCK_FACTORY,
      deployerAddress: MOCK_DEPLOYER,
      poolKey: MOCK_POOL_KEY,
      riskEngine: MOCK_RISK_ENGINE,
      salt: 0n,
      loops: 50n,
      minTargetRarity: 99n,
    }
    const r1 = minePoolAddressLocal(params)
    const r2 = minePoolAddressLocal(params)
    expect(r1.bestSalt).toBe(r2.bestSalt)
    expect(r1.highestRarity).toBe(r2.highestRarity)
  })
})
