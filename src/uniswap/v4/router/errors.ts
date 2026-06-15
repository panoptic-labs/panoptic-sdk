/**
 * Errors for the Uniswap v4 Universal Router swap module.
 *
 * All extend {@link PanopticError} so callers can keep a single
 * `instanceof PanopticError` check and so they satisfy `SimulationResult`'s
 * error type.
 *
 * @module uniswap/v4/router/errors
 */

import type { Address } from 'viem'

import { PanopticError } from '../../../panoptic/v2/errors'

/**
 * The chain has no configured Uniswap v4 addresses and none were supplied via
 * overrides.
 */
export class UnsupportedChainError extends PanopticError {
  override readonly name = 'UnsupportedChainError'

  constructor(
    public readonly chainId: bigint,
    cause?: Error,
  ) {
    super(`Uniswap v4 router not configured for chain ${chainId}`, cause)
  }
}

/**
 * `tokenIn` is neither `currency0` nor `currency1` of the resolved pool.
 */
export class InvalidSwapTokenError extends PanopticError {
  override readonly name = 'InvalidSwapTokenError'

  constructor(
    public readonly token: Address,
    public readonly currency0: Address,
    public readonly currency1: Address,
    cause?: Error,
  ) {
    super(
      `Token ${token} is not part of the pool (currency0=${currency0}, currency1=${currency1})`,
      cause,
    )
  }
}

/**
 * An amount exceeds the uint128 range required by the v4 swap encoding.
 */
export class AmountExceedsUint128Error extends PanopticError {
  override readonly name = 'AmountExceedsUint128Error'

  constructor(
    public readonly amount: bigint,
    cause?: Error,
  ) {
    super(`Amount ${amount} exceeds uint128 maximum`, cause)
  }
}

/**
 * A native-ETH swap needs a trailing Universal Router SWEEP to deliver the ETH
 * output (or refund the input overpay), but no `recipient` was supplied.
 */
export class MissingSweepRecipientError extends PanopticError {
  override readonly name = 'MissingSweepRecipientError'

  constructor(cause?: Error) {
    super('A recipient is required to sweep native ETH back to the user', cause)
  }
}

/**
 * The V4Quoter is not available for the chain (no fallback in v1).
 */
export class QuoterUnavailableError extends PanopticError {
  override readonly name = 'QuoterUnavailableError'

  constructor(
    public readonly chainId: bigint,
    cause?: Error,
  ) {
    super(`V4Quoter unavailable for chain ${chainId}`, cause)
  }
}
