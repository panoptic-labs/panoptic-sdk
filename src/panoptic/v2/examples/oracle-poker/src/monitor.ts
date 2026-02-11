/**
 * Oracle monitoring logic for determining when to poke
 */

import type { Address, PublicClient } from 'viem'

import { getOracleState } from '../../../index'
import type { Logger } from './logger'

const ORACLE_EPOCH_SECONDS = 64n

export interface OracleStatus {
  /** Pool address */
  poolAddress: Address
  /** Whether oracle needs poking */
  needsPoke: boolean
  /** Current epoch */
  currentEpoch: bigint
  /** Oracle's last update epoch */
  oracleEpoch: bigint
  /** Seconds since last update */
  secondsSinceUpdate: bigint
  /** Seconds until next poke is allowed */
  secondsUntilNextPoke: bigint
}

/**
 * Check if an oracle needs to be poked.
 *
 * The oracle can be poked if at least 64 seconds (1 epoch) have passed
 * since the last update.
 */
export async function checkOracleStatus(
  client: PublicClient,
  poolAddress: Address,
  logger: Logger,
): Promise<OracleStatus> {
  try {
    logger.debug(`Checking oracle status for pool ${poolAddress}`)

    // Fetch oracle state and current block
    const [oracleState, block] = await Promise.all([
      getOracleState({ client, poolAddress }),
      client.getBlock(),
    ])

    const currentTimestamp = block.timestamp
    const currentEpoch = currentTimestamp / ORACLE_EPOCH_SECONDS
    const oracleEpoch = oracleState.epoch

    const secondsSinceUpdate = currentTimestamp - oracleState.lastUpdateTimestamp
    const needsPoke = currentEpoch > oracleEpoch

    // Calculate when next poke is allowed
    const nextPokeTimestamp = oracleState.lastUpdateTimestamp + ORACLE_EPOCH_SECONDS
    const secondsUntilNextPoke =
      nextPokeTimestamp > currentTimestamp ? nextPokeTimestamp - currentTimestamp : 0n

    logger.debug(
      `Pool ${poolAddress}: currentEpoch=${currentEpoch}, oracleEpoch=${oracleEpoch}, ` +
        `secondsSinceUpdate=${secondsSinceUpdate}, needsPoke=${needsPoke}`,
    )

    return {
      poolAddress,
      needsPoke,
      currentEpoch,
      oracleEpoch,
      secondsSinceUpdate,
      secondsUntilNextPoke,
    }
  } catch (error) {
    logger.error(`Failed to check oracle status for pool ${poolAddress}:`, error)
    throw error
  }
}

/**
 * Check all pools and return those that need poking.
 */
export async function checkAllPools(
  client: PublicClient,
  poolAddresses: Address[],
  logger: Logger,
): Promise<OracleStatus[]> {
  logger.debug(`Checking ${poolAddresses.length} pools...`)

  // Check all pools in parallel
  const statuses = await Promise.all(
    poolAddresses.map((poolAddress) => checkOracleStatus(client, poolAddress, logger)),
  )

  const needsPokeCount = statuses.filter((s) => s.needsPoke).length

  if (needsPokeCount > 0) {
    logger.info(`Found ${needsPokeCount} pool(s) that need poking`)
  } else {
    logger.debug('No pools need poking at this time')
  }

  return statuses
}
