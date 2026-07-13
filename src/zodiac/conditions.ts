import type { Hex } from 'viem'

/** Roles v2 flat condition node (BFS-ordered tree). */
export interface ConditionFlat {
  parent: number
  paramType: number
  operator: number
  compValue: Hex
}

/** True for a 0x-prefixed, 20-byte (40 hex char) address. */
function isHexAddress(v: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(v)
}

/** 32-byte left-padded address as an EqualTo Static compValue. */
export function addressEqualCompValue(addr: `0x${string}`): Hex {
  if (!isHexAddress(addr)) {
    throw new Error(`addressEqualCompValue: expected a 20-byte hex address, got "${addr}"`)
  }
  return `0x${addr.slice(2).toLowerCase().padStart(64, '0')}` as Hex
}

/**
 * Operator.Custom compValue: adapter address in the leading 20 bytes, the
 * trailing 12 bytes are passed to the adapter verbatim as `extra`.
 */
export function customCompValue(adapter: `0x${string}`, extra: Hex = '0x'): Hex {
  if (!isHexAddress(adapter)) {
    throw new Error(`customCompValue: adapter must be a 20-byte hex address, got "${adapter}"`)
  }
  if (!/^0x([0-9a-fA-F]{2})*$/.test(extra)) {
    throw new Error(`customCompValue: extra must be 0x-prefixed, even-length hex, got "${extra}"`)
  }
  if (extra.length - 2 > 24) throw new Error('customCompValue: extra must be at most 12 bytes')
  const extraHex = extra.slice(2).padEnd(24, '0')
  return `0x${adapter.slice(2).toLowerCase()}${extraHex}` as Hex
}

/**
 * Encode a uint96 mint-size cap as the `bytes12 extra` of a pair-condition
 * compValue (0n = uncapped). The adapters read it as `uint96(extra)`, i.e.
 * big-endian right-aligned in the 12 bytes.
 */
export function sizeCapExtra(cap: bigint): Hex {
  if (cap < 0n || cap >= 1n << 96n) throw new Error('size cap must fit in uint96')
  return `0x${cap.toString(16).padStart(24, '0')}` as Hex
}
