/**
 * Account trade history for the Panoptic v2 SDK.
 *
 * Fetches OptionMinted and OptionBurnt events filtered by account address
 * using indexed topic filtering for RPC efficiency (2 calls total).
 *
 * @module v2/reads/history
 */

import type { Address, Hash, PublicClient } from 'viem'

import { panopticPoolAbi } from '../../../generated'
import { getBlockMeta } from '../clients'
import type { BlockMeta } from '../types'
import { decodePositionBalance } from '../writes/utils'

/**
 * A single trade (mint or burn) in the account's history.
 */
export interface AccountTrade {
  /** Whether this was a mint or burn */
  action: 'mint' | 'burn'
  /** TokenId of the position */
  tokenId: bigint
  /** Position size */
  positionSize: bigint
  /** Block number of the trade */
  blockNumber: bigint
  /** Transaction hash */
  transactionHash: Hash
  /** Log index within the block */
  logIndex: bigint
  /** Tick at mint (only for mints) */
  tickAtMint?: bigint
  /** Timestamp at mint in Unix seconds (only for mints) */
  timestampAtMint?: bigint
  /** Whether a swap occurred at mint (only for mints) */
  swapAtMint?: boolean
  /** Pool utilization for token 0 at mint (only for mints) */
  poolUtilization0?: bigint
  /** Pool utilization for token 1 at mint (only for mints) */
  poolUtilization1?: bigint
  /** Premia settled per leg on burn (only for burns) */
  premiaByLeg?: readonly [bigint, bigint, bigint, bigint]
}

/**
 * Account history result.
 */
export interface AccountHistory {
  /** All trades sorted by block number ascending, then log index */
  trades: AccountTrade[]
  /** Block metadata at query time */
  _meta: BlockMeta
}

/**
 * Parameters for getAccountHistory.
 */
export interface GetAccountHistoryParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticPool address */
  poolAddress: Address
  /** Account address to fetch history for */
  account: Address
  /** Start block (default: 0n) */
  fromBlock?: bigint
  /** End block (default: latest) */
  toBlock?: bigint
  /** Optional block number for _meta (default: toBlock or latest) */
  blockNumber?: bigint
}

/**
 * Fetch trade history for an account on a specific pool.
 *
 * Uses indexed topic filtering on the `recipient` field of OptionMinted
 * and OptionBurnt events, resulting in exactly 2 RPC calls regardless
 * of the number of trades.
 *
 * @param params - Query parameters
 * @returns Account trade history sorted chronologically
 *
 * @example
 * ```typescript
 * const history = await getAccountHistory({
 *   client,
 *   poolAddress,
 *   account: '0x...',
 *   fromBlock: 18_000_000n,
 * })
 *
 * for (const trade of history.trades) {
 *   console.log(`${trade.action} tokenId=${trade.tokenId} size=${trade.positionSize}`)
 * }
 * ```
 */
export async function getAccountHistory(params: GetAccountHistoryParams): Promise<AccountHistory> {
  const { client, poolAddress, account, fromBlock = 0n, toBlock, blockNumber } = params

  const effectiveToBlock = toBlock ?? blockNumber ?? (await client.getBlockNumber())
  const metaBlockNumber = blockNumber ?? effectiveToBlock

  // Fetch mints and burns in parallel — 2 RPC calls total.
  // Both events have `recipient` as indexed topic[1], so the RPC node
  // filters server-side via the topic hash.
  const [mintLogs, burnLogs, _meta] = await Promise.all([
    client.getContractEvents({
      address: poolAddress,
      abi: panopticPoolAbi,
      eventName: 'OptionMinted',
      args: { recipient: account },
      fromBlock,
      toBlock: effectiveToBlock,
    }),
    client.getContractEvents({
      address: poolAddress,
      abi: panopticPoolAbi,
      eventName: 'OptionBurnt',
      args: { recipient: account },
      fromBlock,
      toBlock: effectiveToBlock,
    }),
    getBlockMeta({ client, blockNumber: metaBlockNumber }),
  ])

  const trades: AccountTrade[] = []

  // Parse mints
  for (const log of mintLogs) {
    const args = log.args as {
      recipient: Address
      tokenId: bigint
      balanceData: bigint
    }
    const balance = decodePositionBalance(args.balanceData)
    trades.push({
      action: 'mint',
      tokenId: args.tokenId,
      positionSize: balance.positionSize,
      blockNumber: log.blockNumber!,
      transactionHash: log.transactionHash!,
      logIndex: BigInt(log.logIndex!),
      tickAtMint: balance.tickAtMint,
      timestampAtMint: balance.timestampAtMint,
      swapAtMint: balance.swapAtMint,
      poolUtilization0: balance.poolUtilization0,
      poolUtilization1: balance.poolUtilization1,
    })
  }

  // Parse burns
  for (const log of burnLogs) {
    const args = log.args as {
      recipient: Address
      tokenId: bigint
      positionSize: bigint
      premiaByLeg: readonly [bigint, bigint, bigint, bigint]
    }
    trades.push({
      action: 'burn',
      tokenId: args.tokenId,
      positionSize: args.positionSize,
      blockNumber: log.blockNumber!,
      transactionHash: log.transactionHash!,
      logIndex: BigInt(log.logIndex!),
      premiaByLeg: args.premiaByLeg,
    })
  }

  // Sort chronologically: by block number, then log index
  trades.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) {
      return a.blockNumber < b.blockNumber ? -1 : 1
    }
    return a.logIndex < b.logIndex ? -1 : 1
  })

  return { trades, _meta }
}
