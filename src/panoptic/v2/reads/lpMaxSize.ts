import { getMaxLpPositionSize } from '../../../uniswap/lpDeposit'
import { isPanopticErrorType, NotEnoughTokensError, parsePanopticError } from '../errors'
import { tickLimits } from '../formatters/tick'
import { simulateDispatch } from '../simulations/simulateDispatch'
import {
  getNotEnoughTokensError,
  quoteTokenShortfallRecovery,
} from '../simulations/tokenShortfallRecovery'
import { readLpFundingSnapshot } from './lpFunding'

/** Largest verified LP mint within 0.1% of the funding bound, at one block.
 * Never returns an untested size. Transport errors abort instead of shrinking MAX.
 */
export async function getExecutableLpMaxSize(
  params: Omit<Parameters<typeof readLpFundingSnapshot>[0], 'positionSize'> & {
    chainId: bigint
    slippageBps: bigint
  },
) {
  const snapshot = await readLpFundingSnapshot({ ...params, positionSize: 0n })
  const upper = getMaxLpPositionSize({
    ...snapshot.fundingParams,
    availableInQuote: snapshot.availableInQuote,
  })
  const limits = tickLimits(
    // Funding valuation is derived from the account's current tick.
    // Read the bounds from that same snapshot, not an independently cached oracle.
    snapshot.currentTick,
    params.slippageBps,
  )
  const executable = async (size: bigint) => {
    const intent = {
      positionIdList: [params.tokenId],
      finalPositionIdList: [...params.existingPositionIds, params.tokenId],
      positionSizes: [size],
      tickAndSpreadLimits: [[limits.low, limits.high, 0n] as const],
      usePremiaAsCollateral: false,
      builderCode: 0n,
    }
    const simulation = await simulateDispatch({
      ...params,
      ...intent,
      existingPositionIdList: params.existingPositionIds,
      blockNumber: snapshot.blockNumber,
    })
    if (simulation.success) return true
    const parsedSimulationError = parsePanopticError(simulation.error)
    if (
      parsedSimulationError &&
      isPanopticErrorType(parsedSimulationError.error, NotEnoughTokensError) &&
      getNotEnoughTokensError(simulation.error) !== null
    ) {
      const recovery = await quoteTokenShortfallRecovery({
        ...params,
        dispatch: intent,
        error: simulation.error,
        blockNumber: snapshot.blockNumber,
      })
      if (recovery.available) return true
      // A failed quote is not proof that a smaller position will work. The
      // search still verifies every candidate independently.
      if (recovery.error) {
        const parsedRecoveryError = parsePanopticError(recovery.error)
        if (!parsedRecoveryError) throw recovery.error
      }
      return false
    }
    if (!parsedSimulationError) throw simulation.error
    return false
  }
  if (upper === 0n || (await executable(upper))) return { maxSize: upper, ...snapshot }
  let low = 0n
  let high = upper
  const tolerance = upper / 1000n > 0n ? upper / 1000n : 1n
  while (high - low > tolerance) {
    const mid = (low + high) / 2n
    if (await executable(mid)) low = mid
    else high = mid
  }
  return { maxSize: low, ...snapshot }
}
