/**
 * Wrap / unwrap operations for Backed xStock ERC4626 wrappers.
 *
 * xStocks are rebasing and can't be used in Panoptic/Uniswap pools directly;
 * those trade the non-rebasing **wrapper** (a standard ERC4626 vault whose
 * `asset()` is the underlying xStock). Wrapping is an ERC4626 `deposit`,
 * unwrapping an ERC4626 `redeem`. CoW Swap trades the unwrapped token, so a
 * user who buys an xStock on CoW must wrap it before lending it or selling it
 * through the Uniswap venue.
 *
 * Resolve a token's wrapper with `getXstockWrapper` from `@panoptic-eng/sdk`.
 *
 * @module v2/writes/wrap
 */

import type { Address, PublicClient, WalletClient } from 'viem'

import type { TxOverrides, TxReceipt, TxResult } from '../types'
import { submitWrite } from './utils'

/** Minimal ERC4626 surface used by the xStock wrappers. */
export const xstockWrapperAbi = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'redeem',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'shares', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'owner', type: 'address' },
    ],
    outputs: [{ name: 'assets', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'asset',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'previewDeposit',
    stateMutability: 'view',
    inputs: [{ name: 'assets', type: 'uint256' }],
    outputs: [{ name: 'shares', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'previewRedeem',
    stateMutability: 'view',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [{ name: 'assets', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'maxRedeem',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: 'maxShares', type: 'uint256' }],
  },
] as const

/** Parameters for {@link wrapXstock}. */
export interface WrapXstockParams {
  /** Public client */
  client: PublicClient
  /** Wallet client */
  walletClient: WalletClient
  /** Account address */
  account: Address
  /** Wrapper (ERC4626) address — resolve via `getXstockWrapper`. */
  wrapper: Address
  /** Amount of the underlying xStock to wrap. */
  assets: bigint
  /** Receiver of the wrapper shares (defaults to account). */
  receiver?: Address
  /** Gas and transaction overrides */
  txOverrides?: TxOverrides
}

/**
 * Wrap an underlying xStock into its ERC4626 wrapper (`deposit`). Requires a
 * prior ERC20 approval of the underlying to the wrapper address.
 *
 * @returns TxResult with hash and wait function
 */
export async function wrapXstock(params: WrapXstockParams): Promise<TxResult> {
  const { client, walletClient, account, wrapper, assets, receiver = account, txOverrides } = params
  return submitWrite({
    client,
    walletClient,
    account,
    address: wrapper,
    abi: xstockWrapperAbi,
    functionName: 'deposit',
    args: [assets, receiver],
    txOverrides,
  })
}

/** Wrap and wait for confirmation. */
export async function wrapXstockAndWait(params: WrapXstockParams): Promise<TxReceipt> {
  const result = await wrapXstock(params)
  return result.wait()
}

/** Parameters for {@link unwrapXstock}. */
export interface UnwrapXstockParams {
  /** Public client */
  client: PublicClient
  /** Wallet client */
  walletClient: WalletClient
  /** Account address */
  account: Address
  /** Wrapper (ERC4626) address — resolve via `getXstockUnderlying`. */
  wrapper: Address
  /** Amount of wrapper shares to unwrap (redeem). */
  shares: bigint
  /** Receiver of the underlying xStock (defaults to account). */
  receiver?: Address
  /** Owner of the shares (defaults to account). */
  owner?: Address
  /** Gas and transaction overrides */
  txOverrides?: TxOverrides
}

/**
 * Unwrap wrapper shares back into the underlying xStock (`redeem`). When
 * `owner` defaults to (or equals) `account` the caller burns their own shares
 * and no approval is needed. Passing a different `owner` redeems on its behalf
 * and requires that owner to have granted the caller an ERC-4626 share
 * allowance (`approve`), or the `redeem` call reverts.
 *
 * @returns TxResult with hash and wait function
 */
export async function unwrapXstock(params: UnwrapXstockParams): Promise<TxResult> {
  const {
    client,
    walletClient,
    account,
    wrapper,
    shares,
    receiver = account,
    owner = account,
    txOverrides,
  } = params
  return submitWrite({
    client,
    walletClient,
    account,
    address: wrapper,
    abi: xstockWrapperAbi,
    functionName: 'redeem',
    args: [shares, receiver, owner],
    txOverrides,
  })
}

/** Unwrap and wait for confirmation. */
export async function unwrapXstockAndWait(params: UnwrapXstockParams): Promise<TxReceipt> {
  const result = await unwrapXstock(params)
  return result.wait()
}

/** Parameters for the wrap/unwrap amount previews. */
export interface PreviewWrapParams {
  /** Public client */
  client: PublicClient
  /** Wrapper (ERC4626) address. */
  wrapper: Address
  /** Amount to convert: underlying assets for wrap, shares for unwrap. */
  amount: bigint
}

/**
 * Preview the wrapper shares minted for a given amount of underlying xStock.
 */
export async function previewWrap(params: PreviewWrapParams): Promise<bigint> {
  const { client, wrapper, amount } = params
  return client.readContract({
    address: wrapper,
    abi: xstockWrapperAbi,
    functionName: 'previewDeposit',
    args: [amount],
  })
}

/**
 * Preview the underlying xStock returned for a given amount of wrapper shares.
 */
export async function previewUnwrap(params: PreviewWrapParams): Promise<bigint> {
  const { client, wrapper, amount } = params
  return client.readContract({
    address: wrapper,
    abi: xstockWrapperAbi,
    functionName: 'previewRedeem',
    args: [amount],
  })
}

/**
 * Minimal canonical WETH9 surface used for ETH<->WETH wrapping. Unlike the
 * ERC4626 xStock wrapper, WETH is a 1:1 wrapper: `deposit` is payable and wraps
 * `msg.value`, `withdraw` unwraps an exact amount back to native ETH.
 */
export const wethWrapAbi = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'payable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'wad', type: 'uint256' }],
    outputs: [],
  },
] as const

