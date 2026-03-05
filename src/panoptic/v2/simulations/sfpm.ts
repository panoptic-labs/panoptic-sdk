/**
 * SFPM simulation functions for the Panoptic v2 SDK.
 *
 * These simulate `mintTokenizedPosition` and `burnTokenizedPosition` on the
 * SemiFungiblePositionManager, called with `account: poolAddress` (the pool
 * is the caller in the actual protocol flow).
 *
 * @module v2/simulations/sfpm
 */

import type { Address, Hex, PublicClient } from 'viem'
import { encodeAbiParameters } from 'viem'

import { semiFungiblePositionManagerAbi } from '../../../generated'
import type { PoolKey } from '../types'

/**
 * Encode a PoolKey struct as bytes for the SFPM.
 */
export function encodePoolKeyBytes(poolKey: PoolKey): Hex {
  return encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ],
      },
    ],
    [
      {
        currency0: poolKey.currency0,
        currency1: poolKey.currency1,
        fee: Number(poolKey.fee),
        tickSpacing: Number(poolKey.tickSpacing),
        hooks: poolKey.hooks,
      },
    ],
  )
}

/**
 * Parameters for simulating an SFPM mint or burn.
 */
export interface SimulateSFPMParams {
  /** Public client */
  client: PublicClient
  /** SemiFungiblePositionManager address */
  sfpmAddress: Address
  /** PanopticPool address (used as `account` — the pool is the caller) */
  poolAddress: Address
  /** Encoded pool key (bytes) */
  poolKey: Hex
  /** TokenId to mint/burn */
  tokenId: bigint
  /** Position size (uint128) */
  positionSize: bigint
  /** Lower tick limit */
  tickLimitLow: number
  /** Upper tick limit */
  tickLimitHigh: number
}

/** Return type from SFPM mintTokenizedPosition / burnTokenizedPosition */
export type SFPMSimulationResult = readonly [
  readonly [bigint, bigint, bigint, bigint],
  bigint,
  number,
]

/**
 * Simulate an SFPM mintTokenizedPosition call.
 *
 * @param params - Simulation parameters
 * @returns The result tuple: [collectedAmounts[4], totalSwapped, newTick]
 */
export async function simulateSFPMMint(params: SimulateSFPMParams): Promise<SFPMSimulationResult> {
  const {
    client,
    sfpmAddress,
    poolAddress,
    poolKey,
    tokenId,
    positionSize,
    tickLimitLow,
    tickLimitHigh,
  } = params

  const { result } = await client.simulateContract({
    address: sfpmAddress,
    abi: semiFungiblePositionManagerAbi,
    functionName: 'mintTokenizedPosition',
    args: [
      poolKey,
      tokenId,
      BigInt(positionSize) as bigint & { readonly __uint128: true },
      tickLimitLow,
      tickLimitHigh,
    ],
    account: poolAddress,
  })

  return result
}

/**
 * Simulate an SFPM burnTokenizedPosition call.
 *
 * @param params - Simulation parameters
 * @returns The result tuple: [collectedAmounts[4], totalSwapped, newTick]
 */
export async function simulateSFPMBurn(params: SimulateSFPMParams): Promise<SFPMSimulationResult> {
  const {
    client,
    sfpmAddress,
    poolAddress,
    poolKey,
    tokenId,
    positionSize,
    tickLimitLow,
    tickLimitHigh,
  } = params

  const { result } = await client.simulateContract({
    address: sfpmAddress,
    abi: semiFungiblePositionManagerAbi,
    functionName: 'burnTokenizedPosition',
    args: [
      poolKey,
      tokenId,
      BigInt(positionSize) as bigint & { readonly __uint128: true },
      tickLimitLow,
      tickLimitHigh,
    ],
    account: poolAddress,
  })

  return result
}
