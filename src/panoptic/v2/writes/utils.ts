/**
 * Write utilities for the Panoptic v2 SDK.
 * @module v2/writes/utils
 */

import type { Abi, Address, Hash, Log, PublicClient, WalletClient } from 'viem'
import { decodeEventLog, encodeFunctionData } from 'viem'

import { collateralTrackerAbi, panopticPoolAbi } from '../../../generated'
import type { PanopticEvent, TxOverrides, TxReceipt, TxResult } from '../types'

/**
 * Decode PositionBalance packed data.
 *
 * Layout (from LSB to MSB):
 * - positionSize:     bits 0-127   (uint128)
 * - poolUtilization0: bits 128-143 (uint16)
 * - poolUtilization1: bits 144-159 (uint16)
 * - tickAtMint:       bits 160-183 (int24)
 * - timestampAtMint:  bits 184-215 (uint32)
 * - blockAtMint:      bits 216-254 (uint39)
 * - swapAtMint:       bit 255      (bool)
 */
export function decodePositionBalance(balanceData: bigint): {
  positionSize: bigint
  poolUtilization0: bigint
  poolUtilization1: bigint
  tickAtMint: bigint
  timestampAtMint: bigint
  blockAtMint: bigint
  swapAtMint: boolean
} {
  const positionSize = balanceData & ((1n << 128n) - 1n)
  const poolUtilization0 = (balanceData >> 128n) & 0xffffn
  const poolUtilization1 = (balanceData >> 144n) & 0xffffn

  // tickAtMint is int24 at bits 160-183
  let tickAtMint = (balanceData >> 160n) & 0xffffffn
  // Sign extend if negative (int24)
  if (tickAtMint > 0x7fffffn) {
    tickAtMint = tickAtMint - 0x1000000n
  }

  // timestampAtMint is uint32 at bits 184-215
  const timestampAtMint = (balanceData >> 184n) & 0xffffffffn

  // blockAtMint is uint39 at bits 216-254
  const blockAtMint = (balanceData >> 216n) & ((1n << 39n) - 1n)

  // swapAtMint is bool at bit 255
  const swapAtMint = balanceData >> 255n === 1n

  return {
    positionSize,
    poolUtilization0,
    poolUtilization1,
    tickAtMint,
    timestampAtMint,
    blockAtMint,
    swapAtMint,
  }
}

/**
 * Decode LeftRightSigned packed value.
 */
export function decodeLeftRightSigned(value: bigint): { right: bigint; left: bigint } {
  // Right is bits 0-127 (token0), Left is bits 128-255 (token1)
  // Both are signed int128
  let right = value & ((1n << 128n) - 1n)
  let left = value >> 128n

  // Sign extend right if needed
  if (right >= 1n << 127n) {
    right = right - (1n << 128n)
  }
  // Sign extend left if needed
  if (left >= 1n << 127n) {
    left = left - (1n << 128n)
  }

  return { right, left }
}

/**
 * Decode LeftRightUnsigned packed value.
 */
export function decodeLeftRightUnsigned(value: bigint): { right: bigint; left: bigint } {
  // Right is bits 0-127 (token0), Left is bits 128-255 (token1)
  // Both are unsigned uint128
  const right = value & ((1n << 128n) - 1n)
  const left = value >> 128n

  return { right, left }
}

/**
 * Parse Panoptic events from transaction logs.
 *
 * @param logs - The transaction logs
 * @returns Parsed Panoptic events
 */
