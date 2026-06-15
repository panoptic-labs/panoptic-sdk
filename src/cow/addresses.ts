/**
 * CoW Protocol contract addresses and order-book API endpoints.
 *
 * Both contracts are deployed deterministically (CREATE2) and share the same
 * address on every supported chain.
 *
 * @module cow/addresses
 */

import type { Address } from 'viem'

/** GPv2Settlement — EIP-712 verifying contract for signed orders. */
export const COW_SETTLEMENT: Address = '0x9008D19f58AAbD9eD0D60971565AA8510560ab41'

/** GPv2VaultRelayer — the ERC20 approval target (NOT the settlement contract). */
export const COW_VAULT_RELAYER: Address = '0xC92E8bdf79f0507f65a392b0ab4667716BFE0110'

/**
 * Buy-token marker for native ETH. Orders buying this sentinel settle in
 * native ETH (the settlement contract unwraps WETH). Only valid on the buy
 * side — selling native ETH requires the eth-flow contract (unsupported here).
 */
export const COW_NATIVE_ETH: Address = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

/** Order-book API base URL per chain. */
export const COW_API_URLS: Partial<Record<number, string>> = {
  1: 'https://api.cow.fi/mainnet',
  11155111: 'https://api.cow.fi/sepolia',
}

/** Whether CoW Protocol has an order book for the chain. */
export function isCowSupportedChain(chainId: bigint | number): boolean {
  return COW_API_URLS[Number(chainId)] !== undefined
}
