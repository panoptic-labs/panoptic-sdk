/**
 * Approval functions for the Panoptic v2 SDK.
 * @module v2/writes/approve
 */

import type { Address, PublicClient, WalletClient } from 'viem'
import { erc20Abi } from 'viem'

import { collateralTrackerAbi, panopticPoolAbi } from '../../../generated'
import type { TxOverrides, TxReceipt, TxResult } from '../types'
import { submitWrite } from './utils'

/**
 * Parameters for approve function.
 */
export interface ApproveParams {
  /** Public client for reading state */
  client: PublicClient
  /** Wallet client for signing transactions */
  walletClient: WalletClient
  /** Account address */
  account: Address
  /** Token address to approve */
  tokenAddress: Address
  /** Spender address (collateral tracker) */
  spenderAddress: Address
  /** Amount to approve (use MaxUint256 for unlimited) */
  amount: bigint
  /** Gas and transaction overrides */
  txOverrides?: TxOverrides
}

/**
 * Approve token spending for a collateral tracker.
 *
 * @param params - The approval parameters
 * @returns TxResult with hash and wait function
 *
 * @example
 * ```typescript
 * const result = await approve({
 *   client,
 *   walletClient,
 *   account,
 *   tokenAddress: WETH,
 *   spenderAddress: collateralToken0,
 *   amount: MaxUint256,
 * })
 * const receipt = await result.wait()
 * ```
 */
export async function approve(params: ApproveParams): Promise<TxResult> {
  const { client, walletClient, account, tokenAddress, spenderAddress, amount, txOverrides } =
    params

  return submitWrite({
    client,
    walletClient,
    account,
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'approve',
    args: [spenderAddress, amount],
    txOverrides,
  })
}

/**
 * Approve token spending and wait for confirmation.
 *
 * @param params - The approval parameters
 * @returns TxReceipt after confirmation
 */
export async function approveAndWait(params: ApproveParams): Promise<TxReceipt> {
  const result = await approve(params)
  return result.wait()
}

/**
 * Parameters for approving both tokens for a pool.
 */
export interface ApprovePoolParams {
  /** Public client for reading state */
  client: PublicClient
  /** Wallet client for signing transactions */
  walletClient: WalletClient
  /** Account address */
  account: Address
  /** PanopticPool address */
  poolAddress: Address
  /** Amount to approve for token 0 */
  amount0: bigint
  /** Amount to approve for token 1 */
  amount1: bigint
}

/**
 * Approve both tokens for a Panoptic pool.
 * Fetches collateral tracker addresses and underlying tokens, then approves both.
 *
 * @param params - The approval parameters
 * @returns Array of two TxResults
 *
 * @example
 * ```typescript
 * const [result0, result1] = await approvePool({
 *   client,
 *   walletClient,
 *   account,
 *   poolAddress,
 *   amount0: MaxUint256,
 *   amount1: MaxUint256,
 * })
 * await Promise.all([result0.wait(), result1.wait()])
 * ```
 */
export async function approvePool(params: ApprovePoolParams): Promise<[TxResult, TxResult]> {
  const { client, walletClient, account, poolAddress, amount0, amount1 } = params

  // Get collateral tracker addresses
  const [collateralToken0, collateralToken1] = await client.multicall({
    contracts: [
      {
        address: poolAddress,
        abi: panopticPoolAbi,
        functionName: 'collateralToken0',
      },
      {
        address: poolAddress,
        abi: panopticPoolAbi,
        functionName: 'collateralToken1',
      },
    ],
    allowFailure: false,
  })

  // Get underlying token addresses
  const [token0, token1] = await client.multicall({
    contracts: [
      {
        address: collateralToken0,
        abi: collateralTrackerAbi,
        functionName: 'asset',
      },
      {
        address: collateralToken1,
        abi: collateralTrackerAbi,
        functionName: 'asset',
      },
    ],
    allowFailure: false,
  })

  // Approve both tokens in parallel
  const [result0, result1] = await Promise.all([
    approve({
      client,
      walletClient,
      account,
      tokenAddress: token0,
      spenderAddress: collateralToken0,
      amount: amount0,
    }),
    approve({
      client,
      walletClient,
      account,
      tokenAddress: token1,
      spenderAddress: collateralToken1,
      amount: amount1,
    }),
  ])

  return [result0, result1]
}

/**
 * Check if an approval is needed for a given amount.
 *
 * @param params - Parameters for checking approval
 * @returns Object with needsApproval flag and current allowance
 */
export interface CheckApprovalParams {
  /** Public client */
  client: PublicClient
  /** Token address */
  tokenAddress: Address
  /** Owner address */
  owner: Address
  /** Spender address */
  spender: Address
  /** Amount to check against */
  amount: bigint
}

export interface ApprovalStatus {
  /** Whether approval is needed */
  needsApproval: boolean
  /** Current allowance */
  currentAllowance: bigint
  /** Amount that would be approved */
  requiredAmount: bigint
}

/**
 * Check if approval is needed for a token transfer.
 *
 * @param params - The check parameters
 * @returns Approval status
 */
export async function checkApproval(params: CheckApprovalParams): Promise<ApprovalStatus> {
  const { client, tokenAddress, owner, spender, amount } = params

  const currentAllowance = await client.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [owner, spender],
  })

  return {
    needsApproval: currentAllowance < amount,
    currentAllowance,
    requiredAmount: amount,
  }
}
