/**
 * Contract errors from Errors.sol mapped to TypeScript classes.
 * @module v2/errors/contract
 */

import type { Address } from 'viem'

import { PanopticError } from './base'

// ─────────────────────────────────────────────────────────────
// Solvency & Margin Errors
// ─────────────────────────────────────────────────────────────

/**
 * The account is not solvent enough to perform the desired action.
 * @see Errors.sol:9
 */
export class AccountInsolventError extends PanopticError {
  override readonly name = 'AccountInsolventError'

  constructor(
    public readonly solvent: bigint,
    public readonly numberOfTicks: bigint,
    cause?: Error,
  ) {
    super(`Account insolvent: solvent=${solvent}, numberOfTicks=${numberOfTicks}`, cause)
  }
}

/**
 * Position is still solvent and cannot be liquidated.
 * @see Errors.sol:84
 */
export class NotMarginCalledError extends PanopticError {
  override readonly name = 'NotMarginCalledError'

  constructor(cause?: Error) {
    super('Position is still solvent and cannot be liquidated', cause)
  }
}

// ─────────────────────────────────────────────────────────────
// Token & Collateral Errors
// ─────────────────────────────────────────────────────────────

/**
 * The user does not own enough assets to open/close a position.
 * @see Errors.sol:78
 */
export class NotEnoughTokensError extends PanopticError {
  override readonly name = 'NotEnoughTokensError'

  constructor(
    public readonly tokenAddress: Address,
    public readonly assetsRequested: bigint,
    public readonly assetBalance: bigint,
    cause?: Error,
  ) {
    super(
      `Not enough tokens: requested=${assetsRequested}, balance=${assetBalance}, token=${tokenAddress}`,
      cause,
    )
  }
}

/**
 * There is not enough available liquidity in the chunk for a long leg.
 * @see Errors.sol:75
 */
export class NotEnoughLiquidityInChunkError extends PanopticError {
  override readonly name = 'NotEnoughLiquidityInChunkError'

  constructor(cause?: Error) {
    super('Not enough liquidity in chunk for long leg creation or short leg closure', cause)
  }
}

/**
 * There is not enough available liquidity to fulfill a credit.
 * @see Errors.sol:47
 */
export class InsufficientCreditLiquidityError extends PanopticError {
  override readonly name = 'InsufficientCreditLiquidityError'

  constructor(cause?: Error) {
    super('Insufficient credit liquidity available in the PanopticPool', cause)
  }
}

/**
 * The amount deposited is larger than the maximum permitted.
 * @see Errors.sol:25
 */
export class DepositTooLargeError extends PanopticError {
  override readonly name = 'DepositTooLargeError'

  constructor(cause?: Error) {
    super('Deposit amount exceeds maximum permitted', cause)
  }
}

/**
 * Attempted to withdraw/redeem less than a single asset.
 * @see Errors.sol:16
 */
export class BelowMinimumRedemptionError extends PanopticError {
  override readonly name = 'BelowMinimumRedemptionError'

  constructor(cause?: Error) {
    super('Redemption amount below minimum threshold', cause)
  }
}

/**
 * Attempted to withdraw/redeem more than available.
 * @see Errors.sol:35
 */
export class ExceedsMaximumRedemptionError extends PanopticError {
  override readonly name = 'ExceedsMaximumRedemptionError'

  constructor(cause?: Error) {
    super('Redemption exceeds maximum available (liquidity, shares, or open positions)', cause)
  }
}

/**
 * Mints/burns of a position returns no collateral requirement.
 * @see Errors.sol:141
 */
export class ZeroCollateralRequirementError extends PanopticError {
  override readonly name = 'ZeroCollateralRequirementError'

  constructor(cause?: Error) {
    super('Position mint/burn returned zero collateral requirement', cause)
  }
}

// ─────────────────────────────────────────────────────────────
// Position & TokenId Errors
// ─────────────────────────────────────────────────────────────

/**
 * The TokenId provided is malformed or invalid.
 * @see Errors.sol:54
 */
export class InvalidTokenIdParameterError extends PanopticError {
  override readonly name = 'InvalidTokenIdParameterError'

