/**
 * Lending API for the Panoptic v2 SDK.
 *
 * Provides Aave/Compound-style supply/borrow/repay/unsupply functions
 * that wrap the lower-level vault and position primitives.
 *
 * @module v2/writes/lending
 */

import type { Address, PublicClient, WalletClient } from 'viem'

import { panopticPoolV2Abi } from '../../../generated'
import { MaxRetriesExceededError, NoLoanPositionsError } from '../errors'
import { tickLimits } from '../formatters/tick'
import { getPool } from '../reads/pool'
import { simulateOpenPosition } from '../simulations/simulateOpenPosition'
import type { StorageAdapter } from '../storage'
import { getPositionsKey, jsonSerializer } from '../storage'
import { getTrackedPositionIds } from '../sync/getTrackedPositionIds'
import { isLoan } from '../tokenId/decode'
import { decodeAllLegs } from '../tokenId/encoding'
import type {
  OpenPositionSimulation,
  SimulationResult,
  TxOverrides,
  TxReceipt,
  TxResult,
} from '../types'
import {
  buildUniqueLoan,
  isInputListFailError,
  MAX_RETRIES,
  resolvePositionIds,
  resolveTokenIndex,
} from './loanUtils'
import { submitWrite } from './utils'
import { deposit, withdraw } from './vault'

// ---------------------------------------------------------------------------
// Parameter types
// ---------------------------------------------------------------------------

/** Parameters for supplying collateral into a pool. */
export interface SupplyParams {
  /** Public client */
  client: PublicClient
  /** Wallet client */
  walletClient: WalletClient
  /** Account address */
  account: Address
  /** PanopticPool address */
  poolAddress: Address
  /** Chain ID */
  chainId: bigint
  /** Token address to supply (must be token0 or token1 of the pool) */
  token: Address
  /** Amount of token to supply */
  amount: bigint
  /** Whether the token is native ETH (requires sending msg.value) */
  isNativeETH?: boolean
  /** Gas and transaction overrides */
  txOverrides?: TxOverrides
}

/** Parameters for withdrawing (unsupplying) collateral from a pool. */
export interface UnsupplyParams {
  /** Public client */
  client: PublicClient
  /** Wallet client */
  walletClient: WalletClient
  /** Account address */
  account: Address
  /** PanopticPool address */
  poolAddress: Address
  /** Chain ID */
  chainId: bigint
  /** Token address to withdraw (must be token0 or token1 of the pool) */
  token: Address
  /** Amount of token to withdraw */
  amount: bigint
  /** Gas and transaction overrides */
  txOverrides?: TxOverrides
}

/** Parameters for borrowing tokens via a loan position. */
export interface BorrowParams {
  /** Public client */
  client: PublicClient
  /** Wallet client */
  walletClient: WalletClient
  /** Account address */
  account: Address
  /** PanopticPool address */
  poolAddress: Address
  /** Chain ID */
  chainId: bigint
  /** Token address to borrow (must be token0 or token1 of the pool) */
  token: Address
  /** Amount of token to borrow */
  amount: bigint
  /** Slippage tolerance in bps (e.g. 500n = 5%) */
  slippageBps: bigint
  /** Existing position IDs. If omitted, resolved from storage. */
  existingPositionIds?: bigint[]
  /** Storage adapter for position ID resolution and tracking */
  storage?: StorageAdapter
  /** Builder code for fee routing (0 = no builder). */
  builderCode?: bigint
  /** Gas and transaction overrides */
  txOverrides?: TxOverrides
}

