/**
 * PanopticGuardian read functions for the Panoptic v2 SDK.
 *
 * The Guardian can lock a pool into close-only mode. Unlocking is a two-step
 * timelocked flow: `requestUnlock(pool)` schedules an unlock ETA, and after the
 * ETA matures `executeUnlock(pool)` clears the lock. This module reads the
 * pending-unlock state so the UI can surface a countdown while a pool is locked.
 *
 * @module v2/reads/guardian
 */

import type { Address, PublicClient } from 'viem'

import { panopticGuardianAbi, panopticPoolV2Abi, riskEngineAbi } from '../../../generated'
import { getBlockMeta } from '../clients/blockMeta'
import type { BlockMeta } from '../types'

/**
 * Parameters for getGuardianUnlockState.
 */
export interface GetGuardianUnlockStateParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Optional RiskEngine address (skips the pool.riskEngine() read) */
  riskEngineAddress?: Address
  /** Optional PanopticGuardian address (skips the riskEngine.GUARDIAN() read) */
  guardianAddress?: Address
  /** Optional block number for historical queries */
  blockNumber?: bigint
  /** Optional pre-fetched block metadata (skips getBlockMeta RPC call) */
  _meta?: BlockMeta
}

/**
 * Guardian pool-unlock state.
 */
export interface GuardianUnlockState {
  /** Resolved PanopticGuardian contract address */
  guardianAddress: Address
  /** Unlock ETA as a Unix timestamp (seconds); 0n when no unlock is pending */
  unlockEta: bigint
  /** True when an unlock has been requested but not yet executed */
  hasPendingUnlock: boolean
  /** True when the pending unlock's timelock has elapsed and it can be executed */
  isReady: boolean
  /** Block metadata */
  _meta: BlockMeta
}

/**
 * Read the Guardian pending-unlock state for a pool.
 *
 * Resolves the Guardian address from the pool's RiskEngine when not provided,
 * then reads `unlockEta` and `isPoolUnlockReady` from the PanopticGuardian in a
 * single multicall pinned to the same block.
 *
 * @param params - The parameters
 * @returns Guardian unlock state with block metadata
 */
export async function getGuardianUnlockState(
  params: GetGuardianUnlockStateParams,
): Promise<GuardianUnlockState> {
  const { client, poolAddress, blockNumber } = params

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())

  // Only reuse caller-supplied metadata when it matches the block we read at,
  // otherwise data and metadata would come from different blocks.
  const reusableMeta =
    params._meta && params._meta.blockNumber === targetBlockNumber ? params._meta : undefined

  // Resolve the RiskEngine (immutable) unless caller supplied it.
  const riskEngineAddress =
    params.riskEngineAddress ??
    (await client.readContract({
      address: poolAddress,
      abi: panopticPoolV2Abi,
      functionName: 'riskEngine',
      blockNumber: targetBlockNumber,
    }))

  // Resolve the Guardian (immutable) unless caller supplied it.
  const guardianAddress =
    params.guardianAddress ??
    (await client.readContract({
      address: riskEngineAddress,
      abi: riskEngineAbi,
      functionName: 'GUARDIAN',
      blockNumber: targetBlockNumber,
    }))

  const [results, _meta] = await Promise.all([
    client.multicall({
      contracts: [
        {
          address: guardianAddress,
          abi: panopticGuardianAbi,
          functionName: 'unlockEta',
          args: [poolAddress],
        },
        {
          address: guardianAddress,
          abi: panopticGuardianAbi,
          functionName: 'isPoolUnlockReady',
          args: [poolAddress],
        },
      ],
      blockNumber: targetBlockNumber,
      allowFailure: false,
    }),
    reusableMeta ?? getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  const [unlockEta, isReady] = results

  return {
    guardianAddress,
    unlockEta,
    hasPendingUnlock: unlockEta > 0n,
    isReady,
    _meta,
  }
}
