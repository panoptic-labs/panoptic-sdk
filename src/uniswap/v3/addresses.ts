/**
 * Per-chain Uniswap v3 addresses needed for spot quoting via the Universal
 * Router. The Universal Router itself is shared with v4 (see
 * `uniswap/v4/addresses`); only the v3 QuoterV2 is specific to v3.
 *
 * v1 supports mainnet only; other chains throw {@link UnsupportedChainError}
 * unless the address is supplied via overrides (fork tests / new chains).
 *
 * @module uniswap/v3/addresses
 */

import type { Address } from 'viem'

import { UnsupportedChainError } from '../v4/router/errors'

export interface UniswapV3Addresses {
  /** Uniswap v3 QuoterV2 — `quoteExactInputSingle` (revert/staticcall-based). */
  quoterV2: Address
}

/**
 * Verified Uniswap v3 QuoterV2 addresses keyed by chainId. Add a chain only
 * after verifying against the canonical Uniswap v3 deployment listing.
 */
export const UNISWAP_V3_ADDRESSES: Record<number, UniswapV3Addresses> = {
  // Ethereum mainnet
  1: { quoterV2: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e' },
}

/**
 * Resolve Uniswap v3 addresses for a chain, applying optional overrides.
 *
 * @throws {UnsupportedChainError} when the chain is not listed and overrides do
 *   not supply every required address.
 */
export function getUniswapV3Addresses(
  chainId: number | bigint,
  overrides?: Partial<UniswapV3Addresses>,
): UniswapV3Addresses {
  const id = Number(chainId)
  const base = UNISWAP_V3_ADDRESSES[id]
  const merged = { ...base, ...overrides }
  if (!merged.quoterV2) {
    throw new UnsupportedChainError(BigInt(id))
  }
  return merged as UniswapV3Addresses
}