/** Parameters for repaying a loan (full or partial). */
export interface RepayParams {
  /** Public client */
  client: PublicClient
  /** Wallet client */
  walletClient: WalletClient
  /** Account address */
  account: Address
  /** PanopticPool address */
  poolAddress: Address
  /** Chain ID */
  chainId: bigint
  /** TokenId of the loan position to repay */
  loanTokenId: bigint
  /** Amount to repay. If >= current position size, does full repay. */
  amount: bigint
  /** Slippage tolerance in bps (e.g. 500n = 5%) */
  slippageBps: bigint
  /** Current position IDs. If omitted, resolved from storage. */
  existingPositionIds?: bigint[]
  /** Storage adapter for position ID resolution and tracking */
  storage?: StorageAdapter
  /** Builder code for fee routing (0 = no builder). */
  builderCode?: bigint
  /** Gas and transaction overrides */
  txOverrides?: TxOverrides
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve collateral tracker address for a given token in the pool.
 */
async function resolveCollateralTracker(
  client: PublicClient,
  poolAddress: Address,
  chainId: bigint,
  token: Address,
): Promise<Address> {
  const pool = await getPool({ client, poolAddress, chainId })
  const tokenIndex = resolveTokenIndex(
    token,
    pool.collateralTracker0.token,
    pool.collateralTracker1.token,
  )
  return tokenIndex === 0n ? pool.collateralTracker0.address : pool.collateralTracker1.address
}

/**
 * Save a position ID list to storage.
 */
async function savePositionIds(
  storage: StorageAdapter,
  chainId: bigint,
  poolAddress: Address,
  account: Address,
  positionIds: bigint[],
): Promise<void> {
  const key = getPositionsKey(chainId, poolAddress, account)
  await storage.set(key, jsonSerializer.stringify(positionIds))
}

// ---------------------------------------------------------------------------
// supply / unsupply
// ---------------------------------------------------------------------------

/**
 * Supply collateral into a pool.
 *
 * Resolves the correct collateral tracker from the token address,
 * then delegates to the low-level `deposit()`.
 *
 * @param params - Supply parameters
 * @returns TxResult
 *
 * @example
 * ```typescript
 * const result = await supply({
 *   client, walletClient, account, poolAddress,
 *   chainId: 11155111n,
 *   token: WETH_ADDRESS,
 *   amount: 1n * 10n**18n,
 * })
 * const receipt = await result.wait()
 * ```
 */
export async function supply(params: SupplyParams): Promise<TxResult> {
  const {
    client,
    walletClient,
    account,
    poolAddress,
    chainId,
    token,
    amount,
    isNativeETH,
    txOverrides,
  } = params
  const collateralTrackerAddress = await resolveCollateralTracker(
    client,
    poolAddress,
    chainId,
    token,
  )
  return deposit({
    client,
    walletClient,
    account,
    collateralTrackerAddress,
    assets: amount,
    isNativeETH,
    txOverrides,
  })
}

/**
 * Supply collateral and wait for confirmation.
 */
export async function supplyAndWait(params: SupplyParams): Promise<TxReceipt> {
  const result = await supply(params)
  return result.wait()
}

/**
 * Withdraw (unsupply) collateral from a pool.
 *
 * Resolves the correct collateral tracker from the token address,
 * then delegates to the low-level `withdraw()`.
 *
 * @param params - Unsupply parameters
 * @returns TxResult
 */
export async function unsupply(params: UnsupplyParams): Promise<TxResult> {
  const { client, walletClient, account, poolAddress, chainId, token, amount, txOverrides } = params
  const collateralTrackerAddress = await resolveCollateralTracker(
    client,
    poolAddress,
    chainId,
    token,
  )
  return withdraw({
    client,
    walletClient,
    account,
    collateralTrackerAddress,
    assets: amount,
    txOverrides,
  })
}

/**
 * Withdraw collateral and wait for confirmation.
 */
export async function unsupplyAndWait(params: UnsupplyParams): Promise<TxReceipt> {
  const result = await unsupply(params)
  return result.wait()
}

// ---------------------------------------------------------------------------
// borrow
// ---------------------------------------------------------------------------

/**
 * Borrow tokens from a pool via a loan position.
 *
 * Creates a loan tokenId and mints it via dispatch. The loan borrows the
 * specified token without swapping (ascending tick limits = no swap).
 *
 * @param params - Borrow parameters
 * @returns TxResult
 *
 * @example
 * ```typescript
 * const result = await borrow({
 *   client, walletClient, account, poolAddress,
 *   chainId: 11155111n,
 *   token: USDC_ADDRESS,
 *   amount: 100n * 10n**6n,
 *   slippageBps: 500n,
 * })
 * const receipt = await result.wait()
 * ```
 */
export async function borrow(params: BorrowParams): Promise<TxResult & { loanTokenId: bigint }> {
  const {
    client,
    walletClient,
    account,
    poolAddress,
    chainId,
    token,
    amount,
    slippageBps,
    existingPositionIds: explicitIds,
    builderCode = 0n,
    storage,
    txOverrides,
  } = params

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const [pool, positionIds] = await Promise.all([
      getPool({ client, poolAddress, chainId }),
      resolvePositionIds(explicitIds, storage, chainId, poolAddress, account),
    ])

    const token0 = pool.collateralTracker0.token
    const token1 = pool.collateralTracker1.token
    const tokenIndex = resolveTokenIndex(token, token0, token1)

    // For a loan: both asset and tokenType = the borrowed token index
    const { tokenId: loanTokenId, adjustedSize } = buildUniqueLoan(
      pool.poolId,
      tokenIndex,
      tokenIndex,
      pool.currentTick,
      pool.tickSpacing,
      positionIds,
      amount,
    )

    const { low: tickLimitLow, high: tickLimitHigh } = tickLimits(pool.currentTick, slippageBps)

    // Ascending tick limits = no swap at mint
    const mintTickLimits: readonly [number, number, number] = [
      Number(tickLimitLow),
      Number(tickLimitHigh),
      0,
    ]

    const positionIdList = [loanTokenId]
    const finalPositionIdList = [...positionIds, loanTokenId]
    const positionSizes = [adjustedSize]

    try {
      const txResult = await submitWrite({
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
          [mintTickLimits],
          false,
          builderCode,
        ],
        txOverrides,
      })
      return { ...txResult, loanTokenId }
    } catch (error) {
      if (isInputListFailError(error) && attempt < MAX_RETRIES - 1) {
        continue
      }
      throw error
    }
  }

  throw new MaxRetriesExceededError('borrow')
}

