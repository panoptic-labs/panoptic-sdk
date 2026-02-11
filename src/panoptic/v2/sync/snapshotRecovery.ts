/**
 * Snapshot recovery from dispatch calldata.
 * @module v2/sync/snapshotRecovery
 */

import type { Address, Hash, PublicClient } from 'viem'
import { decodeFunctionData } from 'viem'

import { panopticPoolAbi } from '../../../generated'

/**
 * Parameters for recovering position snapshot from dispatch calldata.
 */
export interface RecoverSnapshotParams {
  /** viem public client */
  client: PublicClient
  /** Pool address */
  poolAddress: Address
  /** Account to recover positions for */
  account: Address
  /** Starting block for transaction search (defaults to 0) */
  fromBlock?: bigint
  /** Ending block for transaction search (defaults to latest) */
  toBlock?: bigint
}

/**
 * Snapshot recovery result.
 */
export interface SnapshotRecoveryResult {
  /** Whether recovery was successful */
  success: boolean
  /** Position IDs from the final position list */
  positionIds: bigint[]
  /** Block number of the recovery transaction */
  blockNumber: bigint
  /** Block hash of the recovery transaction */
  blockHash: Hash
  /** Transaction hash used for recovery */
  transactionHash: Hash
}

/**
 * Recover position snapshot from the last dispatch transaction.
 * This is the primary recovery method - it finds the most recent dispatch()
 * call and extracts the finalPositionIdList from the calldata.
 *
 * @param params - Recovery parameters
 * @returns Snapshot recovery result
 */
export async function recoverSnapshot(
  params: RecoverSnapshotParams,
): Promise<SnapshotRecoveryResult | null> {
  const { client, poolAddress, account, toBlock } = params

  // Get the latest block if not specified
  const latestBlock = toBlock ?? (await client.getBlockNumber())

  // Search for transactions from the account to the pool
  // We need to find dispatch() or dispatchFrom() calls
  // Note: This requires the account to have sent transactions directly,
  // or we need to look at internal transactions

  // Strategy: Look for OptionMinted or OptionBurnt events to find transactions,
  // then decode the transaction input to get the full position list

  // Get recent events for this account
  const [mintEvents, burnEvents] = await Promise.all([
    client.getLogs({
      address: poolAddress,
      event: {
        type: 'event',
        name: 'OptionMinted',
        inputs: [
          { type: 'address', name: 'recipient', indexed: true },
          { type: 'uint256', name: 'tokenId', indexed: true },
          { type: 'uint256', name: 'balanceData', indexed: false },
        ],
      },
      args: {
        recipient: account,
      },
      fromBlock: params.fromBlock ?? 0n,
      toBlock: latestBlock,
    }),
    client.getLogs({
      address: poolAddress,
      event: {
        type: 'event',
        name: 'OptionBurnt',
        inputs: [
          { type: 'address', name: 'recipient', indexed: true },
          { type: 'uint256', name: 'tokenId', indexed: true },
          { type: 'uint256', name: 'positionSize', indexed: false },
          { type: 'int256[4]', name: 'premiaByLeg', indexed: false },
        ],
      },
      args: {
        recipient: account,
      },
      fromBlock: params.fromBlock ?? 0n,
      toBlock: latestBlock,
    }),
  ])

  // Combine and sort by block number (descending) to get most recent first
  const allEvents = [...mintEvents, ...burnEvents].sort((a, b) => {
    const blockDiff = Number(b.blockNumber - a.blockNumber)
    if (blockDiff !== 0) return blockDiff
    return Number(b.logIndex - a.logIndex)
  })

  // Find the most recent transaction with position data
  for (const event of allEvents) {
    try {
      const [tx, block] = await Promise.all([
        client.getTransaction({ hash: event.transactionHash }),
        client.getBlock({ blockNumber: event.blockNumber }),
      ])

      const decoded = decodeDispatchCalldata(tx.input)
      if (!decoded) continue

      // For dispatchFrom, verify target account matches
      if (decoded.targetAccount && decoded.targetAccount.toLowerCase() !== account.toLowerCase()) {
        continue
      }

      return {
        success: true,
        positionIds: decoded.positionIds,
        blockNumber: event.blockNumber,
        blockHash: block.hash,
        transactionHash: event.transactionHash,
      }
    } catch {
      // Transaction fetch failed, continue
    }
  }

  // No snapshot found
  return null
}

/**
 * Decoded dispatch calldata result.
 */
export interface DispatchCalldata {
  /** Final position ID list after the dispatch */
  positionIds: bigint[]
  /** Target account (only set for dispatchFrom) */
  targetAccount?: Address
}

/**
 * Decode position IDs from dispatch calldata.
 *
 * @param input - Transaction input data
 * @returns Decoded dispatch data or null if not a dispatch call
 */
export function decodeDispatchCalldata(input: `0x${string}`): DispatchCalldata | null {
  try {
    const decoded = decodeFunctionData({
      abi: panopticPoolAbi,
      data: input,
    })

    if (decoded.functionName === 'dispatch') {
      const args = decoded.args as readonly [
        bigint[],
        bigint[],
        bigint[],
        readonly [number, number, number][],
        boolean,
        bigint,
      ]
      return { positionIds: [...args[1]] } // finalPositionIdList
    }

    if (decoded.functionName === 'dispatchFrom') {
      const args = decoded.args as readonly [bigint[], Address, bigint[], bigint[], bigint]
      return {
        positionIds: [...args[3]], // positionIdListToFinal
        targetAccount: args[1],
      }
    }

    return null
  } catch {
    return null
  }
}
