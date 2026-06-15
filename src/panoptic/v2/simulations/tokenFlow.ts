/**
 * Token flow simulation utility using PanopticPool.multicall.
 *
 * Uses getAssetsOf-dispatch-getAssetsOf pattern within a single eth_call
 * to measure exact collateral asset movements from any dispatch call.
 *
 * @module v2/simulations/tokenFlow
 */

import {
  type Address,
  type Hex,
  type PublicClient,
  decodeFunctionResult,
  encodeFunctionData,
} from 'viem'

import { panopticPoolV2Abi } from '../../../generated'
import { panopticErrorsAbi } from '../errors/errorsAbi'

/**
 * PanopticPool getAssetsOf ABI.
 * Returns collateral assets (shares converted to underlying) for an account.
 */
const getAssetsOfAbi = [
  {
    type: 'function',
    name: 'getAssetsOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [
      { name: 'assets0', type: 'uint256' },
      { name: 'assets1', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
] as const

/**
 * PanopticPool multicall ABI (inherited from Uniswap).
 * Uses delegatecall, preserving msg.sender throughout the chain.
 */
const multicallAbi = [
  {
    type: 'function',
    name: 'multicall',
    inputs: [{ name: 'data', type: 'bytes[]' }],
    outputs: [{ name: 'results', type: 'bytes[]' }],
    stateMutability: 'nonpayable',
  },
  // Include error definitions so viem can decode revert data with full args
  ...panopticErrorsAbi,
] as const

/**
 * Token flow result from simulation.
 * Measures collateral asset changes via getAssetsOf-dispatch-getAssetsOf pattern.
 */
export interface TokenFlow {
  /** Token 0 collateral change (negative = user deposits, positive = user receives) */
  delta0: bigint
  /** Token 1 collateral change (negative = user deposits, positive = user receives) */
  delta1: bigint
  /** Collateral assets in token 0 before the call */
  balanceBefore0: bigint
  /** Collateral assets in token 1 before the call */
  balanceBefore1: bigint
  /** Collateral assets in token 0 after the call */
  balanceAfter0: bigint
  /** Collateral assets in token 1 after the call */
  balanceAfter1: bigint
  /** Pool tick before the operation */
  tickBefore: bigint | null
  /** Pool tick after the operation */
  tickAfter: bigint | null
}

/**
 * Parameters for simulateWithTokenFlow.
 */
export interface SimulateWithTokenFlowParams {
  /** viem public client */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** User address whose collateral changes we're measuring */
  user: Address
  /** Encoded call data (typically dispatch) */
  callData: Hex
  /** Optional block number for simulation */
  blockNumber?: bigint
  /**
   * Optional additional encoded calls to append after the 5-call pattern.
   * These execute post-dispatch within the same multicall (same state).
   * Raw encoded bytes are returned in `postCallResults`.
   */
  postCallData?: Hex[]
  /**
   * Optional additional encoded calls to insert between the pre-dispatch
   * `getAssetsOf` / `getCurrentTick` and the target call. These execute
   * pre-dispatch within the same multicall — useful for reading per-position
   * data (e.g. `getFullPositionsData`) against the original `positionIdList`
   * before state mutates. Raw encoded bytes are returned in `preCallResults`.
   */
  preCallData?: Hex[]
}

/**
 * Result of simulateWithTokenFlow.
 */
export interface SimulateWithTokenFlowResult {
  /** Whether the simulation succeeded */
  success: boolean
  /** Token flow data (only if success) */
  tokenFlow?: TokenFlow
  /** Error message (only if failed) */
  error?: string
  /** Raw error object preserving viem cause chain and revert data */
  rawError?: Error
  /** Gas estimate for the inner call */
  gasEstimate: bigint
  /** Raw results from postCallData entries (only if success and postCallData was provided) */
  postCallResults?: Hex[]
  /** Raw results from preCallData entries (only if success and preCallData was provided) */
  preCallResults?: Hex[]
}

/**
 * Simulate a contract call and measure token flow using PanopticPool.multicall.
 *
 * This function uses PanopticPool's inherited multicall (delegatecall-based) to chain:
 * 1. getAssetsOf(user) - read collateral assets before
 * 2. getCurrentTick() - read pool tick before
 * 3. Execute the target call (e.g., dispatch)
 * 4. getCurrentTick() - read pool tick after
 * 5. getAssetsOf(user) - read collateral assets after
 *
 * ## Why PanopticPool.multicall instead of Multicall3?
 * - Measures **collateral assets** (shares → underlying), not raw wallet balances
 * - Uses **delegatecall**, preserving msg.sender throughout the chain
 * - Single contract interaction with PanopticPool
 * - Correctly reflects what happens during position operations
 *
 * ## Same-Block Guarantee
 * All operations execute within a single eth_call, ensuring atomic consistency.
 *
 * @param params - Simulation parameters
 * @returns Token flow result
 *
 * @example
 * ```typescript
 * const callData = encodeFunctionData({
 *   abi: panopticPoolV2Abi,
 *   functionName: 'dispatch',
 *   args: [positionIdList, finalPositionIdList, positionSizes, tickAndSpreadLimits, false, 0n],
 * })
 *
 * const result = await simulateWithTokenFlow({
 *   client,
 *   poolAddress,
 *   user: userAddress,
 *   callData,
 * })
 *
 * if (result.success) {
 *   console.log('Token 0 change:', result.tokenFlow.delta0)
 *   console.log('Token 1 change:', result.tokenFlow.delta1)
 * }
 * ```
 */
export async function simulateWithTokenFlow(
  params: SimulateWithTokenFlowParams,
): Promise<SimulateWithTokenFlowResult> {
  const { client, poolAddress, user, callData, blockNumber, postCallData, preCallData } = params

  // Encode getAssetsOf call
  const getAssetsOfCallData = encodeFunctionData({
    abi: getAssetsOfAbi,
    functionName: 'getAssetsOf',
    args: [user],
  })

  // Encode getCurrentTick call
  const getCurrentTickCallData = encodeFunctionData({
    abi: panopticPoolV2Abi,
    functionName: 'getCurrentTick',
  })

  const preLen = preCallData?.length ?? 0

  // Build multicall: [getAssetsOf, getCurrentTick, ...preCallData, targetCall, getCurrentTick, getAssetsOf, ...postCallData]
  const multicallData: Hex[] = [
    getAssetsOfCallData,
    getCurrentTickCallData,
    ...(preCallData ?? []),
    callData,
    getCurrentTickCallData,
    getAssetsOfCallData,
    ...(postCallData ?? []),
  ]

  try {
    // Execute via simulateContract on PanopticPool's multicall
    const { result } = await client.simulateContract({
      address: poolAddress,
      abi: multicallAbi,
      functionName: 'multicall',
      args: [multicallData],
      account: user,
      blockNumber,
    })

    // Decode getAssetsOf results
    const decodeAssets = (data: Hex): { assets0: bigint; assets1: bigint } => {
      const decoded = decodeFunctionResult({
        abi: getAssetsOfAbi,
        functionName: 'getAssetsOf',
        data,
      })
      return { assets0: decoded[0], assets1: decoded[1] }
    }

    // Decode getCurrentTick result (int24 decodes as number, convert to bigint)
    const decodeTick = (data: Hex): bigint => {
      return BigInt(
        decodeFunctionResult({
          abi: panopticPoolV2Abi,
          functionName: 'getCurrentTick',
          data,
        }),
      )
    }

    const assetsBefore = decodeAssets(result[0])
    const tickBefore = decodeTick(result[1])
    // result[2..2+preLen-1] are preCallData results
    // result[2+preLen] is the target call result (dispatch)
    const tickAfter = decodeTick(result[3 + preLen])
    const assetsAfter = decodeAssets(result[4 + preLen])

    const preCallResults = preLen > 0 ? (result.slice(2, 2 + preLen) as Hex[]) : undefined
    const postCallResults =
      postCallData && postCallData.length > 0 ? (result.slice(5 + preLen) as Hex[]) : undefined

    const delta0 = assetsAfter.assets0 - assetsBefore.assets0
    const delta1 = assetsAfter.assets1 - assetsBefore.assets1

    // Estimate gas for the target call directly
    let gasEstimate = 0n
    try {
      gasEstimate = await client.estimateGas({
        account: user,
        to: poolAddress,
        data: callData,
        blockNumber,
      })
    } catch {
      // Gas estimation may fail, use 0
    }

    return {
      success: true,
      tokenFlow: {
        delta0,
        delta1,
        balanceBefore0: assetsBefore.assets0,
        balanceBefore1: assetsBefore.assets1,
        balanceAfter0: assetsAfter.assets0,
        balanceAfter1: assetsAfter.assets1,
        tickBefore,
        tickAfter,
      },
      gasEstimate,
      postCallResults,
      preCallResults,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Simulation failed',
      rawError: error instanceof Error ? error : undefined,
      gasEstimate: 0n,
    }
  }
}

/**
 * Parameters for getting pool tokens.
 */
export interface GetPoolTokensParams {
  /** viem public client */
  client: PublicClient
  /** Pool address */
  poolAddress: Address
  /** Optional block number */
  blockNumber?: bigint
}

/**
 * Pool token addresses result.
 */
export interface PoolTokens {
  /** Token 0 address */
  token0: Address
  /** Token 1 address */
  token1: Address
  /** Collateral tracker 0 address */
  collateralTracker0: Address
  /** Collateral tracker 1 address */
  collateralTracker1: Address
}

/**
 * Get pool token addresses for reference.
 *
 * @param params - Parameters
 * @returns Pool token addresses
 */
export async function getPoolTokensForSimulation(params: GetPoolTokensParams): Promise<PoolTokens> {
  const { client, poolAddress, blockNumber } = params

  // Minimal ABI for the calls we need
  const poolAbi = [
    {
      type: 'function',
      name: 'collateralToken0',
      inputs: [],
      outputs: [{ type: 'address' }],
      stateMutability: 'view',
    },
    {
      type: 'function',
      name: 'collateralToken1',
      inputs: [],
      outputs: [{ type: 'address' }],
      stateMutability: 'view',
    },
  ] as const

  const collateralAbi = [
    {
      type: 'function',
      name: 'asset',
      inputs: [],
      outputs: [{ type: 'address' }],
      stateMutability: 'view',
    },
  ] as const

  // Get collateral tracker addresses
  const [ct0, ct1] = await client.multicall({
    contracts: [
      { address: poolAddress, abi: poolAbi, functionName: 'collateralToken0' },
      { address: poolAddress, abi: poolAbi, functionName: 'collateralToken1' },
    ],
    blockNumber,
    allowFailure: false,
  })

  // Get underlying token addresses from collateral trackers
  const [token0, token1] = await client.multicall({
    contracts: [
      { address: ct0, abi: collateralAbi, functionName: 'asset' },
      { address: ct1, abi: collateralAbi, functionName: 'asset' },
    ],
    blockNumber,
    allowFailure: false,
  })

  return {
    token0,
    token1,
    collateralTracker0: ct0,
    collateralTracker1: ct1,
  }
}
