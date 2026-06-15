/**
 * Per-chain Uniswap v4 infrastructure addresses (Universal Router, V4Quoter,
 * PoolManager, Permit2).
 *
 * v1 supports mainnet only; other chains throw {@link UnsupportedChainError}
 * unless every address is supplied via the `overrides` argument (e.g. anvil
 * fork tests, or bots targeting a not-yet-listed chain).
 *
 * @module uniswap/v4/addresses
 */

import type { Address } from 'viem'

import { UnsupportedChainError } from './router/errors'

/**
 * Uniswap v4 contract addresses required for a Universal Router spot swap.
 */
export interface UniswapV4Addresses {
  /** Universal Router (v4-capable build) — entrypoint for `execute(...)`. */
  universalRouter: Address
  /** V4Quoter — `quoteExactInputSingle` (revert/staticcall-based). */
  v4Quoter: Address
  /** Uniswap v4 PoolManager (singleton). */
  poolManager: Address
  /** Canonical Permit2 (same address on every chain). */
  permit2: Address
}

/**
 * Canonical Permit2, identical across all chains.
 */
export const PERMIT2_ADDRESS: Address = '0x000000000022D473030F116dDEE9F6B43aC78BA3'

/**
 * Verified Uniswap v4 deployment addresses keyed by chainId.
 *
 * Sourced from the official Uniswap v4 deployments. Add a chain here only after
 * verifying each address against the canonical Uniswap deployment listing —
 * Universal Router in particular is NOT the same address across chains.
 */
export const UNISWAP_V4_ADDRESSES: Record<number, UniswapV4Addresses> = {
  // Ethereum mainnet
  1: {
    universalRouter: '0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af',
    v4Quoter: '0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203',
    poolManager: '0x000000000004444c5dc75cB358380D2e3dE08A90',
    permit2: PERMIT2_ADDRESS,
  },
}

/**
 * Resolve the Uniswap v4 addresses for a chain, applying optional overrides.
 *
 * @param chainId - Target chain ID.
 * @param overrides - Partial override of any address (e.g. for fork tests).
 * @returns Fully-resolved {@link UniswapV4Addresses}.
 * @throws {UnsupportedChainError} when the chain is not listed and the
 *   overrides do not supply every required address.
 */
export function getUniswapV4Addresses(
  chainId: bigint,
  overrides?: Partial<UniswapV4Addresses>,
): UniswapV4Addresses {
  const base = UNISWAP_V4_ADDRESSES[Number(chainId)]

  const merged: Partial<UniswapV4Addresses> = {
    ...base,
    ...overrides,
    permit2: overrides?.permit2 ?? base?.permit2 ?? PERMIT2_ADDRESS,
  }

  if (
    merged.universalRouter === undefined ||
    merged.v4Quoter === undefined ||
    merged.poolManager === undefined ||
    merged.permit2 === undefined
  ) {
    throw new UnsupportedChainError(chainId)
  }

  return merged as UniswapV4Addresses
}