export function parsePanopticEvents(logs: Log[]): PanopticEvent[] {
  const events: PanopticEvent[] = []

  // Try to decode each log with known ABIs
  for (const log of logs) {
    const baseEvent = {
      blockNumber: log.blockNumber ?? 0n,
      blockHash: (log.blockHash ??
        '0x0000000000000000000000000000000000000000000000000000000000000000') as Hash,
      transactionHash: log.transactionHash ?? ('0x' as Hash),
      logIndex: BigInt(log.logIndex ?? 0),
    }

    try {
      // Try PanopticPool events
      const poolEvent = decodeEventLog({
        abi: panopticPoolAbi,
        data: log.data,
        topics: log.topics,
      })

      if (poolEvent.eventName === 'OptionMinted') {
        const args = poolEvent.args as {
          recipient: `0x${string}`
          tokenId: bigint
          balanceData: bigint
        }
        const balance = decodePositionBalance(args.balanceData)
        events.push({
          type: 'OptionMinted',
          ...baseEvent,
          recipient: args.recipient,
          tokenId: args.tokenId,
          positionSize: balance.positionSize,
          poolUtilization0: balance.poolUtilization0,
          poolUtilization1: balance.poolUtilization1,
          tickAtMint: balance.tickAtMint,
          timestampAtMint: balance.timestampAtMint,
          blockAtMint: balance.blockAtMint,
          swapAtMint: balance.swapAtMint,
        })
      } else if (poolEvent.eventName === 'OptionBurnt') {
        const args = poolEvent.args as {
          recipient: `0x${string}`
          tokenId: bigint
          positionSize: bigint
          premiaByLeg: readonly bigint[]
        }
        events.push({
          type: 'OptionBurnt',
          ...baseEvent,
          recipient: args.recipient,
          tokenId: args.tokenId,
          positionSize: args.positionSize,
          premiaByLeg: [
            args.premiaByLeg[0] ?? 0n,
            args.premiaByLeg[1] ?? 0n,
            args.premiaByLeg[2] ?? 0n,
            args.premiaByLeg[3] ?? 0n,
          ] as const,
        })
      } else if (poolEvent.eventName === 'AccountLiquidated') {
        const args = poolEvent.args as {
          liquidator: `0x${string}`
          liquidatee: `0x${string}`
          bonusAmounts: bigint
        }
        const { right, left } = decodeLeftRightSigned(args.bonusAmounts)
        events.push({
          type: 'AccountLiquidated',
          ...baseEvent,
          liquidator: args.liquidator,
          liquidatee: args.liquidatee,
          bonusAmount0: right,
          bonusAmount1: left,
        })
      } else if (poolEvent.eventName === 'ForcedExercised') {
        const args = poolEvent.args as {
          exercisor: `0x${string}`
          user: `0x${string}`
          tokenId: bigint
          exerciseFee: bigint
        }
        const { right, left } = decodeLeftRightSigned(args.exerciseFee)
        events.push({
          type: 'ForcedExercised',
          ...baseEvent,
          exercisor: args.exercisor,
          user: args.user,
          tokenId: args.tokenId,
          exerciseFee0: right,
          exerciseFee1: left,
        })
      } else if (poolEvent.eventName === 'PremiumSettled') {
        const args = poolEvent.args as {
          user: `0x${string}`
          tokenId: bigint
          legIndex: bigint
          settledAmounts: bigint
        }
        const { right, left } = decodeLeftRightSigned(args.settledAmounts)
        events.push({
          type: 'PremiumSettled',
          ...baseEvent,
          user: args.user,
          tokenId: args.tokenId,
          legIndex: args.legIndex,
          settledAmount0: right,
          settledAmount1: left,
        })
      }
    } catch {
      // Not a PanopticPool event, try CollateralTracker
      try {
        const collateralEvent = decodeEventLog({
          abi: collateralTrackerAbi,
          data: log.data,
          topics: log.topics,
        })

        if (collateralEvent.eventName === 'Deposit') {
          const args = collateralEvent.args as {
            sender: `0x${string}`
            owner: `0x${string}`
            assets: bigint
            shares: bigint
          }
          events.push({
            type: 'Deposit',
            ...baseEvent,
            sender: args.sender,
            owner: args.owner,
            assets: args.assets,
            shares: args.shares,
          })
        } else if (collateralEvent.eventName === 'Withdraw') {
          const args = collateralEvent.args as {
            sender: `0x${string}`
            receiver: `0x${string}`
            owner: `0x${string}`
            assets: bigint
            shares: bigint
          }
          events.push({
            type: 'Withdraw',
            ...baseEvent,
            sender: args.sender,
            receiver: args.receiver,
            owner: args.owner,
            assets: args.assets,
            shares: args.shares,
          })
        }
      } catch {
        // Unknown event, skip
      }
    }
  }

  return events
}

/**
 * Create a TxResult from a transaction hash.
 *
 * @param client - The public client
 * @param hash - The transaction hash
 * @returns TxResult with wait function
 */
export function createTxResult(client: PublicClient, hash: Hash): TxResult {
  return {
    hash,
    wait: async (confirmations?: bigint): Promise<TxReceipt> => {
      const receipt = await client.waitForTransactionReceipt({
        hash,
        confirmations: confirmations !== undefined ? Number(confirmations) : undefined,
      })

      const events = parsePanopticEvents(receipt.logs)

      return {
        hash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
        gasUsed: receipt.gasUsed,
        status: receipt.status === 'success' ? 'success' : 'reverted',
        events,
      }
    },
  }
}