/**
 * Borrow tokens and wait for confirmation.
 * If storage is provided, auto-tracks the new loan position.
 */
export async function borrowAndWait(params: BorrowParams): Promise<TxReceipt> {
  const result = await borrow(params)
  const receipt = await result.wait()

  // Auto-update storage if provided
  if (params.storage && params.chainId !== undefined) {
    const { poolAddress, chainId, storage, account, existingPositionIds: explicitIds } = params

    const positionIds =
      explicitIds ?? (await getTrackedPositionIds({ chainId, poolAddress, account, storage }))

    await savePositionIds(storage, chainId, poolAddress, account, [
      ...positionIds,
      result.loanTokenId,
    ])
  }

  return receipt
}

// ---------------------------------------------------------------------------
// preview borrow
// ---------------------------------------------------------------------------

/** Parameters for previewing a borrow (read-only, no wallet required). */
export interface PreviewBorrowParams {
  /** Public client */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Account address */
  account: Address
  /** Chain ID */
  chainId: bigint
  /** Token address to borrow (must be token0 or token1 of the pool) */
  token: Address
  /** Amount of token to borrow */
  amount: bigint
  /** Slippage tolerance in bps (e.g. 500n = 5%) */
  slippageBps: bigint
  /** Existing position IDs */
  existingPositionIds: bigint[]
}

/** Result of a borrow preview. */
export interface PreviewBorrowResult {
  /** The loan tokenId that would be minted */
  loanTokenId: bigint
  /** Adjusted position size (after optionRatio scaling) */
  adjustedSize: bigint
  /** Simulation result from dry-run dispatch */
  simulation: SimulationResult<OpenPositionSimulation>
  /** Collateral requirement for the new loan position only (token0). Null if simulation failed. */
  collateralReqToken0: bigint | null
  /** Collateral requirement for the new loan position only (token1). Null if simulation failed. */
  collateralReqToken1: bigint | null
}

/**
 * Preview a borrow without executing it.
 *
 * Builds the loan tokenId (same logic as `borrow`) and runs a
 * dry-run `simulateOpenPosition` to check feasibility and return
 * post-mint collateral requirements.
 *
 * @param params - Preview parameters
 * @returns Preview result with tokenId, size, and simulation data
 */
