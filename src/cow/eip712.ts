/**
 * EIP-712 typed-data definitions for GPv2 (CoW Protocol) orders.
 * @module cow/eip712
 */

import { type Address, keccak256, stringToHex } from 'viem'

import { COW_SETTLEMENT } from './addresses'

/** GPv2 `Order` struct, in EIP-712 typed-data form. */
export const COW_ORDER_TYPES = {
  Order: [
    { name: 'sellToken', type: 'address' },
    { name: 'buyToken', type: 'address' },
    { name: 'receiver', type: 'address' },
    { name: 'sellAmount', type: 'uint256' },
    { name: 'buyAmount', type: 'uint256' },
    { name: 'validTo', type: 'uint32' },
    { name: 'appData', type: 'bytes32' },
    { name: 'feeAmount', type: 'uint256' },
    { name: 'kind', type: 'string' },
    { name: 'partiallyFillable', type: 'bool' },
    { name: 'sellTokenBalance', type: 'string' },
    { name: 'buyTokenBalance', type: 'string' },
  ],
} as const

/** GPv2 order-cancellation struct (batch of order UIDs). */
export const COW_CANCELLATION_TYPES = {
  OrderCancellations: [{ name: 'orderUids', type: 'bytes[]' }],
} as const

/** EIP-712 domain for GPv2Settlement on the given chain. */
export function cowDomain(chainId: bigint | number): {
  name: string
  version: string
  chainId: number
  verifyingContract: Address
} {
  return {
    name: 'Gnosis Protocol',
    version: 'v2',
    chainId: Number(chainId),
    verifyingContract: COW_SETTLEMENT,
  }
}

/**
 * Full appData JSON document attached to orders. The order itself carries only
 * its keccak256 hash; the API stores the document when it accompanies the
 * order POST. Must stay byte-identical to {@link APP_DATA_HASH}.
 */
export const APP_DATA_DOC = '{"appCode":"panoptic","metadata":{},"version":"1.3.0"}'

/** keccak256 of {@link APP_DATA_DOC} — the `appData` field signed in the order. */
export const APP_DATA_HASH = keccak256(stringToHex(APP_DATA_DOC))