/**
 * Execute a write operation and return TxResult.
 *
 * @param client - The public client
 * @param hashPromise - Promise that resolves to transaction hash
 * @returns TxResult
 */
export async function executeWrite(
  client: PublicClient,
  hashPromise: Promise<Hash>,
): Promise<TxResult> {
  const hash = await hashPromise
  return createTxResult(client, hash)
}

/**
 * Execute a write operation and wait for receipt.
 *
 * @param client - The public client
 * @param hashPromise - Promise that resolves to transaction hash
 * @param confirmations - Number of confirmations to wait for
 * @returns TxReceipt
 */
export async function executeWriteAndWait(
  client: PublicClient,
  hashPromise: Promise<Hash>,
  confirmations?: bigint,
): Promise<TxReceipt> {
  const result = await executeWrite(client, hashPromise)
  return result.wait(confirmations)
}

/**
 * Parameters for the submitWrite helper.
 */
export interface SubmitWriteParams {
  /** Public client */
  client: PublicClient
  /** Wallet client */
  walletClient: WalletClient
  /** Account address */
  account: Address
  /** Contract address */
  address: Address
  /** Contract ABI */
  abi: Abi
  /** Function name to call */
  functionName: string
  /** Function arguments */
  args: readonly unknown[]
  /** Optional gas and transaction overrides */
  txOverrides?: TxOverrides
}

/**
 * Submit a write operation, supporting both direct wallet submission
 * and custom broadcaster paths with gas overrides.
 *
 * Normal path (no broadcaster): calls walletClient.writeContract() with gas overrides.
 * Broadcaster path: prepareTransactionRequest → apply overrides → signTransaction → broadcast.
 *
 * @param params - Submit write parameters
 * @returns TxResult
 */
export async function submitWrite(params: SubmitWriteParams): Promise<TxResult> {
  const { client, walletClient, account, address, abi, functionName, args, txOverrides } = params

  const broadcaster = txOverrides?.broadcaster

  if (broadcaster) {
    // Encode contract calldata before request preparation so gas/tx params
    // are derived from the exact call being signed and broadcast.
    const data = encodeFunctionData({ abi, functionName, args })

    // Broadcaster path: prepare → sign → broadcast
    const request = await walletClient.prepareTransactionRequest({
      account,
      to: address,
      chain: walletClient.chain,
      data,
      ...(txOverrides?.maxFeePerGas !== undefined && { maxFeePerGas: txOverrides.maxFeePerGas }),
      ...(txOverrides?.maxPriorityFeePerGas !== undefined && {
        maxPriorityFeePerGas: txOverrides.maxPriorityFeePerGas,
      }),
      ...(txOverrides?.gas !== undefined && { gas: txOverrides.gas }),
      ...(txOverrides?.nonce !== undefined && { nonce: Number(txOverrides.nonce) }),
    })

    const signedTx = await walletClient.signTransaction({
      ...request,
      account,
    } as unknown as Parameters<WalletClient['signTransaction']>[0])

    const hash = await broadcaster.broadcast(signedTx)
    return createTxResult(client, hash)
  }

  // Normal path: direct writeContract with gas overrides
  const gasOverrides: Record<string, unknown> = {}
  if (txOverrides?.maxFeePerGas !== undefined) {
    gasOverrides.maxFeePerGas = txOverrides.maxFeePerGas
  }
  if (txOverrides?.maxPriorityFeePerGas !== undefined) {
    gasOverrides.maxPriorityFeePerGas = txOverrides.maxPriorityFeePerGas
  }
  if (txOverrides?.gas !== undefined) {
    gasOverrides.gas = txOverrides.gas
  }
  if (txOverrides?.nonce !== undefined) {
    gasOverrides.nonce = Number(txOverrides.nonce)
  }

  const hash = await walletClient.writeContract({
    address,
    abi,
    functionName,
    args,
    account,
    chain: walletClient.chain,
    ...gasOverrides,
  })

  return createTxResult(client, hash)
}

/**
 * Parameters required for all write operations.
 */
export interface BaseWriteParams {
  /** Public client for reading state */
  client: PublicClient
}
