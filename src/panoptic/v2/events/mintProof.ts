import type { Address, Hash, PublicClient } from 'viem'
import { getAbiItem, isAddressEqual, parseEventLogs } from 'viem'

import { panopticPoolV2Abi } from '../../../generated'
import { decodeAllLegs } from '../tokenId/encoding'
import { decodePositionBalance } from '../writes/utils'

const POOL_MASK = (1n << 64n) - 1n

/** Match active legs, ignoring their order and risk-partner links. */
export function mintedLegsEqualPosition(minted: bigint, position: bigint): boolean {
  if ((minted & POOL_MASK) !== (position & POOL_MASK)) return false
  const keys = (id: bigint) =>
    decodeAllLegs(id)
      .map((leg) =>
        [leg.asset, leg.optionRatio, leg.isLong, leg.tokenType, leg.strike, leg.width].join(':'),
      )
      .sort()
  const actual = keys(minted)
  const expected = keys(position)
  return (
    actual.length > 0 &&
    actual.length === expected.length &&
    actual.every((v, i) => v === expected[i])
  )
}

/** Match every long chunk by pool, tick range and token type, independently of size denomination. */
export function mintedShortsCoverPosition(minted: bigint, position: bigint): boolean {
  if ((minted & POOL_MASK) !== (position & POOL_MASK)) return false
  const shorts = decodeAllLegs(minted).filter((leg) => !leg.isLong && leg.width > 0n)
  const longs = decodeAllLegs(position).filter((leg) => leg.isLong && leg.width > 0n)
  return (
    longs.length > 0 &&
    longs.every((leg) =>
      shorts.some(
        (short) =>
          short.tokenType === leg.tokenType &&
          short.strike === leg.strike &&
          short.width === leg.width,
      ),
    )
  )
}

export type PositionMintProofParams = {
  client: Pick<PublicClient, 'getTransactionReceipt' | 'getBlock' | 'getBlockNumber'>
  poolAddress: Address
  recipient: Address
  transactionHash: Hash
  tokenId: bigint
  match: 'position' | 'shorts'
}

/** Match any long chunk; opposite asset denominations can supply the same liquidity range. */
export function mintedShortsOverlapPosition(minted: bigint, position: bigint): boolean {
  if ((minted & POOL_MASK) !== (position & POOL_MASK)) return false
  const shorts = decodeAllLegs(minted).filter((leg) => !leg.isLong && leg.width > 0n)
  return decodeAllLegs(position).some(
    (leg) =>
      leg.isLong &&
      leg.width > 0n &&
      shorts.some(
        (short) =>
          short.tokenType === leg.tokenType &&
          short.strike === leg.strike &&
          short.width === leg.width,
      ),
  )
}

/** Return matching mint evidence while awaiting two confirmations; only confirmed proofs are verified. */
export async function getPositionMintProof(params: PositionMintProofParams) {
  const { client, poolAddress, recipient, transactionHash, tokenId, match } = params
  const receipt = await client
    .getTransactionReceipt({ hash: transactionHash })
    .catch((error: unknown) => {
      // Consumers can resolve a different viem installation from the SDK.
      if (error instanceof Error && error.name === 'TransactionReceiptNotFoundError') return null
      throw error
    })
  if (receipt === null) return { status: 'pending', reason: 'receipt_not_found' } as const
  if (receipt.status !== 'success') return { status: 'rejected', reason: 'reverted' } as const
  const matches = match === 'shorts' ? mintedShortsOverlapPosition : mintedLegsEqualPosition
  const logs = parseEventLogs({
    abi: panopticPoolV2Abi,
    eventName: 'OptionMinted',
    logs: receipt.logs.filter((log) => isAddressEqual(log.address, poolAddress)),
  }).filter(
    (log) => isAddressEqual(log.args.recipient, recipient) && matches(log.args.tokenId, tokenId),
  )

  if (logs.length === 0) return { status: 'rejected', reason: 'no_matching_mint' } as const
  const block = await client.getBlock({ blockHash: receipt.blockHash })
  const mints = logs
    .map((log) => ({
      transactionHash: receipt.transactionHash,
      logIndex: log.logIndex,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      timestamp: block.timestamp,
      recipient: log.args.recipient,
      tokenId: log.args.tokenId,
      balanceData: log.args.balanceData,
      ...decodePositionBalance(log.args.balanceData),
    }))
    .filter((mint) => mint.positionSize > 0n)

  if (mints.length === 0) return { status: 'rejected', reason: 'zero_size' } as const
  const head = await client.getBlockNumber()
  if (head < receipt.blockNumber + 1n)
    return { status: 'pending', reason: 'confirmations', mints } as const
  return { status: 'verified', mints } as const
}

/** Bounded, account-filtered mint history for reconciliation and attribution. */
export async function getPositionMintHistory(params: {
  client: Pick<PublicClient, 'getLogs'>
  poolAddress: Address
  recipient: Address
  fromBlock: bigint
  toBlock: bigint
}) {
  const { client, poolAddress, recipient, fromBlock, toBlock } = params
  const event = getAbiItem({ abi: panopticPoolV2Abi, name: 'OptionMinted' })
  const mints = []
  for (let start = fromBlock; start <= toBlock; start += 5000n) {
    const end = start + 4999n < toBlock ? start + 4999n : toBlock
    const logs = await client.getLogs({
      address: poolAddress,
      event,
      args: { recipient },
      fromBlock: start,
      toBlock: end,
      strict: true,
    })
    for (const log of logs) {
      if (log.blockNumber === null || log.transactionHash === null || log.logIndex === null)
        continue
      mints.push({
        transactionHash: log.transactionHash,
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
        tokenId: log.args.tokenId,
        ...decodePositionBalance(log.args.balanceData),
      })
    }
  }
  return mints
}