  /**
   * Parameter type meanings:
   * 0=poolId, 1=ratio, 2=tokenType, 3=riskPartner, 4=strike, 5=width, 6=duplicateChunk
   */
  constructor(
    public readonly parameterType: bigint,
    cause?: Error,
  ) {
    const paramNames = [
      'poolId',
      'ratio',
      'tokenType',
      'riskPartner',
      'strike',
      'width',
      'duplicateChunk',
    ]
    const paramName = paramNames[Number(parameterType)] ?? `unknown(${parameterType})`
    super(`Invalid TokenId parameter: ${paramName}`, cause)
  }
}

/**
 * Position is not owned by the user and has positionSize=0.
 * @see Errors.sol:96
 */
export class PositionNotOwnedError extends PanopticError {
  override readonly name = 'PositionNotOwnedError'

  constructor(cause?: Error) {
    super('Position is not owned by the user', cause)
  }
}

/**
 * The maximum token deltas for a position exceed limits.
 * @see Errors.sol:99
 */
export class PositionTooLargeError extends PanopticError {
  override readonly name = 'PositionTooLargeError'

  constructor(cause?: Error) {
    super('Position size exceeds maximum allowed token deltas', cause)
  }
}

/**
 * User has open positions, so they cannot transfer collateral shares.
 * @see Errors.sol:93
 */
export class PositionCountNotZeroError extends PanopticError {
  override readonly name = 'PositionCountNotZeroError'

  constructor(cause?: Error) {
    super('Cannot transfer collateral shares while positions are open', cause)
  }
}

/**
 * The list of provided TokenIds has a duplicate entry.
 * @see Errors.sol:28
 */
export class DuplicateTokenIdError extends PanopticError {
  override readonly name = 'DuplicateTokenIdError'

  constructor(cause?: Error) {
    super('Duplicate TokenId in provided list', cause)
  }
}

/**
 * The supplied tokenId has no valid legs.
 * @see Errors.sol:144
 */
export class TokenIdHasZeroLegsError extends PanopticError {
  override readonly name = 'TokenIdHasZeroLegsError'

  constructor(cause?: Error) {
    super('TokenId has no valid legs', cause)
  }
}

/**
 * Position would exceed maximum legs open for account.
 * @see Errors.sol:112
 */
export class TooManyLegsOpenError extends PanopticError {
  override readonly name = 'TooManyLegsOpenError'

  constructor(cause?: Error) {
    super('Position would exceed maximum allowed legs open', cause)
  }
}

/**
 * The provided list of option positions is incorrect or invalid.
 * @see Errors.sol:38
 */
export class InputListFailError extends PanopticError {
  override readonly name = 'InputListFailError'

  constructor(cause?: Error) {
    super('Invalid position list provided', cause)
  }
}

// ─────────────────────────────────────────────────────────────
// Tick & Price Errors
// ─────────────────────────────────────────────────────────────

/**
 * Tick is not between MIN_TICK and MAX_TICK.
 * @see Errors.sol:41
 */
export class InvalidTickError extends PanopticError {
  override readonly name = 'InvalidTickError'

  constructor(cause?: Error) {
    super('Tick is outside valid range (MIN_TICK to MAX_TICK)', cause)
  }
}

/**
 * The tick range is invalid (not initializable or exceeds bounds).
 * @see Errors.sol:120
 */
export class InvalidTickBoundError extends PanopticError {
  override readonly name = 'InvalidTickBoundError'

  constructor(cause?: Error) {
    super(
      'Tick range is invalid (not initializable multiples of tickSpacing or exceeds bounds)',
      cause,
    )
  }
}

/**
 * The current tick has fallen outside the slippage range.
 * @see Errors.sol:102
 */
export class PriceBoundFailError extends PanopticError {
  override readonly name = 'PriceBoundFailError'

  constructor(
    public readonly currentTick: bigint,
    cause?: Error,
  ) {
    super(`Price moved outside slippage bounds: currentTick=${currentTick}`, cause)
  }
}

/**
 * The price impact of the trade is too large.
 * @see Errors.sol:105
 */
export class PriceImpactTooLargeError extends PanopticError {
  override readonly name = 'PriceImpactTooLargeError'

