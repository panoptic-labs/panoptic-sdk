import { ORACLE_EPOCH_SECONDS } from './constants'

const ORACLE_EPOCH_SHIFT = 232n
const ORACLE_EPOCH_MASK = (1n << 24n) - 1n
const ORACLE_TICK_MASK = (1n << 22n) - 1n

function decodeSigned22(value: bigint): bigint {
  const signBit = 1n << 21n
  const truncated = value & ORACLE_TICK_MASK
  return (truncated & signBit) === 0n ? truncated : truncated - (1n << 22n)
}

/** Timing decoded from an OraclePack and resolved against a specific block. */
export interface OracleTiming {
  /** Modulo-2^24 oracle epoch stored on-chain. */
  epoch: bigint
  /** Absolute epoch-boundary timestamp reconstructed at or before the supplied block. */
  timestamp: bigint
}

/** Fixed-width oracle state decoded from an OraclePack. */
export interface DecodedOraclePack {
  referenceTick: bigint
  lockMode: bigint
  spotEMA: bigint
  fastEMA: bigint
  slowEMA: bigint
  eonsEMA: bigint
  epoch: bigint
  timestamp: bigint
}

/**
 * Decode the 24-bit epoch stored at bits 232..255 of OraclePack.
 *
 * The packed timestamp is modulo 2^30 seconds and only identifies an absolute
 * Unix timestamp within the wrap window containing `blockTimestamp`. Supplying
 * the relevant block timestamp resolves it to the latest matching epoch at or
 * before that block, including across the epoch counter wraparound.
 */
export function decodeOracleTiming(oraclePack: bigint, blockTimestamp: bigint): OracleTiming {
  const epoch = (oraclePack >> ORACLE_EPOCH_SHIFT) & ORACLE_EPOCH_MASK
  const currentEpoch = oracleEpochAt(blockTimestamp)
  const elapsedEpochs = (currentEpoch - epoch) & ORACLE_EPOCH_MASK
  const currentEpochTimestamp = blockTimestamp - (blockTimestamp % ORACLE_EPOCH_SECONDS)
  return { epoch, timestamp: currentEpochTimestamp - elapsedEpochs * ORACLE_EPOCH_SECONDS }
}

/** Decode the fixed-width ticks and guardian state stored in OraclePack. */
export function decodeOraclePack(oraclePack: bigint, blockTimestamp: bigint): DecodedOraclePack {
  const timing = decodeOracleTiming(oraclePack, blockTimestamp)
  return {
    referenceTick: decodeSigned22(oraclePack >> 96n),
    lockMode: (oraclePack >> 118n) & 3n,
    spotEMA: decodeSigned22(oraclePack >> 120n),
    fastEMA: decodeSigned22(oraclePack >> 142n),
    slowEMA: decodeSigned22(oraclePack >> 164n),
    eonsEMA: decodeSigned22(oraclePack >> 186n),
    ...timing,
  }
}

/** Return the contract's modulo-2^24 64-second epoch for a block timestamp. */
export function oracleEpochAt(timestamp: bigint): bigint {
  return (timestamp / ORACLE_EPOCH_SECONDS) & ORACLE_EPOCH_MASK
}
