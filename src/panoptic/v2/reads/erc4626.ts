/**
 * ERC4626 vault preview functions for the Panoptic v2 SDK.
 *
 * The CollateralTracker contract implements ERC4626, providing standard
 * vault functionality for depositing/withdrawing collateral.
 *
 * @module v2/reads/erc4626
 */

import type { Address, PublicClient } from 'viem'

import { collateralTrackerAbi, panopticPoolAbi } from '../../../generated'
import { getBlockMeta } from '../clients/blockMeta'
import type { BlockMeta } from '../types'

/**
 * Parameters for ERC4626 preview functions.
 */
export interface ERC4626PreviewParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Which token's collateral tracker to query (0 or 1) */
  tokenIndex: 0 | 1
  /** Amount to preview */
  amount: bigint
  /** Optional block number for historical queries */
  blockNumber?: bigint
  /** Optional pre-fetched collateral tracker address */
  collateralTrackerAddress?: Address
  /** Optional pre-fetched block metadata (skips getBlockMeta RPC call) */
  _meta?: BlockMeta
}

/**
 * ERC4626 preview result.
 */
export interface ERC4626PreviewResult {
  /** The resulting amount (shares or assets depending on function) */
  result: bigint
  /** Block metadata */
  _meta: BlockMeta
}

/**
 * Helper to get collateral tracker address.
 */
async function getCollateralTrackerAddress(
  client: PublicClient,
  poolAddress: Address,
  tokenIndex: 0 | 1,
  providedAddress?: Address,
): Promise<Address> {
  if (providedAddress) return providedAddress

  return client.readContract({
    address: poolAddress,
    abi: panopticPoolAbi,
    functionName: tokenIndex === 0 ? 'collateralToken0' : 'collateralToken1',
  })
}

/**
 * Preview the amount of shares that would be minted for a deposit.
 *
 * @param params - The parameters
 * @returns Preview result with block metadata
 */
export async function previewDeposit(params: ERC4626PreviewParams): Promise<ERC4626PreviewResult> {
  const { client, poolAddress, tokenIndex, amount, blockNumber, collateralTrackerAddress } = params

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())
  const trackerAddress = await getCollateralTrackerAddress(
    client,
    poolAddress,
    tokenIndex,
    collateralTrackerAddress,
  )

  const [result, _meta] = await Promise.all([
    client.readContract({
      address: trackerAddress,
      abi: collateralTrackerAbi,
      functionName: 'previewDeposit',
      args: [amount],
      blockNumber: targetBlockNumber,
    }),
    params._meta ?? getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  return { result, _meta }
}

/**
 * Preview the amount of assets that would be returned for a withdrawal.
 *
 * @param params - The parameters
 * @returns Preview result with block metadata
 */
export async function previewWithdraw(params: ERC4626PreviewParams): Promise<ERC4626PreviewResult> {
  const { client, poolAddress, tokenIndex, amount, blockNumber, collateralTrackerAddress } = params

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())
  const trackerAddress = await getCollateralTrackerAddress(
    client,
    poolAddress,
    tokenIndex,
    collateralTrackerAddress,
  )

  const [result, _meta] = await Promise.all([
    client.readContract({
      address: trackerAddress,
      abi: collateralTrackerAbi,
      functionName: 'previewWithdraw',
      args: [amount],
      blockNumber: targetBlockNumber,
    }),
    params._meta ?? getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  return { result, _meta }
}

/**
 * Preview the amount of assets required for a mint.
 *
 * @param params - The parameters
 * @returns Preview result with block metadata
 */
export async function previewMint(params: ERC4626PreviewParams): Promise<ERC4626PreviewResult> {
  const { client, poolAddress, tokenIndex, amount, blockNumber, collateralTrackerAddress } = params

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())
  const trackerAddress = await getCollateralTrackerAddress(
    client,
    poolAddress,
    tokenIndex,
    collateralTrackerAddress,
  )

  const [result, _meta] = await Promise.all([
    client.readContract({
      address: trackerAddress,
      abi: collateralTrackerAbi,
      functionName: 'previewMint',
      args: [amount],
      blockNumber: targetBlockNumber,
    }),
    params._meta ?? getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  return { result, _meta }
}

/**
 * Preview the amount of shares that would be burned for a redeem.
 *
 * @param params - The parameters
 * @returns Preview result with block metadata
 */
export async function previewRedeem(params: ERC4626PreviewParams): Promise<ERC4626PreviewResult> {
  const { client, poolAddress, tokenIndex, amount, blockNumber, collateralTrackerAddress } = params

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())
  const trackerAddress = await getCollateralTrackerAddress(
    client,
    poolAddress,
    tokenIndex,
    collateralTrackerAddress,
  )

  const [result, _meta] = await Promise.all([
    client.readContract({
      address: trackerAddress,
      abi: collateralTrackerAbi,
      functionName: 'previewRedeem',
      args: [amount],
      blockNumber: targetBlockNumber,
    }),
    params._meta ?? getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  return { result, _meta }
}

/**
 * Convert an amount of assets to shares.
 *
 * @param params - The parameters
 * @returns Conversion result with block metadata
 */
export async function convertToShares(params: ERC4626PreviewParams): Promise<ERC4626PreviewResult> {
  const { client, poolAddress, tokenIndex, amount, blockNumber, collateralTrackerAddress } = params

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())
  const trackerAddress = await getCollateralTrackerAddress(
    client,
    poolAddress,
    tokenIndex,
    collateralTrackerAddress,
  )

  const [result, _meta] = await Promise.all([
    client.readContract({
      address: trackerAddress,
      abi: collateralTrackerAbi,
      functionName: 'convertToShares',
      args: [amount],
      blockNumber: targetBlockNumber,
    }),
    params._meta ?? getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  return { result, _meta }
}

/**
 * Convert an amount of shares to assets.
 *
 * @param params - The parameters
 * @returns Conversion result with block metadata
 */
export async function convertToAssets(params: ERC4626PreviewParams): Promise<ERC4626PreviewResult> {
  const { client, poolAddress, tokenIndex, amount, blockNumber, collateralTrackerAddress } = params

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())
  const trackerAddress = await getCollateralTrackerAddress(
    client,
    poolAddress,
    tokenIndex,
    collateralTrackerAddress,
  )

  const [result, _meta] = await Promise.all([
    client.readContract({
      address: trackerAddress,
      abi: collateralTrackerAbi,
      functionName: 'convertToAssets',
      args: [amount],
      blockNumber: targetBlockNumber,
    }),
    params._meta ?? getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  return { result, _meta }
}
