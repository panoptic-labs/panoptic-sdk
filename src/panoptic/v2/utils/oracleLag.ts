import type { OracleState } from '../types'

/** An oracle tick the RiskEngine prices against. */
export type OracleReference = 'spotEMA' | 'twap' | 'latest' | 'median'

export interface OracleGap {
  /** Largest |currentTick - reference| among the references checked. */
  gap: bigint
  reference: OracleReference
}

export interface OracleLag {
  /** Widest gap among the ticks liquidation solvency reads: spot EMA, TWAP and latest observation. */
  liquidation: OracleGap
  /** Widest gap among the ticks new positions are priced at: spot EMA in every mode, median in safe mode. */
  newPosition: OracleGap
}

type OracleLagInput = Pick<
  OracleState,
  'currentTick' | 'spotEMA' | 'twapTick' | 'latestTick' | 'medianTick'
>

/** How far each group of RiskEngine reference ticks trails the live pool tick. */
export function getOracleLag(state: OracleLagInput): OracleLag {
  const tickOf: Record<OracleReference, bigint> = {
    spotEMA: state.spotEMA,
    twap: state.twapTick,
    latest: state.latestTick,
    median: state.medianTick,
  }
  const widest = (references: readonly OracleReference[]): OracleGap =>
    references
      .map((reference) => {
        const delta = state.currentTick - tickOf[reference]
        return { reference, gap: delta < 0n ? -delta : delta }
      })
      .reduce((best, next) => (next.gap > best.gap ? next : best))
  return {
    liquidation: widest(['spotEMA', 'twap', 'latest']),
    newPosition: widest(['spotEMA', 'median']),
  }
}
