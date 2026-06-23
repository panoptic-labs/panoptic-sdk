/**
 * Snapshot recovery from dispatch calldata.
 * @module v2/sync/snapshotRecovery
 */

import type { AbiFunction, Address, Hash, PublicClient } from 'viem'
import { decodeFunctionData, toFunctionSelector } from 'viem'

import { panopticPoolV2Abi } from '../../../generated'

const LOG_SCAN_WINDOW = 10_000n

type SnapshotEventLog = Awaited<ReturnType<PublicClient['getLogs']>>[number]
type SnapshotCandidateEvent = SnapshotEventLog & {
  transactionHash: Hash
  blockNumber: bigint
  logIndex: number
}

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

  const searchFromBlock = params.fromBlock ?? 0n
  if (latestBlock < searchFromBlock) return null

  // Fast path: a single getLogs per event type over the entire
  // [searchFromBlock, latest] range. The queries are filtered by `address` and
  // an indexed account topic, so providers like Alchemy impose no block-range
  // cap on them (only a result-count cap) — one call per event type is enough
  // and the returned set is already complete, so there are no older windows to
  // scan. This avoids walking the whole chain in 10k-block chunks (4 getLogs
  // per chunk), which for accounts with no history is thousands of empty calls.
  try {
    const events = await getSnapshotEventsForWindow({
      client,
      poolAddress,
      account,
      fromBlock: searchFromBlock,
      toBlock: latestBlock,
    })
    return await recoverSnapshotFromEvents({ client, account, events })
  } catch (error) {
    // Only fall back to windowed scanning when the provider rejected the wide
    // range. Any other error (e.g. transport failure) should propagate.
    if (!isRangeLimitError(error)) throw error
  }

  // Fallback for providers that cap getLogs block range: scan newest-to-oldest
  // in 10k-block windows and stop at the first window that yields a snapshot.
  let windowToBlock = latestBlock
  while (true) {
    const windowFromBlock =
      windowToBlock - searchFromBlock + 1n > LOG_SCAN_WINDOW
        ? windowToBlock - LOG_SCAN_WINDOW + 1n
        : searchFromBlock

    const events = await getSnapshotEventsForWindow({
      client,
      poolAddress,
      account,
      fromBlock: windowFromBlock,
      toBlock: windowToBlock,
    })
    const snapshot = await recoverSnapshotFromEvents({ client, account, events })
    if (snapshot) return snapshot

    if (windowFromBlock === searchFromBlock) break
    windowToBlock = windowFromBlock - 1n
  }

  // No snapshot found
  return null
}

/**
 * Detect provider errors that indicate the requested getLogs block range was
 * too wide (so the caller should retry with smaller windows). Covers the common
 * phrasings used by Alchemy, Infura, and other JSON-RPC providers.
 */
function isRangeLimitError(error: unknown): boolean {
  const parts: string[] = []
  let current: unknown = error
  let depth = 0
  while (current && typeof current === 'object' && depth < 5) {
    const obj = current as Record<string, unknown>
    if (typeof obj.message === 'string') parts.push(obj.message)
    if (typeof obj.details === 'string') parts.push(obj.details)
    current = obj.cause
    depth += 1
  }
  if (typeof error === 'string') parts.push(error)

  const message = parts.join(' ').toLowerCase()
  if (!message) return false

  return (
    message.includes('block range') ||
    message.includes('range is too large') ||
    message.includes('range too large') ||
    message.includes('query returned more than') ||
    message.includes('too many results') ||
    message.includes('log response size exceeded') ||
    message.includes('exceeds the limit') ||
    (message.includes('range') && message.includes('limit'))
  )
}

