/**
 * Event types for the Panoptic v2 SDK.
 * @module v2/types/events
 */

import type { Address, Hash } from 'viem'

/**
 * Supported Panoptic event types.
 */
export type PanopticEventType =
  | 'OptionMinted'
  | 'OptionBurnt'
  | 'AccountLiquidated'
  | 'ForcedExercised'
  | 'PremiumSettled'
  | 'Deposit'
  | 'Withdraw'
  | 'BorrowRateUpdated'
  | 'LiquidityChunkUpdated'
  | 'ProtocolLossRealized'
  | 'ModifyLiquidity'
  | 'Swap'
  | 'Donate'

/**
 * Base event data common to all events.
 */
export interface BaseEvent {
  /** Event type */
  type: PanopticEventType
  /** Transaction hash */
  transactionHash: Hash
  /** Block number */
  blockNumber: bigint
  /** Block hash */
  blockHash: Hash
  /** Log index within the block */
  logIndex: bigint
}

/**
 * OptionMinted event data.
 */
export interface OptionMintedEvent extends BaseEvent {
  type: 'OptionMinted'
  /** Recipient of the minted position */
  recipient: Address
  /** TokenId of the minted position */
  tokenId: bigint
  /** Position size */
  positionSize: bigint
  /** Pool utilization for token 0 at mint */
  poolUtilization0: bigint
  /** Pool utilization for token 1 at mint */
  poolUtilization1: bigint
  /** Tick at mint */
  tickAtMint: bigint
  /** Timestamp at mint (Unix seconds) */
  timestampAtMint: bigint
  /** Block number at mint */
  blockAtMint: bigint
  /** Whether a swap happened at mint */
  swapAtMint: boolean
}

/**
 * OptionBurnt event data.
 */
export interface OptionBurntEvent extends BaseEvent {
  type: 'OptionBurnt'
  /** Recipient (owner) of the burnt position */
  recipient: Address
  /** TokenId of the burnt position */
  tokenId: bigint
  /** Position size that was burnt */
  positionSize: bigint
  /** Premia settled for each leg (token0 right, token1 left per leg) */
  premiaByLeg: readonly [bigint, bigint, bigint, bigint]
}

/**
 * AccountLiquidated event data.
 */
export interface AccountLiquidatedEvent extends BaseEvent {
  type: 'AccountLiquidated'
  /** Address of the liquidator */
  liquidator: Address
  /** Address of the liquidated account */
  liquidatee: Address
  /** Bonus paid to liquidator for token 0 */
  bonusAmount0: bigint
  /** Bonus paid to liquidator for token 1 */
  bonusAmount1: bigint
}

/**
 * ForcedExercised event data.
 */
export interface ForcedExercisedEvent extends BaseEvent {
  type: 'ForcedExercised'
  /** Address of the exerciser */
  exercisor: Address
  /** Address of the position owner */
  user: Address
  /** TokenId of the exercised position */
  tokenId: bigint
  /** Exercise fee for token 0 (negative = cost to exerciser) */
  exerciseFee0: bigint
  /** Exercise fee for token 1 (negative = cost to exerciser) */
  exerciseFee1: bigint
}

/**
 * PremiumSettled event data.
 */
export interface PremiumSettledEvent extends BaseEvent {
  type: 'PremiumSettled'
  /** Position owner */
  user: Address
  /** TokenId */
  tokenId: bigint
  /** Leg index that was settled */
  legIndex: bigint
  /** Settled amount for token 0 */
  settledAmount0: bigint
  /** Settled amount for token 1 */
  settledAmount1: bigint
}

/**
 * Deposit event data (ERC4626).
 */
export interface DepositEvent extends BaseEvent {
  type: 'Deposit'
  /** Sender address */
  sender: Address
  /** Owner address */
  owner: Address
  /** Assets deposited */
  assets: bigint
  /** Shares minted */
  shares: bigint
}

/**
 * Withdraw event data (ERC4626).
 */
export interface WithdrawEvent extends BaseEvent {
  type: 'Withdraw'
  /** Sender address */
  sender: Address
  /** Receiver address */
  receiver: Address
  /** Owner address */
  owner: Address
  /** Assets withdrawn */
  assets: bigint
  /** Shares burned */
  shares: bigint
}

