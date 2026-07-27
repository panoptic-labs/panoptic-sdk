/**
 * Swap functions for the Panoptic v2 SDK.
 *
 * Implements token swaps via Panoptic's **credit** mechanism: open a width=0
 * credit leg and immediately close it in the same dispatch, with `swapAtMint`
 * on exactly one of the two ops.
 *
 * Credits rather than loans because a credit pays into the pool instead of
 * borrowing from it: it requires zero buying power, never touches
 * `s_assetsInAMM`, and so can never be capped by a collateral tracker's
 * utilization or available-to-borrow. A loan-based swap against a
 * fully-utilized tracker simply fails.
 *
 * @module v2/writes/swap
 */

import type { Address, PublicClient, WalletClient } from 'viem'

import { panopticPoolV2Abi } from '../../../generated'
import { MaxRetriesExceededError } from '../errors'
import { tickLimits } from '../formatters/tick'
import { getPool } from '../reads/pool'
import type { StorageAdapter } from '../storage'
import type { TxOverrides, TxReceipt, TxResult } from '../types'
import {
  buildUniqueCredit,
  isInputListFailError,
  MAX_RETRIES,
  resolvePositionIds,
  resolveTokenIndex,
} from './loanUtils'
import { submitWrite } from './utils'

/**
 * Parameters for swapExactOut.
 */
export interface SwapExactOutParams {
  /** Public client */
  client: PublicClient
  /** Wallet client */
  walletClient: WalletClient
  /** Account address */
  account: Address
  /** PanopticPool address */
  poolAddress: Address
  /** Chain ID (required for pool data fetch) */
  chainId: bigint
  /** Token address you want to receive */
  tokenOut: Address
  /** Exact amount of tokenOut to receive */
  amountOut: bigint
  /** Slippage tolerance in bps (e.g. 500n = 5%) */
  slippageBps: bigint
  /** Existing position IDs. If omitted, resolved from storage. */
  existingPositionIds?: bigint[]
  /** Storage adapter for position ID resolution */
  storage?: StorageAdapter
  /** Builder code for referral fee attribution. Defaults to `0n`. */
  builderCode?: bigint
  /** Gas and transaction overrides */
  txOverrides?: TxOverrides
}

/**
 * Parameters for swapExactIn.
 */
export interface SwapExactInParams {
  /** Public client */
  client: PublicClient
  /** Wallet client */
  walletClient: WalletClient
  /** Account address */
  account: Address
  /** PanopticPool address */
  poolAddress: Address
  /** Chain ID (required for pool data fetch) */
  chainId: bigint
  /** Token address you want to sell */
  tokenIn: Address
  /** Exact amount of tokenIn to spend */
  amountIn: bigint
  /** Slippage tolerance in bps (e.g. 500n = 5%) */
  slippageBps: bigint
  /** Existing position IDs. If omitted, resolved from storage. */
  existingPositionIds?: bigint[]
  /** Storage adapter for position ID resolution */
  storage?: StorageAdapter
  /** Builder code for referral fee attribution. Defaults to `0n`. */
  builderCode?: bigint
  /** Gas and transaction overrides */
  txOverrides?: TxOverrides
}

/**
 * Swap tokens using Panoptic's exact-output mechanism.
 *
 * Opens a credit in `tokenOut` with `swapAtMint=true` (paying a swapped amount of
 * the other token), then burns it with `swapAtMint=false` to receive exactly
 * `amountOut` of `tokenOut`.
 *
 * @param params - Swap parameters
 * @returns TxResult
 *
 * @example
 * ```typescript
 * const result = await swapExactOut({
 *   client, walletClient, account, poolAddress,
 *   chainId: 11155111n,
 *   tokenOut: WETH_ADDRESS,
 *   amountOut: 5n * 10n**16n,  // 0.05 WETH
 *   slippageBps: 500n,         // 5% slippage
 * })
 * const receipt = await result.wait()
 * ```
 */