async function getSnapshotEventsForWindow(params: {
  client: PublicClient
  poolAddress: Address
  account: Address
  fromBlock: bigint
  toBlock: bigint
}): Promise<SnapshotEventLog[]> {
  const { client, poolAddress, account, fromBlock, toBlock } = params

  // OptionMinted/OptionBurnt cover the account's own dispatches.
  // ForcedExercised/AccountLiquidated cover third-party dispatchFrom calls
  // where the tx sender is not the account but calldata contains the final list.
  const [mintEvents, burnEvents, forceExerciseEvents, liquidationEvents] = await Promise.all([
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
      fromBlock,
      toBlock,
    }),
    client.getLogs({
      address: poolAddress,
      event: {
        type: 'event',
        name: 'OptionBurnt',
        inputs: [
          { type: 'address', name: 'recipient', indexed: true },
          { type: 'uint128', name: 'positionSize', indexed: false },
          { type: 'uint256', name: 'tokenId', indexed: true },
          { type: 'int256[4]', name: 'premiaByLeg', indexed: false },
        ],
      },
      args: {
        recipient: account,
      },
      fromBlock,
      toBlock,
    }),
    client.getLogs({
      address: poolAddress,
      event: {
        type: 'event',
        name: 'ForcedExercised',
        inputs: [
          { type: 'address', name: 'exercisor', indexed: true },
          { type: 'address', name: 'user', indexed: true },
          { type: 'uint256', name: 'tokenId', indexed: true },
          { type: 'int256', name: 'exerciseFee', indexed: false },
        ],
      },
      args: {
        user: account,
      },
      fromBlock,
      toBlock,
    }),
    client.getLogs({
      address: poolAddress,
      event: {
        type: 'event',
        name: 'AccountLiquidated',
        inputs: [
          { type: 'address', name: 'liquidator', indexed: true },
          { type: 'address', name: 'liquidatee', indexed: true },
          { type: 'int256', name: 'bonusAmounts', indexed: false },
        ],
      },
      args: {
        liquidatee: account,
      },
      fromBlock,
      toBlock,
    }),
  ])

  return [...mintEvents, ...burnEvents, ...forceExerciseEvents, ...liquidationEvents]
}

