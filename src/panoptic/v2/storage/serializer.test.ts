import { describe, expect, it } from 'vitest'

import { jsonSerializer } from './serializer'

describe('jsonSerializer', () => {
  describe('stringify', () => {
    it('serializes primitive values', () => {
      expect(jsonSerializer.stringify('hello')).toBe('"hello"')
      expect(jsonSerializer.stringify(42)).toBe('42')
      expect(jsonSerializer.stringify(true)).toBe('true')
      expect(jsonSerializer.stringify(null)).toBe('null')
    })

    it('serializes BigInt values with tagging', () => {
      const result = jsonSerializer.stringify(42n)
      expect(result).toBe('{"__type":"bigint","value":"42"}')
    })

    it('serializes large BigInt values', () => {
      const largeValue = 1000000000000000000n
      const result = jsonSerializer.stringify(largeValue)
      const parsed = JSON.parse(result)
      expect(parsed.__type).toBe('bigint')
      expect(parsed.value).toBe('1000000000000000000')
    })

    it('serializes negative BigInt values', () => {
      const result = jsonSerializer.stringify(-123n)
      const parsed = JSON.parse(result)
      expect(parsed.__type).toBe('bigint')
      expect(parsed.value).toBe('-123')
    })

    it('serializes objects with BigInt properties', () => {
      const obj = { amount: 100n, name: 'test' }
      const result = jsonSerializer.stringify(obj)
      const parsed = JSON.parse(result)
      expect(parsed.amount.__type).toBe('bigint')
      expect(parsed.amount.value).toBe('100')
      expect(parsed.name).toBe('test')
    })

    it('serializes nested objects with BigInt values', () => {
      const obj = {
        level1: {
          level2: {
            value: 42n,
          },
        },
      }
      const result = jsonSerializer.stringify(obj)
      const parsed = JSON.parse(result)
      expect(parsed.level1.level2.value.__type).toBe('bigint')
      expect(parsed.level1.level2.value.value).toBe('42')
    })

    it('serializes arrays with BigInt values', () => {
      const arr = [1n, 2n, 3n]
      const result = jsonSerializer.stringify(arr)
      const parsed = JSON.parse(result)
      expect(parsed[0].__type).toBe('bigint')
      expect(parsed[1].__type).toBe('bigint')
      expect(parsed[2].__type).toBe('bigint')
    })

    it('handles mixed arrays', () => {
      const arr = [1, 2n, 'three', { four: 4n }]
      const result = jsonSerializer.stringify(arr)
      const parsed = JSON.parse(result)
      expect(parsed[0]).toBe(1)
      expect(parsed[1].__type).toBe('bigint')
      expect(parsed[2]).toBe('three')
      expect(parsed[3].four.__type).toBe('bigint')
    })

    it('accepts space parameter for formatting', () => {
      const obj = { a: 1n }
      const result = jsonSerializer.stringify(obj, 2)
      expect(result).toContain('\n')
      expect(result).toContain('  ')
    })
  })

  describe('parse', () => {
    it('parses primitive values', () => {
      expect(jsonSerializer.parse('"hello"')).toBe('hello')
      expect(jsonSerializer.parse('42')).toBe(42)
      expect(jsonSerializer.parse('true')).toBe(true)
      expect(jsonSerializer.parse('null')).toBeNull()
    })

    it('restores tagged BigInt values', () => {
      const json = '{"__type":"bigint","value":"42"}'
      const result = jsonSerializer.parse(json)
      expect(result).toBe(42n)
      expect(typeof result).toBe('bigint')
    })

    it('restores large BigInt values', () => {
      const json = '{"__type":"bigint","value":"1000000000000000000"}'
      const result = jsonSerializer.parse(json)
      expect(result).toBe(1000000000000000000n)
    })

    it('restores negative BigInt values', () => {
      const json = '{"__type":"bigint","value":"-123"}'
      const result = jsonSerializer.parse(json)
      expect(result).toBe(-123n)
    })

    it('restores objects with BigInt properties', () => {
      const json = '{"amount":{"__type":"bigint","value":"100"},"name":"test"}'
      const result = jsonSerializer.parse(json) as { amount: bigint; name: string }
      expect(result.amount).toBe(100n)
      expect(result.name).toBe('test')
    })

    it('restores nested objects with BigInt values', () => {
      const json = '{"level1":{"level2":{"value":{"__type":"bigint","value":"42"}}}}'
      const result = jsonSerializer.parse(json) as {
        level1: { level2: { value: bigint } }
      }
      expect(result.level1.level2.value).toBe(42n)
    })

    it('restores arrays with BigInt values', () => {
      const json = '[{"__type":"bigint","value":"1"},{"__type":"bigint","value":"2"}]'
      const result = jsonSerializer.parse(json) as bigint[]
      expect(result[0]).toBe(1n)
      expect(result[1]).toBe(2n)
    })
  })

  describe('round-trip', () => {
    it('preserves simple BigInt', () => {
      const original = 42n
      const roundTripped = jsonSerializer.parse(jsonSerializer.stringify(original))
      expect(roundTripped).toBe(original)
    })

    it('preserves complex nested structure', () => {
      const original = {
        positions: [
          { tokenId: 123456789012345678901234567890n, size: 1000n },
          { tokenId: 987654321098765432109876543210n, size: 2000n },
        ],
        account: '0x1234',
        metadata: {
          lastSync: 18000000n,
          pendingCount: 0n,
        },
      }

      const json = jsonSerializer.stringify(original)
      const restored = jsonSerializer.parse(json) as typeof original

      expect(restored.positions[0].tokenId).toBe(123456789012345678901234567890n)
      expect(restored.positions[0].size).toBe(1000n)
      expect(restored.positions[1].tokenId).toBe(987654321098765432109876543210n)
      expect(restored.account).toBe('0x1234')
      expect(restored.metadata.lastSync).toBe(18000000n)
      expect(restored.metadata.pendingCount).toBe(0n)
    })

    it('preserves zero BigInt', () => {
      const original = { value: 0n }
      const restored = jsonSerializer.parse(jsonSerializer.stringify(original)) as { value: bigint }
      expect(restored.value).toBe(0n)
    })

    it('preserves MAX_SAFE_INTEGER as BigInt', () => {
      // Number.MAX_SAFE_INTEGER is 9007199254740991
      const original = { value: 9007199254740991n }
      const restored = jsonSerializer.parse(jsonSerializer.stringify(original)) as { value: bigint }
      expect(restored.value).toBe(9007199254740991n)
      expect(typeof restored.value).toBe('bigint')
    })

    it('preserves values larger than MAX_SAFE_INTEGER', () => {
      // TokenIds can be very large (256-bit)
      const veryLarge =
        115792089237316195423570985008687907853269984665640564039457584007913129639935n
      const original = { tokenId: veryLarge }
      const restored = jsonSerializer.parse(jsonSerializer.stringify(original)) as {
        tokenId: bigint
      }
      expect(restored.tokenId).toBe(veryLarge)
    })
  })

  describe('edge cases', () => {
    it('handles empty object', () => {
      const original = {}
      const restored = jsonSerializer.parse(jsonSerializer.stringify(original))
      expect(restored).toEqual({})
    })

    it('handles empty array', () => {
      const original: bigint[] = []
      const restored = jsonSerializer.parse(jsonSerializer.stringify(original))
      expect(restored).toEqual([])
    })

    it('does not restore non-BigInt tagged objects', () => {
      // An object that happens to have __type and value but isn't a bigint tag
      const json = '{"__type":"other","value":"not-a-bigint"}'
      const result = jsonSerializer.parse(json) as { __type: string; value: string }
      expect(result.__type).toBe('other')
      expect(result.value).toBe('not-a-bigint')
    })

    it('handles object with __type but no value', () => {
      const json = '{"__type":"bigint"}'
      const result = jsonSerializer.parse(json) as { __type: string }
      expect(result.__type).toBe('bigint')
    })

    it('handles object with value but wrong __type', () => {
      const json = '{"__type":"string","value":"42"}'
      const result = jsonSerializer.parse(json) as { __type: string; value: string }
      expect(result.__type).toBe('string')
      expect(result.value).toBe('42')
    })
  })
})
