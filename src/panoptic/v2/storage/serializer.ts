/**
 * BigInt-safe JSON serialization for the Panoptic v2 SDK.
 * Compatible with superjson patterns for SSR hydration.
 * @module v2/storage/serializer
 */

/**
 * Tagged value for BigInt serialization.
 * Format compatible with superjson for Next.js/Remix SSR.
 */
interface BigIntTagged {
  __type: 'bigint'
  value: string
}

/**
 * Type guard to check if a value is a tagged BigInt.
 */
function isBigIntTagged(value: unknown): value is BigIntTagged {
  return (
    value !== null &&
    typeof value === 'object' &&
    '__type' in value &&
    (value as BigIntTagged).__type === 'bigint' &&
    'value' in value &&
    typeof (value as BigIntTagged).value === 'string'
  )
}

/**
 * Replacer function for JSON.stringify that tags BigInt values.
 */
function replacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return {
      __type: 'bigint',
      value: value.toString(),
    } satisfies BigIntTagged
  }
  return value
}

/**
 * Reviver function for JSON.parse that restores tagged BigInt values.
 */
function reviver(_key: string, value: unknown): unknown {
  if (isBigIntTagged(value)) {
    return BigInt(value.value)
  }
  return value
}

/**
 * BigInt-safe JSON serializer for the Panoptic v2 SDK.
 *
 * This serializer handles BigInt values by tagging them with a special format
 * that can be restored on parse. The format is compatible with superjson
 * patterns used in Next.js and Remix for SSR hydration.
 *
 * @example
 * ```typescript
 * import { jsonSerializer } from 'panoptic-v2-sdk'
 *
 * const data = { amount: 1000000000000000000n, nested: { value: 42n } }
 *
 * // Serialize to JSON string
 * const json = jsonSerializer.stringify(data)
 * // '{"amount":{"__type":"bigint","value":"1000000000000000000"},"nested":{"value":{"__type":"bigint","value":"42"}}}'
 *
 * // Parse back to original types
 * const parsed = jsonSerializer.parse(json)
 * // { amount: 1000000000000000000n, nested: { value: 42n } }
 * ```
 */
export const jsonSerializer = {
  /**
   * Serialize a value to a JSON string, handling BigInt values.
   *
   * @param value - The value to serialize
   * @param space - Optional indentation (same as JSON.stringify)
   * @returns JSON string with BigInt values tagged
   */
  stringify(value: unknown, space?: string | number): string {
    return JSON.stringify(value, replacer, space)
  },

  /**
   * Parse a JSON string, restoring tagged BigInt values.
   *
   * @param text - The JSON string to parse
   * @returns The parsed value with BigInt values restored
   */
  parse(text: string): unknown {
    return JSON.parse(text, reviver)
  },
} as const