async function recoverSnapshotFromEvents(params: {
  client: PublicClient
  account: Address
  events: SnapshotEventLog[]
}): Promise<SnapshotRecoveryResult | null> {
  const { client, account, events } = params

  // Combine and sort by block number (descending) to get most recent first
  const allEvents = events.filter(isSnapshotCandidateEvent).sort((a, b) => {
    const blockDiff = Number(b.blockNumber - a.blockNumber)
    if (blockDiff !== 0) return blockDiff
    return Number(b.logIndex - a.logIndex)
  })

  // Deduplicate by transaction hash — multiple events from the same tx
  // (e.g. OptionMinted for each leg) would produce duplicate entries
  const seen = new Set<string>()
  const uniqueEvents = allEvents.filter((e) => {
    if (seen.has(e.transactionHash)) return false
    seen.add(e.transactionHash)
    return true
  })

  // Find the most recent transaction with position data
  for (const event of uniqueEvents) {
    try {
      const [tx, block] = await Promise.all([
        client.getTransaction({ hash: event.transactionHash }),
        client.getBlock({ blockNumber: event.blockNumber }),
      ])

      const decoded = decodeDispatchCalldata(tx.input)
      if (!decoded) {
        continue
      }

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

  return null
}

function isSnapshotCandidateEvent(event: SnapshotEventLog): event is SnapshotCandidateEvent {
  return event.transactionHash !== null && event.blockNumber !== null && event.logIndex !== null
}

/**
 * Parameters for recovering a snapshot from a known transaction hash.
 */
export interface RecoverSnapshotFromTxParams {
  /** viem public client */
  client: PublicClient
  /** Transaction hash of a known dispatch() call */
  transactionHash: Hash
  /** Account to verify. When set, rejects transactions not sent by (or targeting) this account. */
  account?: Address
  /** Pool address to validate against. When set, rejects transactions not sent to this pool. */
  pool?: Address
}

/**
 * Recover position snapshot from a specific dispatch transaction hash.
 *
 * This is an O(1) alternative to {@link recoverSnapshot} when you already
 * know the tx hash of the most recent dispatch. It fetches the transaction,
 * decodes the `finalPositionIdList` from the calldata, and returns the result
 * — no event scanning required.
 *
 * @param params - Recovery parameters including the transaction hash
 * @returns Snapshot recovery result, or null if the tx is not a dispatch call
 *
 * @example
 * ```typescript
 * const snapshot = await recoverSnapshotFromTx({
 *   client,
 *   transactionHash: '0xabc...',
 * })
 * if (snapshot) {
 *   console.log('Open positions:', snapshot.positionIds)
 * }
 * ```
 */
export async function recoverSnapshotFromTx(
  params: RecoverSnapshotFromTxParams,
): Promise<SnapshotRecoveryResult | null> {
  const { client, transactionHash, account, pool } = params

  const tx = await client.getTransaction({ hash: transactionHash })

  // Pending transactions have no block number — cannot recover snapshot
  if (tx.blockNumber == null) return null

  // Validate pool: transaction must have been sent to the expected pool address
  if (pool && tx.to?.toLowerCase() !== pool.toLowerCase()) {
    return null
  }

  const decoded = decodeDispatchCalldata(tx.input)
  if (!decoded) return null

  // Validate account context:
  // - dispatch: tx.from must be the account (msg.sender is the trader)
  // - dispatchFrom: decoded.targetAccount must be the account (builder sends on behalf of trader)
  if (account) {
    if (decoded.targetAccount) {
      if (decoded.targetAccount.toLowerCase() !== account.toLowerCase()) {
        return null
      }
    } else {
      if (tx.from.toLowerCase() !== account.toLowerCase()) {
        return null
      }
    }
  }

  const blockNumber = tx.blockNumber
  const block = await client.getBlock({ blockNumber })

  return {
    success: true,
    positionIds: decoded.positionIds,
    blockNumber,
    blockHash: block.hash,
    transactionHash,
  }
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
  // Try direct dispatch/dispatchFrom first
  const direct = decodeDirectDispatch(input)
  if (direct) return direct

  // Try unwrapping smart contract wallet wrappers (executeBatch, execute)
  return decodeWrappedDispatch(input)
}

/**
 * Try to decode input as a direct dispatch or dispatchFrom call.
 */
function decodeDirectDispatch(input: `0x${string}`): DispatchCalldata | null {
  try {
    const decoded = decodeFunctionData({
      abi: panopticPoolV2Abi,
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

/**
 * 4-byte function selectors for dispatch/dispatchFrom, derived from the generated ABI.
 * Used for scanning raw calldata inside smart contract wallet wrappers.
 */
const DISPATCH_SELECTOR = toFunctionSelector(
  panopticPoolV2Abi.find((e) => e.type === 'function' && e.name === 'dispatch') as AbiFunction,
).slice(2) // strip 0x prefix for hex scanning

const DISPATCH_FROM_SELECTOR = toFunctionSelector(
  panopticPoolV2Abi.find((e) => e.type === 'function' && e.name === 'dispatchFrom') as AbiFunction,
).slice(2)

/**
 * Scan raw transaction input for embedded dispatch calldata.
 *
 * Smart contract wallets (Safe, Turnkey, ERC-4337) and vault managers
 * wrap dispatch calls inside executeBatch → manage → dispatch chains.
 * Instead of decoding each wrapper layer, we scan the raw hex for the
 * dispatch function selector and attempt to decode from that offset.
 *
 * This handles arbitrary nesting depth without knowing wrapper ABIs.
 */
function decodeWrappedDispatch(input: `0x${string}`): DispatchCalldata | null {
  const hex = input.slice(2).toLowerCase()
  const selectors = [DISPATCH_SELECTOR, DISPATCH_FROM_SELECTOR]

  // Single left-to-right pass: find the earliest selector match at each offset,
  // collect all successful decodes, and return the last one (deepest nesting).
  const results: DispatchCalldata[] = []
  let offset = 0

  while (offset < hex.length) {
    // Find the nearest selector match from current offset
    let earliestIdx = -1
    for (const selector of selectors) {
      const idx = hex.indexOf(selector, offset)
      if (idx !== -1 && (earliestIdx === -1 || idx < earliestIdx)) {
        earliestIdx = idx
      }
    }
    if (earliestIdx === -1) break

    const candidate = `0x${hex.slice(earliestIdx)}` as `0x${string}`
    const result = decodeDirectDispatch(candidate)
    if (result) results.push(result)

    offset = earliestIdx + 8 // Move past this selector
  }

  // Return the last successful decode (innermost / deepest nested call)
  return results.length > 0 ? results[results.length - 1] : null
}
