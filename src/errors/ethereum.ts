import { BaseError, ContractFunctionRevertedError } from 'viem'

export interface GenericError {
  name: string
  message: string
}

export interface DecodedError extends GenericError {
  data?: string
  args?: any
}

/**
 * Parses a custom error from Viem's BaseError or ContractFunctionRevertedError using BaseError.walk.
 * Docs on walk usage: https://viem.sh/docs/contract/simulateContract.html#handling-custom-errors
 *
 * @param {Error} e - The error to parse.
 * @returns {BaseError | ContractFunctionRevertedError | Error} The parsed error.
 *
 * @example
 * To get typesafe access to revert error, can do something like:
 * if (e instanceof ContractFunctionRevertedError) {
 *   // Access custom error properties through the `data` attribute:
 *   console.error('Custom error name: ', e.data?.errorName)
 *   console.error('Custom error args: ', e.data?.args)
 * } else {
 *   console.error('Error name: ', e.name)
 *   console.error('Error message: ', e.message)
 * }
 */
export const parseCustomError = (e: Error): BaseError | ContractFunctionRevertedError | Error => {
  if (e instanceof BaseError) {
    // If caught error is a revert with a solidity custom error, parse it with `walk`
    const revertError = e.walk((e) => e instanceof ContractFunctionRevertedError)
    if (revertError instanceof ContractFunctionRevertedError) {
      return revertError
    }
    // If no revert error found, return the Viem BaseError
    return e
  }

  // If error is not a Viem BaseError, return the original error object that was passed in.
  return e
}

export const isErrorUserRejection = (errorMessage: string) =>
  errorMessage.includes('User rejected the request.')