export async function previewBorrow(params: PreviewBorrowParams): Promise<PreviewBorrowResult> {
  const { client, poolAddress, chainId, token, amount, slippageBps, account, existingPositionIds } =
    params

  const pool = await getPool({ client, poolAddress, chainId })

  const token0 = pool.collateralTracker0.token
  const token1 = pool.collateralTracker1.token
  const tokenIndex = resolveTokenIndex(token, token0, token1)

  const { tokenId: loanTokenId, adjustedSize } = buildUniqueLoan(
    pool.poolId,
    tokenIndex,
    tokenIndex,
    pool.currentTick,
    pool.tickSpacing,
    existingPositionIds,
    amount,
  )

  const { low: tickLimitLow, high: tickLimitHigh } = tickLimits(pool.currentTick, slippageBps)

  const simulation = await simulateOpenPosition({
    client,
    poolAddress,
    account,
    existingPositionIds,
    tokenId: loanTokenId,
    positionSize: adjustedSize,
    tickLimitLow: BigInt(tickLimitLow),
    tickLimitHigh: BigInt(tickLimitHigh),
    chainId,
  })

  // Extract the new loan's collateral requirement (last entry in perPositionCollateralReqs)
  let collateralReqToken0: bigint | null = null
  let collateralReqToken1: bigint | null = null
  if (simulation.success) {
    const reqs = simulation.data.perPositionCollateralReqs
    if (reqs.length > 0) {
      const loanReq = reqs[reqs.length - 1]
      collateralReqToken0 = loanReq.token0
      collateralReqToken1 = loanReq.token1
    }
  }

  return { loanTokenId, adjustedSize, simulation, collateralReqToken0, collateralReqToken1 }
}

// ---------------------------------------------------------------------------
// repay
// ---------------------------------------------------------------------------

/**
 * Repay a loan position (full or partial).
 *
 * - Full repay (`amount >= currentSize`): Burns the loan position entirely.
 * - Partial repay (`amount < currentSize`): Uses roll-same-tokenId pattern
 *   to reduce the position size.
 *
 * @param params - Repay parameters
 * @returns TxResult
 *
 * @example
 * ```typescript
 * // Full repay
 * await repay({
 *   client, walletClient, account, poolAddress,
 *   chainId: 11155111n,
 *   loanTokenId,
 *   amount: MAX_UINT128, // repay all
 *   slippageBps: 500n,
 * })
 *
 * // Partial repay
 * await repay({
 *   client, walletClient, account, poolAddress,
 *   chainId: 11155111n,
 *   loanTokenId,
 *   amount: 50n * 10n**6n, // repay 50 USDC
 *   slippageBps: 500n,
 * })
 * ```
 */