/** Parameters for {@link wrapEth}. */
export interface WrapEthParams {
  /** Public client */
  client: PublicClient
  /** Wallet client */
  walletClient: WalletClient
  /** Account address */
  account: Address
  /** Canonical WETH9 address for the chain. */
  weth: Address
  /** Amount of native ETH to wrap (sent as msg.value). */
  amount: bigint
  /** Gas and transaction overrides */
  txOverrides?: TxOverrides
}

/**
 * Wrap native ETH into WETH (`deposit` payable). No approval needed.
 *
 * @returns TxResult with hash and wait function
 */
export async function wrapEth(params: WrapEthParams): Promise<TxResult> {
  const { client, walletClient, account, weth, amount, txOverrides } = params
  return submitWrite({
    client,
    walletClient,
    account,
    address: weth,
    abi: wethWrapAbi,
    functionName: 'deposit',
    args: [],
    value: amount,
    txOverrides,
  })
}

/** Wrap ETH and wait for confirmation. */
export async function wrapEthAndWait(params: WrapEthParams): Promise<TxReceipt> {
  const result = await wrapEth(params)
  return result.wait()
}

/** Parameters for {@link unwrapWeth}. */
export interface UnwrapWethParams {
  /** Public client */
  client: PublicClient
  /** Wallet client */
  walletClient: WalletClient
  /** Account address */
  account: Address
  /** Canonical WETH9 address for the chain. */
  weth: Address
  /** Amount of WETH to unwrap back to native ETH. */
  amount: bigint
  /** Gas and transaction overrides */
  txOverrides?: TxOverrides
}

/**
 * Unwrap WETH back into native ETH (`withdraw`). Burns the caller's own WETH —
 * no approval needed.
 *
 * @returns TxResult with hash and wait function
 */
export async function unwrapWeth(params: UnwrapWethParams): Promise<TxResult> {
  const { client, walletClient, account, weth, amount, txOverrides } = params
  return submitWrite({
    client,
    walletClient,
    account,
    address: weth,
    abi: wethWrapAbi,
    functionName: 'withdraw',
    args: [amount],
    txOverrides,
  })
}

/** Unwrap WETH and wait for confirmation. */
export async function unwrapWethAndWait(params: UnwrapWethParams): Promise<TxReceipt> {
  const result = await unwrapWeth(params)
  return result.wait()
}
