/**
 * Base error class for the Panoptic v2 SDK.
 * @module v2/errors/base
 */

/**
 * Base error class for all Panoptic SDK errors.
 * All errors thrown by the SDK extend this class.
 *
 * @example
 * ```typescript
 * try {
 *   await openPosition(config, params)
 * } catch (error) {
 *   if (error instanceof PanopticError) {
 *     console.log('Panoptic error:', error.name, error.message)
 *     console.log('Original cause:', error.cause)
 *   }
 * }
 * ```
 */
export class PanopticError extends Error {
  override readonly name: string = 'PanopticError'

  /**
   * Creates a new PanopticError.
   *
   * @param message - Human-readable error message
   * @param cause - Optional underlying error that caused this error
   */
  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message)

    // Maintains proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }

    // Ensure prototype chain is correctly set up
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
