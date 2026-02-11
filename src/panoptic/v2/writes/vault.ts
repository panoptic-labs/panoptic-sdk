/**
 * ERC4626 vault operations for the Panoptic v2 SDK.
 * @module v2/writes/vault
 */

import type { Address, PublicClient, WalletClient } from 'viem'

import { collateralTrackerAbi } from '../../../generated'
import type { TxOverrides, TxReceipt, TxResult } from '../types'
import { submitWrite } from './utils'

/**
 * Parameters for deposit operation.
 */
export interface DepositParams {
  /** Public client */
  client: PublicClient
  /** Wallet client */
  walletClient: WalletClient
  /** Account address */
  account: Address
  /** CollateralTracker address */
  collateralTrackerAddress: Address
  /** Amount of assets to deposit */
  assets: bigint
  /** Receiver of shares (defaults to account) */
  receiver?: Address
  /** Gas and transaction overrides */
  txOverrides?: TxOverrides
}

/**
 * Deposit assets into a collateral tracker.
 *
 * @param params - Deposit parameters
 * @returns TxResult
 *
 * @example
 * ```typescript
 * const result = await deposit({
 *   client,
 *   walletClient,
 *   account,
 *   collateralTrackerAddress,
 *   assets: parseEther('1'),
 * })
 * const receipt = await result.wait()
 * ```
 */
export async function deposit(params: DepositParams): Promise<TxResult> {
  const {
    client,
    walletClient,
    account,
    collateralTrackerAddress,
    assets,
    receiver = account,
    txOverrides,
  } = params

  return submitWrite({
    client,
    walletClient,
    account,
    address: collateralTrackerAddress,
    abi: collateralTrackerAbi,
    functionName: 'deposit',
    args: [assets, receiver],
    txOverrides,
  })
}

/**
 * Deposit assets and wait for confirmation.
 */
export async function depositAndWait(params: DepositParams): Promise<TxReceipt> {
  const result = await deposit(params)
  return result.wait()
}

/**
 * Parameters for withdraw operation.
 */
export interface WithdrawParams {
  /** Public client */
  client: PublicClient
  /** Wallet client */
  walletClient: WalletClient
  /** Account address */
  account: Address
  /** CollateralTracker address */
  collateralTrackerAddress: Address
  /** Amount of assets to withdraw */
  assets: bigint
  /** Receiver of assets */
  receiver?: Address
  /** Owner of shares (defaults to account) */
  owner?: Address
  /** Gas and transaction overrides */
  txOverrides?: TxOverrides
}

/**
 * Withdraw assets from a collateral tracker.
 *
 * @param params - Withdraw parameters
 * @returns TxResult
 */
export async function withdraw(params: WithdrawParams): Promise<TxResult> {
  const {
    client,
    walletClient,
    account,
    collateralTrackerAddress,
    assets,
    receiver = account,
    owner = account,
    txOverrides,
  } = params

  return submitWrite({
    client,
    walletClient,
    account,
    address: collateralTrackerAddress,
    abi: collateralTrackerAbi,
    functionName: 'withdraw',
    args: [assets, receiver, owner],
    txOverrides,
  })
}

/**
 * Withdraw assets and wait for confirmation.
 */
export async function withdrawAndWait(params: WithdrawParams): Promise<TxReceipt> {
  const result = await withdraw(params)
  return result.wait()
}

/**
 * Parameters for withdraw with position list validation.
 */
export interface WithdrawWithPositionsParams extends WithdrawParams {
  /** Position ID list for collateral validation */
  positionIdList: bigint[]
  /** Whether to use premia as collateral */
  usePremiaAsCollateral: boolean
}

/**
 * Withdraw assets with position list validation.
 * This overload validates that the withdrawal won't make positions undercollateralized.
 *
 * @param params - Withdraw parameters with positions
 * @returns TxResult
 */
export async function withdrawWithPositions(
  params: WithdrawWithPositionsParams,
): Promise<TxResult> {
  const {
    client,
    walletClient,
    account,
    collateralTrackerAddress,
    assets,
    receiver = account,
    owner = account,
    positionIdList,
    usePremiaAsCollateral,
    txOverrides,
  } = params

  return submitWrite({
    client,
    walletClient,
    account,
    address: collateralTrackerAddress,
    abi: collateralTrackerAbi,
    functionName: 'withdraw',
    args: [assets, receiver, owner, positionIdList, usePremiaAsCollateral],
    txOverrides,
  })
}

/**
 * Withdraw with positions and wait for confirmation.
 */
export async function withdrawWithPositionsAndWait(
  params: WithdrawWithPositionsParams,
): Promise<TxReceipt> {
  const result = await withdrawWithPositions(params)
  return result.wait()
}

/**
 * Parameters for mint operation.
 */
export interface MintParams {
  /** Public client */
  client: PublicClient
  /** Wallet client */
  walletClient: WalletClient
  /** Account address */
  account: Address
  /** CollateralTracker address */
  collateralTrackerAddress: Address
  /** Amount of shares to mint */
  shares: bigint
  /** Receiver of shares */
  receiver?: Address
  /** Gas and transaction overrides */
  txOverrides?: TxOverrides
}

/**
 * Mint shares by depositing assets.
 *
 * @param params - Mint parameters
 * @returns TxResult
 */
export async function mint(params: MintParams): Promise<TxResult> {
  const {
    client,
    walletClient,
    account,
    collateralTrackerAddress,
    shares,
    receiver = account,
    txOverrides,
  } = params

  return submitWrite({
    client,
    walletClient,
    account,
    address: collateralTrackerAddress,
    abi: collateralTrackerAbi,
    functionName: 'mint',
    args: [shares, receiver],
    txOverrides,
  })
}

/**
 * Mint shares and wait for confirmation.
 */
export async function mintAndWait(params: MintParams): Promise<TxReceipt> {
  const result = await mint(params)
  return result.wait()
}

/**
 * Parameters for redeem operation.
 */
export interface RedeemParams {
  /** Public client */
  client: PublicClient
  /** Wallet client */
  walletClient: WalletClient
  /** Account address */
  account: Address
  /** CollateralTracker address */
  collateralTrackerAddress: Address
  /** Amount of shares to redeem */
  shares: bigint
  /** Receiver of assets */
  receiver?: Address
  /** Owner of shares */
  owner?: Address
  /** Gas and transaction overrides */
  txOverrides?: TxOverrides
}

/**
 * Redeem shares for assets.
 *
 * @param params - Redeem parameters
 * @returns TxResult
 */
export async function redeem(params: RedeemParams): Promise<TxResult> {
  const {
    client,
    walletClient,
    account,
    collateralTrackerAddress,
    shares,
    receiver = account,
    owner = account,
    txOverrides,
  } = params

  return submitWrite({
    client,
    walletClient,
    account,
    address: collateralTrackerAddress,
    abi: collateralTrackerAbi,
    functionName: 'redeem',
    args: [shares, receiver, owner],
    txOverrides,
  })
}

/**
 * Redeem shares and wait for confirmation.
 */
export async function redeemAndWait(params: RedeemParams): Promise<TxReceipt> {
  const result = await redeem(params)
  return result.wait()
}
