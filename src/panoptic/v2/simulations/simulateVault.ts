/**
 * Vault simulation functions for the Panoptic v2 SDK.
 * @module v2/simulations/simulateVault
 */

import type { Address, PublicClient } from 'viem'

import { collateralTrackerAbi } from '../../../generated'
import { getBlockMeta } from '../clients'
import { PanopticError } from '../errors'
import type { DepositSimulation, SimulationResult, WithdrawSimulation } from '../types'

/**
 * Parameters for simulating deposit.
 */
export interface SimulateDepositParams {
  /** Public client */
  client: PublicClient
  /** CollateralTracker address */
  collateralTrackerAddress: Address
  /** Account address */
  account: Address
  /** Assets to deposit */
  assets: bigint
  /** Optional block number for simulation */
  blockNumber?: bigint
}

/**
 * Simulate a deposit operation.
 *
 * @param params - Simulation parameters
 * @returns Simulation result with deposit data or error
 */
export async function simulateDeposit(
  params: SimulateDepositParams,
): Promise<SimulationResult<DepositSimulation>> {
  const { client, collateralTrackerAddress, account, assets, blockNumber } = params

  const targetBlockNumber = blockNumber ?? (await client.getBlockNumber())
  const metaPromise = getBlockMeta({ client, blockNumber: targetBlockNumber })

  try {
    // Run multicall (historical block), gas estimate (latest), and block meta in parallel
    const [[currentShares, currentAssets, previewedShares], gasEstimate, _meta] = await Promise.all(
      [
        client.multicall({
          contracts: [
            {
              address: collateralTrackerAddress,
              abi: collateralTrackerAbi,
              functionName: 'balanceOf',
              args: [account],
            },
            {
              address: collateralTrackerAddress,
              abi: collateralTrackerAbi,
              functionName: 'assetsOf',
              args: [account],
            },
            {
              address: collateralTrackerAddress,
              abi: collateralTrackerAbi,
              functionName: 'previewDeposit',
              args: [assets],
            },
          ],
          blockNumber: targetBlockNumber,
          allowFailure: false,
        }),
        client.estimateContractGas({
          address: collateralTrackerAddress,
          abi: collateralTrackerAbi,
          functionName: 'deposit',
          args: [assets, account],
          account,
          blockNumber: targetBlockNumber,
        }),
        metaPromise,
      ],
    )

    const data: DepositSimulation = {
      sharesMinted: previewedShares,
      postAssets: currentAssets + assets,
      postShares: currentShares + previewedShares,
    }

    return {
      success: true,
      data,
      gasEstimate,
      _meta,
    }
  } catch (error) {
    const _meta = await metaPromise
    return {
      success: false,
      error:
        error instanceof PanopticError
          ? error
          : new PanopticError(
              error instanceof Error ? error.message : 'Simulation failed',
              error instanceof Error ? error : undefined,
            ),
      _meta,
    }
  }
}

/**
 * Parameters for simulating withdrawal.
 */
export interface SimulateWithdrawParams {
  /** Public client */
  client: PublicClient
  /** CollateralTracker address */
  collateralTrackerAddress: Address
  /** Account address */
  account: Address
  /** Assets to withdraw */
  assets: bigint
  /** Optional block number for simulation */
  blockNumber?: bigint
}

/**
 * Simulate a withdrawal operation.
 *
 * @param params - Simulation parameters
 * @returns Simulation result with withdrawal data or error
 */
export async function simulateWithdraw(
  params: SimulateWithdrawParams,
): Promise<SimulationResult<WithdrawSimulation>> {
  const { client, collateralTrackerAddress, account, assets, blockNumber } = params

  const targetBlockNumber = blockNumber ?? (await client.getBlockNumber())
  const metaPromise = getBlockMeta({ client, blockNumber: targetBlockNumber })

  try {
    // Get current state
    const [currentShares, currentAssets, maxWithdrawable, previewedShares] = await client.multicall(
      {
        contracts: [
          {
            address: collateralTrackerAddress,
            abi: collateralTrackerAbi,
            functionName: 'balanceOf',
            args: [account],
          },
          {
            address: collateralTrackerAddress,
            abi: collateralTrackerAbi,
            functionName: 'assetsOf',
            args: [account],
          },
          {
            address: collateralTrackerAddress,
            abi: collateralTrackerAbi,
            functionName: 'maxWithdraw',
            args: [account],
          },
          {
            address: collateralTrackerAddress,
            abi: collateralTrackerAbi,
            functionName: 'previewWithdraw',
            args: [assets],
          },
        ],
        blockNumber: targetBlockNumber,
        allowFailure: false,
      },
    )

    // Check if withdrawal is possible
    const canWithdraw = assets <= maxWithdrawable

    const _meta = await metaPromise

    if (!canWithdraw) {
      const data: WithdrawSimulation = {
        sharesBurned: 0n,
        assetsReceived: 0n,
        postAssets: currentAssets,
        postShares: currentShares,
        canWithdraw: false,
        reason: `Requested ${assets}, but max withdrawable is ${maxWithdrawable}`,
      }

      return {
        success: true,
        data,
        gasEstimate: 0n,
        _meta,
      }
    }

    const gasEstimate = await client.estimateContractGas({
      address: collateralTrackerAddress,
      abi: collateralTrackerAbi,
      functionName: 'withdraw',
      args: [assets, account, account],
      account,
      blockNumber: targetBlockNumber,
    })

    const data: WithdrawSimulation = {
      sharesBurned: previewedShares,
      assetsReceived: assets,
      postAssets: currentAssets - assets,
      postShares: currentShares - previewedShares,
      canWithdraw: true,
    }

    return {
      success: true,
      data,
      gasEstimate,
      _meta,
    }
  } catch (error) {
    const _meta = await metaPromise
    return {
      success: false,
      error:
        error instanceof PanopticError
          ? error
          : new PanopticError(
              error instanceof Error ? error.message : 'Simulation failed',
              error instanceof Error ? error : undefined,
            ),
      _meta,
    }
  }
}
