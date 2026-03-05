/**
 * Account buying power read function for the Panoptic v2 SDK.
 *
 * Wraps the 3-arg PanopticQuery.checkCollateral overload that uses oracle ticks
 * to compute account-level collateral balance and requirements.
 *
 * @module v2/reads/buyingPower
 */

import type { Address, Client } from 'viem'
import { ContractFunctionRevertedError } from 'viem'
import { readContract } from 'viem/actions'

import { panopticPoolAbi } from '../../../generated'
import { panopticQueryAbi } from '../abis/panopticQuery'
import type { BlockMeta } from '../types'

/**
 * Parameters for getAccountBuyingPower.
 */
export interface GetAccountBuyingPowerParams {
  /** viem Client (PublicClient or basic Client with transport) */
  client: Client
  /** PanopticPool address */
  poolAddress: Address
  /** Account address */
  account: Address
  /** TokenIds of open positions */
  tokenIds: bigint[]
  /** PanopticQuery address (required) */
  queryAddress: Address
  /** Optional block number for historical queries */
  blockNumber?: bigint
  /** Optional pre-fetched block metadata (skips block metadata fetch) */
  _meta?: BlockMeta
}

/**
 * Result of getAccountBuyingPower.
 */
export interface AccountBuyingPower {
  /** Collateral balance for token0 (at fastOracleTick) */
  collateralBalance0: bigint
  /** Required collateral for token0 (at fastOracleTick) */
  requiredCollateral0: bigint
  /** Collateral balance for token1 (at fastOracleTick) */
  collateralBalance1: bigint
  /** Required collateral for token1 (at fastOracleTick) */
  requiredCollateral1: bigint
  /** Block metadata (present only if _meta was provided) */
  _meta?: BlockMeta
}

const ZERO_RESULT: Omit<AccountBuyingPower, '_meta'> = {
  collateralBalance0: 0n,
  requiredCollateral0: 0n,
  collateralBalance1: 0n,
  requiredCollateral1: 0n,
}

/**
 * Get account-level buying power using the 3-arg checkCollateral overload.
 *
 * This calls PanopticQuery.checkCollateral(pool, account, positionIdList) which
 * returns 4 arrays of 4 values each, evaluated at [currentTick, fastOracleTick,
 * slowOracleTick, latestObservation]. We extract index [1] (fastOracleTick)
 * which is the tick used for buying power calculations.
 *
 * If checkCollateral reverts due to an uninitialized oracle (pool.getOracleTicks()
 * also reverts with a contract error), returns zeros. For all other errors, re-throws.
 *
 * Accepts a plain viem `Client` (not just `PublicClient`) so it works with wagmi's
 * `useClient()` without needing a cast.
 *
 * @param params - The parameters
 * @returns Account buying power data with optional block metadata
 */
export async function getAccountBuyingPower(
  params: GetAccountBuyingPowerParams,
): Promise<AccountBuyingPower> {
  const { client, poolAddress, account, tokenIds, queryAddress, blockNumber } = params
  const _meta = params._meta

  try {
    const res = await readContract(client, {
      address: queryAddress,
      abi: panopticQueryAbi,
      functionName: 'checkCollateral',
      args: [poolAddress, account, tokenIds],
      blockNumber,
    })

    // res is [collateralBalances0[4], requiredCollaterals0[4], collateralBalances1[4], requiredCollaterals1[4]]
    // Index [1] = fastOracleTick values
    return {
      collateralBalance0: res[0][1],
      requiredCollateral0: res[1][1],
      collateralBalance1: res[2][1],
      requiredCollateral1: res[3][1],
      _meta,
    }
  } catch (checkCollateralError: unknown) {
    // Fallback: check if the revert is due to uninitialized oracle
    try {
      await readContract(client, {
        address: poolAddress,
        abi: panopticPoolAbi,
        functionName: 'getOracleTicks',
        blockNumber,
      })
    } catch (getOracleTicksError: unknown) {
      if (getOracleTicksError instanceof ContractFunctionRevertedError) {
        // Oracle not initialized — return zeros
        return { ...ZERO_RESULT, _meta }
      }
    }
    // getOracleTicks succeeded or threw a non-contract error — re-throw original
    throw checkCollateralError
  }
}
