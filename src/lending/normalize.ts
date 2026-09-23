export function normalizeUnsignedBigInt(value: unknown): bigint {
  let normalized: bigint
  if (typeof value === 'bigint') {
    normalized = value
  } else if (typeof value === 'string' && /^\d+$/.test(value)) {
    normalized = BigInt(value)
  } else if (typeof value === 'number' && Number.isSafeInteger(value)) {
    normalized = BigInt(value)
  } else {
    throw new TypeError('Expected an unsigned bigint-compatible value')
  }

  if (normalized < 0n) throw new RangeError('Expected a nonnegative value')
  return normalized
}

export function normalizeTokenDecimals(value: unknown): number {
  const normalized = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  if (
    typeof normalized !== 'number' ||
    !Number.isSafeInteger(normalized) ||
    normalized < 0 ||
    normalized > 255
  ) {
    throw new RangeError('Expected token decimals between 0 and 255')
  }
  return normalized
}
