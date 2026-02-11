/**
 * Position types for the Panoptic v2 SDK.
 * @module v2/types/position
 */

import type { Address } from 'viem'

import type { BlockMeta } from './meta'

/**
 * A single leg of a TokenId.
 */
export interface TokenIdLeg {
  /** Leg index (0-3) */
  index: bigint
  /** Asset index (0 or 1) */
  asset: bigint
  /** Option ratio (1-127) */
  optionRatio: bigint
  /** Whether this is a long position (true) or short (false) */
  isLong: boolean
  /** Token type (0 or 1) - which token is being moved */
  tokenType: bigint
  /** Risk partner leg index (for spreads) */
  riskPartner: bigint
  /** Strike tick (center of the range) */
  strike: bigint
  /** Width in tick spacing units */
  width: bigint
  /** Lower tick of the range */
  tickLower: bigint
  /** Upper tick of the range */
  tickUpper: bigint
}

/**
 * Position data.
 */
export interface Position {
  /** The TokenId (256-bit identifier) */
  tokenId: bigint
  /** Position size (number of contracts) */
  positionSize: bigint
  /** Owner address */
  owner: Address
  /** Pool address */
  poolAddress: Address
  /** Decoded legs */
  legs: TokenIdLeg[]
  /** Pool utilization for token 0 at mint (0-10000 bps) */
  poolUtilization0AtMint: bigint
  /** Pool utilization for token 1 at mint (0-10000 bps) */
  poolUtilization1AtMint: bigint
  /** Tick at the time of minting */
  tickAtMint: bigint
  /** Timestamp at the time of minting (Unix seconds) */
  timestampAtMint: bigint
  /** Block number at the time of minting */
  blockNumberAtMint: bigint
  /** Whether a swap occurred at mint */
  swapAtMint: boolean
  /** Accumulated premia owed for token 0 */
  premiaOwed0: bigint
  /** Accumulated premia owed for token 1 */
  premiaOwed1: bigint
  /** Whether this is an optimistic pending position */
  pending?: boolean
  /** Asset index used for greek calculations */
  assetIndex: bigint
  /** Block metadata */
  _meta: BlockMeta
}

/**
 * Parameters for client-side leg greek calculations.
 */
export interface LegGreeksParams {
  /** The leg to calculate greeks for */
  leg: TokenIdLeg
  /** Current tick */
  tick: bigint
  /** Tick at mint (for value calculation) */
  mintTick?: bigint
  /** Asset index (0 or 1) */
  assetIndex: bigint
  /** Whether this is a defined risk position */
  definedRisk: boolean
}

/**
 * Position greeks (value, delta, gamma).
 */
export interface PositionGreeks {
  /** Position value in numeraire token units */
  value: bigint
  /** Position delta in numeraire token units */
  delta: bigint
  /** Position gamma in numeraire token units */
  gamma: bigint
}

/**
 * Closed position data for trade history.
 */
export interface ClosedPosition {
  /** The TokenId */
  tokenId: bigint
  /** Owner address */
  owner: Address
  /** Pool address */
  poolAddress: Address
  /** Position size at close */
  positionSize: bigint
  /** Open block number */
  openBlock: bigint
  /** Close block number */
  closeBlock: bigint
  /** Open timestamp */
  openTimestamp: bigint
  /** Close timestamp */
  closeTimestamp: bigint
  /** Tick at open */
  tickAtOpen: bigint
  /** Tick at close */
  tickAtClose: bigint
  /** Realized PnL for token 0 */
  realizedPnL0: bigint
  /** Realized PnL for token 1 */
  realizedPnL1: bigint
  /** Total premia collected for token 0 */
  premiaCollected0: bigint
  /** Total premia collected for token 1 */
  premiaCollected1: bigint
  /** Closure reason */
  closureReason: 'closed' | 'liquidated' | 'force_exercised'
}

/**
 * Realized PnL summary for an account.
 */
export interface RealizedPnL {
  /** Total realized PnL for token 0 */
  total0: bigint
  /** Total realized PnL for token 1 */
  total1: bigint
  /** Number of closed positions */
  positionCount: bigint
  /** Number of winning positions */
  winCount: bigint
  /** Number of losing positions */
  lossCount: bigint
}

/**
 * Stored position data (immutable fields only, no block metadata).
 * Used for caching position data in storage.
 */
export interface StoredPositionData {
  /** The TokenId (256-bit identifier) */
  tokenId: bigint
  /** Position size (number of contracts) */
  positionSize: bigint
  /** Decoded legs */
  legs: TokenIdLeg[]
  /** Tick at the time of minting */
  tickAtMint: bigint
  /** Pool utilization for token 0 at mint (0-10000 bps) */
  poolUtilization0AtMint: bigint
  /** Pool utilization for token 1 at mint (0-10000 bps) */
  poolUtilization1AtMint: bigint
  /** Timestamp at the time of minting (Unix seconds) */
  timestampAtMint: bigint
  /** Block number at the time of minting */
  blockNumberAtMint: bigint
  /** Whether a swap occurred at mint */
  swapAtMint: boolean
}

/**
 * Stored pool metadata (immutable fields fetched from chain).
 * Does NOT include poolAddress/chainId as those are storage key components.
 */
export interface StoredPoolMeta {
  // From PoolKey
  /** Pool tick spacing */
  tickSpacing: bigint
  /** Pool fee tier */
  fee: bigint

  // Pool identifier (derived from poolKey)
  /** Pool ID */
  poolId: bigint

  // Addresses (immutable once deployed)
  /** Collateral tracker 0 address */
  collateralToken0Address: Address
  /** Collateral tracker 1 address */
  collateralToken1Address: Address
  /** Risk engine address */
  riskEngineAddress: Address
  /** Token 0 underlying asset address */
  token0Asset: Address
  /** Token 1 underlying asset address */
  token1Asset: Address

  // Token metadata (immutable)
  /** Token 0 symbol */
  token0Symbol: string
  /** Token 1 symbol */
  token1Symbol: string
  /** Token 0 decimals */
  token0Decimals: bigint
  /** Token 1 decimals */
  token1Decimals: bigint
}
