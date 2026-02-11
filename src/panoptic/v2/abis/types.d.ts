/**
 * ABIType overrides (documentation only)
 *
 * This file attempts to override abitype's type mappings to enforce bigint for ALL integer types.
 * However, TypeScript's compilation order prevents this from being applied to the generated ABIs.
 *
 * ## Known Issue
 *
 * abitype maps int24 to `number` by default (intType for M <= 48), but viem ALWAYS returns bigint
 * at runtime. This creates a type mismatch between:
 *
 * - `panopticPoolAbi` (from generated.ts): returns `number | bigint` for int24
 * - `panopticQueryAbi` (from panopticQuery.ts): expects `number` for int24 inputs
 * - viem runtime: always returns and requires `bigint`
 *
 * ## Current Workaround
 *
 * The SDK uses targeted `BigInt()` conversions at boundaries between ABIs and
 * `@ts-expect-error` comments where bigint is passed to ABI functions expecting number.
 * This is safe because viem requires bigint at runtime regardless of TypeScript types.
 *
 * ## Future Fix
 *
 * To properly fix this, either:
 * 1. Regenerate ABIs with wagmi-cli configured to use bigint for all integers
 * 2. Move this override to a location that TypeScript processes before generated.ts
 * 3. Create wrapper functions that enforce bigint types
 *
 * @see https://abitype.dev/config
 * @see https://viem.sh/docs/typescript
 */

declare module 'abitype' {
  export interface Register {
    /** Force small integers (int24, etc.) to bigint instead of number */
    intType: bigint
    /** Force large integers to bigint (already the default) */
    bigIntType: bigint
    addressType: `0x${string}`
  }
}

export {}