/**
 * BorrowRateUpdated event data (RiskEngine).
 */
export interface BorrowRateUpdatedEvent extends BaseEvent {
  type: 'BorrowRateUpdated'
  /** Collateral token address */
  collateralToken: Address
  /** Average borrow rate */
  avgBorrowRate: bigint
  /** Rate at target utilization */
  rateAtTarget: bigint
}

/**
 * LiquidityChunkUpdated event data (SFPM).
 */
export interface LiquidityChunkUpdatedEvent extends BaseEvent {
  type: 'LiquidityChunkUpdated'
  /** Pool ID (bytes32) */
  poolId: Hash
  /** Owner address */
  owner: Address
  /** Token type (0 or 1) */
  tokenType: bigint
  /** Lower tick */
  tickLower: number
  /** Upper tick */
  tickUpper: number
  /** Liquidity delta (positive = added, negative = removed) */
  liquidityDelta: bigint
}

/**
 * ProtocolLossRealized event data (CollateralTracker).
 */
export interface ProtocolLossRealizedEvent extends BaseEvent {
  type: 'ProtocolLossRealized'
  /** Liquidated account */
  liquidatee: Address
  /** Liquidator address */
  liquidator: Address
  /** Protocol loss in assets */
  protocolLossAssets: bigint
  /** Protocol loss in shares */
  protocolLossShares: bigint
}

/**
 * ModifyLiquidity event data (v4 PoolManager).
 */
export interface ModifyLiquidityEvent extends BaseEvent {
  type: 'ModifyLiquidity'
  /** Pool ID (bytes32) */
  id: Hash
  /** Sender address */
  sender: Address
  /** Lower tick */
  tickLower: number
  /** Upper tick */
  tickUpper: number
  /** Liquidity delta */
  liquidityDelta: bigint
  /** Salt */
  salt: Hash
}

/**
 * Swap event data (v4 PoolManager).
 */
export interface SwapEvent extends BaseEvent {
  type: 'Swap'
  /** Pool ID (bytes32) */
  id: Hash
  /** Sender address */
  sender: Address
  /** Amount of token 0 */
  amount0: bigint
  /** Amount of token 1 */
  amount1: bigint
  /** Square root price X96 */
  sqrtPriceX96: bigint
  /** Liquidity */
  liquidity: bigint
  /** Tick */
  tick: number
  /** Fee */
  fee: number
}

/**
 * Donate event data (v4 PoolManager).
 */
export interface DonateEvent extends BaseEvent {
  type: 'Donate'
  /** Pool ID (bytes32) */
  id: Hash
  /** Sender address */
  sender: Address
  /** Amount of token 0 */
  amount0: bigint
  /** Amount of token 1 */
  amount1: bigint
}

/**
 * Union of all Panoptic event types.
 */
export type PanopticEvent =
  | OptionMintedEvent
  | OptionBurntEvent
  | AccountLiquidatedEvent
  | ForcedExercisedEvent
  | PremiumSettledEvent
  | DepositEvent
  | WithdrawEvent
  | BorrowRateUpdatedEvent
  | LiquidityChunkUpdatedEvent
  | ProtocolLossRealizedEvent
  | ModifyLiquidityEvent
  | SwapEvent
  | DonateEvent

/**
 * Leg update data from events.
 */
export interface LegUpdate {
  /** Leg index */
  legIndex: bigint
  /** Liquidity delta (positive = added, negative = removed) */
  liquidityDelta: bigint
  /** Token 0 delta */
  amount0Delta: bigint
  /** Token 1 delta */
  amount1Delta: bigint
}

/**
 * Event subscription handle.
 */
export interface EventSubscription {
  /** Unsubscribe from events */
  unsubscribe: () => void
  /** Current connection status */
  isConnected: () => boolean
}

/**
 * Sync progress event for syncPositions callback.
 */
export interface SyncEvent {
  /** Current block being processed */
  currentBlock: bigint
  /** Target block to sync to */
  targetBlock: bigint
  /** Number of positions discovered so far */
  positionsFound: bigint
  /** Percentage complete (0-100) */
  progress: bigint
}