export async function repay(params: RepayParams): Promise<TxResult> {
  const {
    client,
    walletClient,
    account,
    poolAddress,
    chainId,
    loanTokenId,
    amount,
    slippageBps,
    existingPositionIds: explicitIds,
    builderCode = 0n,
    storage,
    txOverrides,
  } = params

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const [positionIds, fullDataResult] = await Promise.all([
      resolvePositionIds(explicitIds, storage, chainId, poolAddress, account),
      client.readContract({
        address: poolAddress,
        abi: panopticPoolV2Abi,
        functionName: 'getFullPositionsData',
        args: [account, false, [loanTokenId]],
      }),
    ])

    // Extract positionSize from the packed PositionBalance
    const balanceRaw = fullDataResult[2][0] // positionBalances[0]
    const currentSize = balanceRaw & ((1n << 128n) - 1n)

    const pool = await getPool({ client, poolAddress, chainId })
    const { low: tickLimitLow, high: tickLimitHigh } = tickLimits(pool.currentTick, slippageBps)

    // Ascending tick limits = no swap
    const ascendingLimits: readonly [number, number, number] = [
      Number(tickLimitLow),
      Number(tickLimitHigh),
      0,
    ]

    if (amount >= currentSize) {
      // Full repay: burn the entire position
      const finalPositionIdList = positionIds.filter((id) => id !== loanTokenId)

      try {
        return await submitWrite({
          client,
          walletClient,
          account,
          address: poolAddress,
          abi: panopticPoolV2Abi,
          functionName: 'dispatch',
          args: [
            [loanTokenId],
            finalPositionIdList,
            [0n], // 0n = burn all
            [ascendingLimits],
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
    } else {
      // Partial repay: roll-same-tokenId pattern
      // Op 1: burn current position at full size
      // Op 2: re-mint same tokenId at reduced size
      const newSize = currentSize - amount
      const finalPositionIdList = positionIds
        .filter((id) => id !== loanTokenId)
        .concat([loanTokenId])

      try {
        return await submitWrite({
          client,
          walletClient,
          account,
          address: poolAddress,
          abi: panopticPoolV2Abi,
          functionName: 'dispatch',
          args: [
            [loanTokenId, loanTokenId],
            finalPositionIdList,
            [currentSize, newSize],
            [ascendingLimits, ascendingLimits],
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
  }

  throw new MaxRetriesExceededError('repay')
}

/**
 * Repay a loan and wait for confirmation.
 * If storage is provided, auto-updates the tracked positions (removes on full repay).
 */
export async function repayAndWait(params: RepayParams): Promise<TxReceipt> {
  const result = await repay(params)
  const receipt = await result.wait()

  // Auto-update storage on full repay
  if (params.storage && params.chainId !== undefined) {
    const {
      client,
      account,
      poolAddress,
      chainId,
      loanTokenId,
      storage,
      existingPositionIds: explicitIds,
    } = params

    const fullDataResult = await client.readContract({
      address: poolAddress,
      abi: panopticPoolV2Abi,
      functionName: 'getFullPositionsData',
      args: [account, false, [loanTokenId]],
    })
    const balanceRaw = fullDataResult[2][0] // positionBalances[0]
    const currentSize = balanceRaw & ((1n << 128n) - 1n)

    // Only remove if the position was fully burned
    if (currentSize === 0n) {
      const positionIds =
        explicitIds ?? (await getTrackedPositionIds({ chainId, poolAddress, account, storage }))
      await savePositionIds(
        storage,
        chainId,
        poolAddress,
        account,
        positionIds.filter((id) => id !== loanTokenId),
      )
    }
  }

  return receipt
}

// ---------------------------------------------------------------------------
// smart repay
// ---------------------------------------------------------------------------

/** Parameters for smart repay (burns all loans for a token, optionally re-opens a smaller one). */
export interface SmartRepayParams {
  /** Public client */
  client: PublicClient
  /** Wallet client */
  walletClient: WalletClient
  /** Account address */
  account: Address
  /** PanopticPool address */
  poolAddress: Address
  /** Chain ID */
  chainId: bigint
  /** Token address to repay loans for (must be token0 or token1 of the pool) */
  token: Address
  /** Amount of token to repay */
  amount: bigint
  /** Slippage tolerance in bps (e.g. 500n = 5%) */
  slippageBps: bigint
  /** Existing position IDs (all positions, not just loans) */
  existingPositionIds: bigint[]
  /** Builder code for fee routing (0 = no builder). */
  builderCode?: bigint
  /** Gas and transaction overrides */
  txOverrides?: TxOverrides
  /** Optional storage adapter — when provided, smartRepayAndWait auto-updates tracked positions. */
  storage?: StorageAdapter
}

/**
 * Identify loan tokenIds for a specific token and return their sizes.
 */
async function getLoanPositionsForToken(
  client: PublicClient,
  poolAddress: Address,
  account: Address,
  existingPositionIds: bigint[],
  tokenIndex: bigint,
): Promise<{ tokenId: bigint; positionSize: bigint; optionRatio: bigint; tokenAmount: bigint }[]> {
  const loanIds = existingPositionIds.filter((id) => {
    if (!isLoan(id)) return false
    const legs = decodeAllLegs(id)
    return legs.length > 0 && legs[0].tokenType === tokenIndex
  })

  if (loanIds.length === 0) return []

  const fullData = await client.readContract({
    address: poolAddress,
    abi: panopticPoolV2Abi,
    functionName: 'getFullPositionsData',
    args: [account, false, loanIds],
  })

  const balances = fullData[2]
  return loanIds.map((tokenId, i) => {
    const positionSize = balances[i] & ((1n << 128n) - 1n)
    const legs = decodeAllLegs(tokenId)
    const optionRatio = legs[0].optionRatio
    // Actual token amount = positionSize * optionRatio
    const tokenAmount = positionSize * optionRatio
    return { tokenId, positionSize, optionRatio, tokenAmount }
  })
}

/**
 * Smart repay: burns all loan positions for a token and optionally re-opens a smaller one.
 *
 * Unlike `repay()` which targets a single loanTokenId, this function handles
 * multiple loans transparently. The user specifies a repay amount and the SDK:
 * 1. Finds all loan positions for the specified token
 * 2. Burns them all
 * 3. If repayAmount < totalDebt, opens a new loan for the remainder
 *
 * @param params - Smart repay parameters
 * @returns TxResult
 */
export async function smartRepay(params: SmartRepayParams): Promise<TxResult> {
  const {
    client,
    walletClient,
    account,
    poolAddress,
    chainId,
    token,
    amount,
    slippageBps,
    existingPositionIds,
    builderCode = 0n,
    txOverrides,
  } = params

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const pool = await getPool({ client, poolAddress, chainId })
    const tokenIndex = resolveTokenIndex(
      token,
      pool.collateralTracker0.token,
      pool.collateralTracker1.token,
    )

    const loans = await getLoanPositionsForToken(
      client,
      poolAddress,
      account,
      existingPositionIds,
      tokenIndex,
    )
    if (loans.length === 0) {
      throw new NoLoanPositionsError(token)
    }

    const totalDebt = loans.reduce((sum, l) => sum + l.tokenAmount, 0n)
    const loanIds = loans.map((l) => l.tokenId)
    const remainder = totalDebt > amount ? totalDebt - amount : 0n

    const { low: tickLimitLow, high: tickLimitHigh } = tickLimits(pool.currentTick, slippageBps)
    const ascendingLimits: readonly [number, number, number] = [
      Number(tickLimitLow),
      Number(tickLimitHigh),
      0,
    ]

    const nonLoanIds = existingPositionIds.filter((id) => !loanIds.includes(id))

    const opsPositionIds: bigint[] = [...loanIds]
    const opsSizes: bigint[] = loanIds.map(() => 0n)
    const opsLimits = loanIds.map(() => ascendingLimits)

    let finalPositionIdList: bigint[]

    if (remainder > 0n) {
      const { tokenId: newLoanId, adjustedSize } = buildUniqueLoan(
        pool.poolId,
        tokenIndex,
        tokenIndex,
        pool.currentTick,
        pool.tickSpacing,
        nonLoanIds,
        remainder,
      )
      opsPositionIds.push(newLoanId)
      opsSizes.push(adjustedSize)
      opsLimits.push(ascendingLimits)
      finalPositionIdList = [...nonLoanIds, newLoanId]
    } else {
      finalPositionIdList = nonLoanIds
    }

    try {
      return await submitWrite({
        client,
        walletClient,
        account,
        address: poolAddress,
        abi: panopticPoolV2Abi,
        functionName: 'dispatch',
        args: [opsPositionIds, finalPositionIdList, opsSizes, opsLimits, false, builderCode],
        txOverrides,
      })
    } catch (error) {
      if (isInputListFailError(error) && attempt < MAX_RETRIES - 1) {
        continue
      }
      throw error
    }
  }

  throw new MaxRetriesExceededError('smartRepay')
}

/**
 * Smart repay and wait for confirmation.
 */
export async function smartRepayAndWait(params: SmartRepayParams): Promise<TxReceipt> {
  const result = await smartRepay(params)
  const receipt = await result.wait()

  // Auto-update storage: remove fully-repaid loans, insert remainder loan if any
  if (params.storage && params.chainId !== undefined) {
    const { client, account, poolAddress, chainId, token, amount, storage, existingPositionIds } =
      params

    const pool = await getPool({ client, poolAddress, chainId })
    const tokenIndex = resolveTokenIndex(
      token,
      pool.collateralTracker0.token,
      pool.collateralTracker1.token,
    )

    const loans = await getLoanPositionsForToken(
      client,
      poolAddress,
      account,
      existingPositionIds,
      tokenIndex,
    )
    const loanIds = loans.map((l) => l.tokenId)
    const totalDebt = loans.reduce((sum, l) => sum + l.tokenAmount, 0n)
    const remainder = totalDebt > amount ? totalDebt - amount : 0n

    const positionIds =
      existingPositionIds ??
      (await getTrackedPositionIds({ chainId, poolAddress, account, storage }))

    // Remove all old loan IDs
    let updatedIds = positionIds.filter((id) => !loanIds.includes(id))

    // If there's a remainder, the contract minted a new loan — find it
    if (remainder > 0n) {
      const nonLoanIds = existingPositionIds.filter((id) => !loanIds.includes(id))
      const newLoan = buildUniqueLoan(
        pool.poolId,
        tokenIndex,
        tokenIndex,
        pool.currentTick,
        pool.tickSpacing,
        nonLoanIds,
        remainder,
      )
      updatedIds = [...updatedIds, newLoan.tokenId]
    }

    await savePositionIds(storage, chainId, poolAddress, account, updatedIds)
  }

  return receipt
}
