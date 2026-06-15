/**
 * Resolve xStocks (tokenized equities) to their Backed ERC4626 wrapper, and
 * back.
 *
 * xStocks are rebasing, so they can't be used directly in AMMs / Panoptic
 * pools — those are built on the non-rebasing **wrapped** version minted by the
 * Backed `WrappedBackedTokenFactory`. CoW Swap, by contrast, trades the
 * unwrapped xStock. A user who buys e.g. NVDAx on CoW therefore holds the
 * unwrapped token and must wrap it before lending it or selling it through the
 * Uniswap/Panoptic venue.
 *
 * The factory exposes no underlying→wrapper lookup and its `NewToken` event
 * omits the underlying, so this mapping is generated offline (see
 * `scripts/gen-xstock-wrappers.ts`) into {@link XSTOCK_WRAPPERS} and resolved
 * statically here — no runtime fetch.
 *
 * Each wrapper is a standard ERC4626 vault: `asset()` is the underlying xStock,
 * `deposit` wraps, `redeem` unwraps, and `convertToShares`/`convertToAssets`
 * (or `previewDeposit`/`previewRedeem`) convert amounts.
 *
 * @module cow/xstockWrappers
 */

import type { Address } from 'viem'

import { XSTOCK_WRAPPERS } from './xstockWrappers.generated'

export { XSTOCK_WRAPPERS }

/** A single xStock → wrapper mapping entry. */
export interface XstockWrapperInfo {
  /** ERC4626 wrapper (the token Panoptic/Uniswap pools trade). */
  wrapper: Address
  /** Underlying rebasing xStock (`asset()` of the wrapper; the CoW-traded token). */
  underlying: Address
  /** Wrapper symbol, e.g. `wNVDAx`. */
  symbol: string
  /** Wrapper name, e.g. `Wrapped NVIDIA xStock`. */
  name: string
  /** Wrapper (and underlying) ERC20 decimals. */
  decimals: number
}

/** Generated registry keyed by chainId. */
export type XstockWrapperRegistry = Partial<Record<number, XstockWrapperInfo[]>>

/**
 * Per-chain lookup indices, built lazily from the static registry. Keys are
 * lowercased addresses for case-insensitive matching. Caching static config is
 * safe (it carries no dynamic on-chain data).
 */
const indexCache = new Map<
  number,
  { byUnderlying: Map<string, XstockWrapperInfo>; byWrapper: Map<string, XstockWrapperInfo> }
>()

function getIndex(chainId: number) {
  let idx = indexCache.get(chainId)
  if (!idx) {
    const byUnderlying = new Map<string, XstockWrapperInfo>()
    const byWrapper = new Map<string, XstockWrapperInfo>()
    for (const entry of XSTOCK_WRAPPERS[chainId] ?? []) {
      byUnderlying.set(entry.underlying.toLowerCase(), entry)
      byWrapper.set(entry.wrapper.toLowerCase(), entry)
    }
    idx = { byUnderlying, byWrapper }
    indexCache.set(chainId, idx)
  }
  return idx
}

/**
 * Resolve the wrapper for an unwrapped xStock. Returns `undefined` when the
 * address isn't a known xStock underlying on this chain.
 */
export function getXstockWrapper(
  chainId: number,
  underlying: Address,
): XstockWrapperInfo | undefined {
  return getIndex(chainId).byUnderlying.get(underlying.toLowerCase())
}

/**
 * Resolve the underlying xStock for a wrapper address. Returns `undefined` when
 * the address isn't a known xStock wrapper on this chain.
 */
export function getXstockUnderlying(
  chainId: number,
  wrapper: Address,
): XstockWrapperInfo | undefined {
  return getIndex(chainId).byWrapper.get(wrapper.toLowerCase())
}

/** True if `address` is a known unwrapped xStock on this chain. */
export function isXstockUnderlying(chainId: number, address: Address): boolean {
  return getXstockWrapper(chainId, address) !== undefined
}

/** True if `address` is a known xStock wrapper on this chain. */
export function isXstockWrapper(chainId: number, address: Address): boolean {
  return getXstockUnderlying(chainId, address) !== undefined
}