  constructor(cause?: Error) {
    super('Price impact of trade exceeds maximum allowed', cause)
  }
}

// ─────────────────────────────────────────────────────────────
// Liquidity Errors
// ─────────────────────────────────────────────────────────────

/**
 * Mints/burns of zero-liquidity chunks are not supported.
 * @see Errors.sol:19
 */
export class ChunkHasZeroLiquidityError extends PanopticError {
  override readonly name = 'ChunkHasZeroLiquidityError'

  constructor(cause?: Error) {
    super('Cannot mint/burn chunk with zero liquidity', cause)
  }
}

/**
 * Liquidity in a chunk is above 2^128.
 * @see Errors.sol:44
 */
export class LiquidityTooHighError extends PanopticError {
  override readonly name = 'LiquidityTooHighError'

  constructor(cause?: Error) {
    super('Liquidity exceeds maximum (2^128)', cause)
  }
}

/**
 * Net liquidity is zero due to small positions.
 * @see Errors.sol:63
 */
export class NetLiquidityZeroError extends PanopticError {
  override readonly name = 'NetLiquidityZeroError'

  constructor(cause?: Error) {
    super('Net liquidity is zero, cannot compute liquidity spread', cause)
  }
}

/**
 * Effective liquidity above threshold during long mint or short burn.
 * @see Errors.sol:32
 */
export class EffectiveLiquidityAboveThresholdError extends PanopticError {
  override readonly name = 'EffectiveLiquidityAboveThresholdError'

  constructor(cause?: Error) {
    super('Effective liquidity above spread threshold', cause)
  }
}

// ─────────────────────────────────────────────────────────────
// Oracle & Safe Mode Errors
// ─────────────────────────────────────────────────────────────

/**
 * An oracle price is too far from another or the current tick.
 * @see Errors.sol:109
 */
export class StaleOracleError extends PanopticError {
  override readonly name = 'StaleOracleError'

  constructor(cause?: Error) {
    super('Oracle price deviation too high (potential manipulation safeguard)', cause)
  }
}

// ─────────────────────────────────────────────────────────────
// Exercise Errors
// ─────────────────────────────────────────────────────────────

/**
 * None of the legs in a position are force-exercisable.
 * @see Errors.sol:66
 */
export class NoLegsExercisableError extends PanopticError {
  override readonly name = 'NoLegsExercisableError'

  constructor(cause?: Error) {
    super('No legs are force-exercisable (all are short or ATM long)', cause)
  }
}

/**
 * The leg is not long, so premium cannot be settled.
 * @see Errors.sol:69
 */
export class NotALongLegError extends PanopticError {
  override readonly name = 'NotALongLegError'

  constructor(cause?: Error) {
    super('Cannot settle premium for non-long leg', cause)
  }
}

// ─────────────────────────────────────────────────────────────
// Pool & Initialization Errors
// ─────────────────────────────────────────────────────────────

/**
 * The Uniswap Pool has not been created.
 * @see Errors.sol:90
 */
export class PoolNotInitializedError extends PanopticError {
  override readonly name = 'PoolNotInitializedError'

  constructor(cause?: Error) {
    super('Uniswap pool not initialized', cause)
  }
}

/**
 * Smart contract has already been initialized.
 * @see Errors.sol:22
 */
export class AlreadyInitializedError extends PanopticError {
  override readonly name = 'AlreadyInitializedError'

  constructor(cause?: Error) {
    super('Contract already initialized', cause)
  }
}

/**
 * The supplied poolId does not match the poolId for that Uniswap Pool.
 * @see Errors.sol:132
 */
export class WrongPoolIdError extends PanopticError {
  override readonly name = 'WrongPoolIdError'

  constructor(cause?: Error) {
    super('Pool ID mismatch', cause)
  }
}

/**
 * The poolId's don't match (SFPM).
 * @see Errors.sol:135
 */
export class WrongUniswapPoolError extends PanopticError {
  override readonly name = 'WrongUniswapPoolError'

  constructor(cause?: Error) {
    super('Uniswap pool mismatch', cause)
  }
}

