/**
 * Errors for the CoW Protocol swap module.
 *
 * All extend {@link PanopticError} so callers can keep a single
 * `instanceof PanopticError` check and so they satisfy `SimulationResult`'s
 * error type.
 *
 * @module cow/errors
 */

import { PanopticError } from '../panoptic/v2/errors'

/** The chain has no CoW order book. */
export class CowUnsupportedChainError extends PanopticError {
  override readonly name = 'CowUnsupportedChainError'

  constructor(
    public readonly chainId: bigint,
    cause?: Error,
  ) {
    super(`CoW Protocol not available on chain ${chainId}`, cause)
  }
}

/** The order-book API rejected a request (non-2xx response). */
export class CowApiError extends PanopticError {
  override readonly name: string = 'CowApiError'

  constructor(
    /** Machine-readable API error type, e.g. 'SellAmountDoesNotCoverFee'. */
    public readonly errorType: string,
    message: string,
    public readonly status: number,
    cause?: Error,
  ) {
    super(message, cause)
  }
}

/** The sell amount is too small to cover the protocol fee (dust order). */
export class CowOrderTooSmallError extends CowApiError {
  override readonly name = 'CowOrderTooSmallError'

  constructor(message: string, status: number, cause?: Error) {
    super('SellAmountDoesNotCoverFee', message, status, cause)
  }
}

/** Selling native ETH requires the eth-flow contract (unsupported here); buying it is fine. */
export class CowNativeTokenError extends PanopticError {
  override readonly name = 'CowNativeTokenError'

  constructor(cause?: Error) {
    super('CoW orders cannot sell native ETH (eth-flow not supported)', cause)
  }
}