export async function swapExactOut(params: SwapExactOutParams): Promise<TxResult> {
  const {
    client,
    walletClient,
    account,
    poolAddress,
    chainId,
    tokenOut,
    amountOut,
    slippageBps,
    existingPositionIds: explicitIds,
    storage,
    builderCode = 0n,
    txOverrides,
  } = params

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // Re-fetch pool + positions on each attempt for freshness
    const [pool, positionIds] = await Promise.all([
      getPool({ client, poolAddress, chainId }),
      resolvePositionIds(explicitIds, storage, chainId, poolAddress, account),
    ])

    const token0 = pool.collateralTracker0.token
    const token1 = pool.collateralTracker1.token
    const tokenOutIndex = resolveTokenIndex(tokenOut, token0, token1)

    // The credit is denominated in the EXACT token — tokenOut here, mirroring
    // swapExactIn's tokenIn. asset === tokenType.
    //
    // Do NOT set tokenType to the other token. That is correct for a *loan*
    // (which borrows the counter-token and swaps it in), and carrying it over to
    // the credit inverts the whole swap: an exact-out for 4 ETH then PAYS 4 ETH
    // and receives USDC. Verified on mainnet before/after.
    const tokenType = tokenOutIndex

    const { low: tickLimitLow, high: tickLimitHigh } = tickLimits(pool.currentTick, slippageBps)

    // asset = tokenOutIndex so positionSize is denominated in tokenOut units
    const { tokenId: creditTokenId, adjustedSize } = buildUniqueCredit(
      pool.poolId,
      tokenOutIndex,
      tokenType,
      pool.currentTick,
      pool.tickSpacing,
      positionIds,
      amountOut,
    )

    // Op 1 (mint): credit with swapAtMint=true → pay a swapped amount of tokenIn
    // swapAtMint=true → descending tick limits: [high, low, spread]
    const mintTickLimits: readonly [number, number, number] = [
      Number(tickLimitHigh),
      Number(tickLimitLow),
      0,
    ]

    // Op 2 (burn): same credit with swapAtMint=false → receive exactly amountOut
    // swapAtMint=false → ascending tick limits: [low, high, spread]
    const burnTickLimits: readonly [number, number, number] = [
      Number(tickLimitLow),
      Number(tickLimitHigh),
      0,
    ]

    // positionIdList: [mint tokenId, burn tokenId]
    // finalPositionIdList: existing positions (credit opens and closes in same tx, net zero)
    // positionSizes: mint gets the size, burn gets 0n (= burn all)
    const positionIdList = [creditTokenId, creditTokenId]
    const finalPositionIdList = [...positionIds]
    const positionSizes = [adjustedSize, 0n]

    try {
      return await submitWrite({
        client,
        walletClient,
        account,
        address: poolAddress,
        abi: panopticPoolV2Abi,
        functionName: 'dispatch',
        args: [
          positionIdList,
          finalPositionIdList,
          positionSizes,
          [mintTickLimits, burnTickLimits],
          false, // usePremiaAsCollateral
          builderCode,
        ],
        txOverrides,
      })
    } catch (error) {
      if (isInputListFailError(error) && attempt < MAX_RETRIES - 1) {
        continue
      }
      throw error
    }
  }

  throw new MaxRetriesExceededError('swapExactOut')
}

/**
 * Swap exact output and wait for confirmation.
 */
export async function swapExactOutAndWait(params: SwapExactOutParams): Promise<TxReceipt> {
  const result = await swapExactOut(params)
  return result.wait()
}

/**
 * Swap tokens using Panoptic's exact-input mechanism.
 *
 * Opens a credit in `tokenIn` with `swapAtMint=false` (paying exactly `amountIn`),
 * then burns it with `swapAtMint=true` to receive the swapped amount of the other
 * token. The user spends exactly `amountIn` of `tokenIn`.
 *
 * @param params - Swap parameters
 * @returns TxResult
 *
 * @example
 * ```typescript
 * const result = await swapExactIn({
 *   client, walletClient, account, poolAddress,
 *   chainId: 11155111n,
 *   tokenIn: USDC_ADDRESS,
 *   amountIn: 1000n * 10n**6n,  // 1000 USDC
 *   slippageBps: 500n,
 * })
 * const receipt = await result.wait()
 * ```
 */
export async function swapExactIn(params: SwapExactInParams): Promise<TxResult> {
  const {
    client,
    walletClient,
    account,
    poolAddress,
    chainId,
    tokenIn,
    amountIn,
    slippageBps,
    existingPositionIds: explicitIds,
    storage,
    builderCode = 0n,
    txOverrides,
  } = params

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const [pool, positionIds] = await Promise.all([
      getPool({ client, poolAddress, chainId }),
      resolvePositionIds(explicitIds, storage, chainId, poolAddress, account),
    ])

    const token0 = pool.collateralTracker0.token
    const token1 = pool.collateralTracker1.token
    const tokenInIndex = resolveTokenIndex(tokenIn, token0, token1)

    // For exact input: the credit is denominated in tokenIn and paid in tokenIn
    const tokenType = tokenInIndex

    const { low: tickLimitLow, high: tickLimitHigh } = tickLimits(pool.currentTick, slippageBps)

    // asset = tokenInIndex so positionSize is denominated in tokenIn units
    const { tokenId: creditTokenId, adjustedSize } = buildUniqueCredit(
      pool.poolId,
      tokenInIndex,
      tokenType,
      pool.currentTick,
      pool.tickSpacing,
      positionIds,
      amountIn,
    )

    // Op 1 (mint): credit with swapAtMint=false → pay exactly amountIn of tokenIn
    // swapAtMint=false → ascending tick limits: [low, high, spread]
    const mintTickLimits: readonly [number, number, number] = [
      Number(tickLimitLow),
      Number(tickLimitHigh),
      0,
    ]

    // Op 2 (burn): same credit with swapAtMint=true → receive the swapped tokenOut
    // swapAtMint=true → descending tick limits: [high, low, spread]
    const burnTickLimits: readonly [number, number, number] = [
      Number(tickLimitHigh),
      Number(tickLimitLow),
      0,
    ]

    // positionSizes: mint gets the size, burn gets 0n (= burn all)
    const positionIdList = [creditTokenId, creditTokenId]
    const finalPositionIdList = [...positionIds]
    const positionSizes = [adjustedSize, 0n]

    try {
      return await submitWrite({
        client,
        walletClient,
        account,
        address: poolAddress,
        abi: panopticPoolV2Abi,
        functionName: 'dispatch',
        args: [
          positionIdList,
          finalPositionIdList,
          positionSizes,
          [mintTickLimits, burnTickLimits],
          false,
          builderCode,
        ],
        txOverrides,
      })
    } catch (error) {
      if (isInputListFailError(error) && attempt < MAX_RETRIES - 1) {
        continue
      }
      throw error
    }
  }

  throw new MaxRetriesExceededError('swapExactIn')
}

/**
 * Swap exact input and wait for confirmation.
 */
export async function swapExactInAndWait(params: SwapExactInParams): Promise<TxReceipt> {
  const result = await swapExactIn(params)
  return result.wait()
}