// ─────────────────────────────────────────────────────────────
// Authorization Errors
// ─────────────────────────────────────────────────────────────

/**
 * The caller is not the Panoptic Pool.
 * @see Errors.sol:87
 */
export class NotPanopticPoolError extends PanopticError {
  override readonly name = 'NotPanopticPoolError'

  constructor(cause?: Error) {
    super('Caller is not the Panoptic Pool', cause)
  }
}

/**
 * Can only be called by the guardian.
 * @see Errors.sol:81
 */
export class NotGuardianError extends PanopticError {
  override readonly name = 'NotGuardianError'

  constructor(cause?: Error) {
    super('Caller is not the guardian', cause)
  }
}

/**
 * Can only be called by the Builder.
 * @see Errors.sol:72
 */
export class NotBuilderError extends PanopticError {
  override readonly name = 'NotBuilderError'

  constructor(cause?: Error) {
    super('Caller is not the builder', cause)
  }
}

/**
 * Invalid builder code.
 * @see Errors.sol:50
 */
export class InvalidBuilderCodeError extends PanopticError {
  override readonly name = 'InvalidBuilderCodeError'

  constructor(cause?: Error) {
    super('Invalid builder code', cause)
  }
}

/**
 * Mint or swap callback from invalid address.
 * @see Errors.sol:57
 */
export class InvalidUniswapCallbackError extends PanopticError {
  override readonly name = 'InvalidUniswapCallbackError'

  constructor(cause?: Error) {
    super('Invalid Uniswap callback (address mismatch)', cause)
  }
}

/**
 * Unlock callback from non-canonical pool manager.
 * @see Errors.sol:123
 */
export class UnauthorizedUniswapCallbackError extends PanopticError {
  override readonly name = 'UnauthorizedUniswapCallbackError'

  constructor(cause?: Error) {
    super('Unauthorized Uniswap V4 callback', cause)
  }
}

// ─────────────────────────────────────────────────────────────
// Transfer & Casting Errors
// ─────────────────────────────────────────────────────────────

/**
 * ERC20 or SFPM (ERC1155) token transfer did not complete successfully.
 * @see Errors.sol:115
 */
export class TransferFailedError extends PanopticError {
  override readonly name = 'TransferFailedError'

  constructor(
    public readonly token: Address,
    public readonly from: Address,
    public readonly amount: bigint,
    public readonly balance: bigint,
    cause?: Error,
  ) {
    super(
      `Transfer failed: token=${token}, from=${from}, amount=${amount}, balance=${balance}`,
      cause,
    )
  }
}

/**
 * Casting error (e.g., uint128(uint256(a)) fails).
 * @see Errors.sol:13
 */
export class CastingError extends PanopticError {
  override readonly name = 'CastingError'

  constructor(cause?: Error) {
    super('Numeric casting overflow', cause)
  }
}

/**
 * Underflow or overflow in library operation.
 * @see Errors.sol:126
 */
export class UnderOverFlowError extends PanopticError {
  override readonly name = 'UnderOverFlowError'

  constructor(cause?: Error) {
    super('Arithmetic underflow or overflow', cause)
  }
}

// ─────────────────────────────────────────────────────────────
// Reentrancy Error
// ─────────────────────────────────────────────────────────────

/**
 * Reentrancy check triggered.
 * @see Errors.sol:129
 */
export class ReentrancyError extends PanopticError {
  override readonly name = 'ReentrancyError'

  constructor(cause?: Error) {
    super('Reentrancy detected', cause)
  }
}

// ─────────────────────────────────────────────────────────────
// Other Errors
// ─────────────────────────────────────────────────────────────

/**
 * Zero address was supplied as a parameter.
 * @see Errors.sol:138
 */
export class ZeroAddressError extends PanopticError {
  override readonly name = 'ZeroAddressError'

  constructor(cause?: Error) {
    super('Zero address supplied', cause)
  }
}

/**
 * Length mismatch between positionIdList and positionBalanceArray.
 * @see Errors.sol:60
 */
export class LengthMismatchError extends PanopticError {
  override readonly name = 'LengthMismatchError'

  constructor(cause?: Error) {
    super('Array length mismatch', cause)
  }
}
