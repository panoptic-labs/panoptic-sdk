/**
 * Position enrichment data for UI display.
 *
 * Batches all contract reads needed to enrich subgraph position data with
 * on-chain premia, portfolio values, and collateral requirements.
 *
 * @module v2/reads/enrichment
 */

import type { Address, PublicClient } from 'viem'

import { panopticPoolAbi, panopticQueryAbi } from '../../../generated'
import { getBlockMeta } from '../clients/blockMeta'
import { PanopticError } from '../errors'
import type { BlockMeta } from '../types'
import { decodeLeftRightUnsigned } from '../writes/utils'

/**
 * Error thrown when an enrichment contract call fails for a specific position.
 */
export class EnrichmentCallError extends PanopticError {
  /** The tokenId of the position that failed */
  readonly tokenId: bigint
  /** The name of the failing call */
  readonly callName: string

  constructor(tokenId: bigint, callName: string, cause?: unknown) {
    super(
      `Enrichment call "${callName}" failed for tokenId ${tokenId}`,
      cause instanceof Error ? cause : undefined,
    )
    this.tokenId = tokenId
    this.callName = callName
  }
}

/**
 * Input describing a position for enrichment.
 */
export interface PositionInput {
  /** The tokenId (256-bit identifier) */
  tokenId: bigint
  /** Whether the position is currently open */
  isOpen: boolean
  /** Tick at time of mint */
  tickAtMint: number
  /** Account address that owns the position */
  account: Address
  /** Pool address the position belongs to */
  poolAddress: Address
  /** Tick at burn (closed positions only) */
  tickAtBurn?: number
  /** Block number of the burn tx (closed positions only) */
  burnBlockNumber?: bigint
  /** Premium in token0 from subgraph (closed positions only) */
  burnPremium0?: bigint
  /** Premium in token1 from subgraph (closed positions only) */
  burnPremium1?: bigint
}

/**
 * Enrichment result for a single position.
 *
 * Values are in raw token units (token0 and token1), not asset/quote.
 * The UI maps these to asset/quote based on isAssetToken0.
 */
export interface PositionEnrichmentResult {
  /** Net premia owed: shortPremium - longPremium for token0 (open); burnPremium0 for closed */
  premiaOwed0: bigint
  /** Net premia owed: shortPremium - longPremium for token1 (open); burnPremium1 for closed */
  premiaOwed1: bigint
  /** Portfolio value in token0 at current tick (open) or burn tick (closed) */
  portfolioValue0: bigint
  /** Portfolio value in token1 at current tick (open) or burn tick (closed) */
  portfolioValue1: bigint
  /** Portfolio value in token0 at mint tick */
  portfolioValueAtMint0: bigint
  /** Portfolio value in token1 at mint tick */
  portfolioValueAtMint1: bigint
  /**
   * Cross-margined collateral data at pnlEndTick, from `checkCollateral(pool, account, [tokenId], pnlEndTick)`.
   * All values are in the same denomination after cross-margining:
   * token0 when atTick < 0, token1 when atTick >= 0.
   * Slot 0/1 refer to the two collateral trackers, not token0/token1.
   */
  collateralEffectiveBal0: bigint
  collateralEffectiveReq0: bigint
  collateralEffectiveBal1: bigint
  collateralEffectiveReq1: bigint
  /** Cross-margined collateral data at mint tick (same denomination rules) */
  collateralAtMintEffectiveBal0: bigint
  collateralAtMintEffectiveReq0: bigint
  collateralAtMintEffectiveBal1: bigint
  collateralAtMintEffectiveReq1: bigint
}

/**
 * Parameters for getPositionEnrichmentData.
 */
export interface GetPositionEnrichmentDataParams {
  /** viem PublicClient */
  client: PublicClient
  /** PanopticQuery helper contract address */
  queryAddress: Address
  /** Positions to enrich */
  positions: PositionInput[]
  /** Current pool tick (used for open position portfolio values) */
  currentTick: number
  /** Optional block number for open position reads */
  blockNumber?: bigint
  /** Optional pre-fetched block metadata */
  _meta?: BlockMeta
}

/**
 * Result from getPositionEnrichmentData.
 */
export interface GetPositionEnrichmentDataResult {
  /** Enrichment data keyed by tokenId string */
  byTokenId: Map<string, PositionEnrichmentResult>
  /** Block metadata */
  _meta: BlockMeta
}

/**
 * Fetch enrichment data (premia, portfolio values, collateral requirements) for a set of positions.
 *
 * Batches all needed contract reads into efficient multicalls:
 * - **Open positions**: 5 calls per position in a single multicall at current block:
 *   1. `getAccumulatedFeesAndPositionsData` → per-position premia
 *   2. `getPortfolioValue` at currentTick → current portfolio value
 *   3. `getPortfolioValue` at mintTick → portfolio value at mint
 *   4. `checkCollateral` at currentTick → collateral requirement at current tick
 *   5. `checkCollateral` at mintTick → collateral requirement at mint tick
 * - **Closed positions**: 4 calls per position at `burnBlockNumber - 1`:
 *   1. `getPortfolioValue` at burnTick → portfolio value at close
 *   2. `getPortfolioValue` at mintTick → portfolio value at mint
 *   3. `checkCollateral` at burnTick → collateral requirement at burn tick
 *   4. `checkCollateral` at mintTick → collateral requirement at mint tick
 *   (premia come from subgraph `burnPremium0/1`)
 *
 * ## Same-Block Guarantee
 * Open position data is fetched at a single block number.
 * Closed position data is fetched at `burnBlockNumber - 1` (per position).
 *
 * @param params - The parameters
 * @returns Map of tokenId → enrichment data, with block metadata
 */
export async function getPositionEnrichmentData(
  params: GetPositionEnrichmentDataParams,
): Promise<GetPositionEnrichmentDataResult> {
  const { client, queryAddress, positions, currentTick, blockNumber } = params

  // Fetch a single block metadata for the entire enrichment result
  const _meta = params._meta ?? (await getBlockMeta({ client, blockNumber }))

  if (positions.length === 0) {
    return { byTokenId: new Map(), _meta }
  }

  const openPositions = positions.filter((p) => p.isOpen)
  const closedPositions = positions.filter((p) => !p.isOpen)

  const byTokenId = new Map<string, PositionEnrichmentResult>()

  // Process open and closed positions in parallel
  await Promise.all([
    processOpenPositions(client, queryAddress, openPositions, currentTick, blockNumber, _meta),
    processClosedPositions(client, queryAddress, closedPositions),
  ]).then(([openResults, closedResults]) => {
    // Merge results into byTokenId map
    for (const [key, value] of openResults.entries) {
      byTokenId.set(key, value)
    }
    for (const [key, value] of closedResults) {
      byTokenId.set(key, value)
    }
  })

  return { byTokenId, _meta }
}

/** Number of multicall contracts per open position */
const OPEN_CALLS_PER_POSITION = 5
/** Number of multicall contracts per closed position */
const CLOSED_CALLS_PER_POSITION = 4

/**
 * Process open positions: single multicall with 5 calls per position.
 */
async function processOpenPositions(
  client: PublicClient,
  queryAddress: Address,
  positions: PositionInput[],
  currentTick: number,
  blockNumber: bigint | undefined,
  _meta: BlockMeta,
): Promise<{ entries: [string, PositionEnrichmentResult][] }> {
  if (positions.length === 0) {
    return { entries: [] }
  }

  const targetBlockNumber = blockNumber ?? _meta.blockNumber

  // Build multicall contracts: 5 calls per position
  const contracts = positions.flatMap((p) => [
    // 1. getAccumulatedFeesAndPositionsData → premia
    {
      address: p.poolAddress,
      abi: panopticPoolAbi,
      functionName: 'getAccumulatedFeesAndPositionsData' as const,
      args: [p.account, true, [p.tokenId]] as const,
    },
    // 2. getPortfolioValue at currentTick
    {
      address: queryAddress,
      abi: panopticQueryAbi,
      functionName: 'getPortfolioValue' as const,
      args: [p.poolAddress, p.account, currentTick, [p.tokenId]] as const,
    },
    // 3. getPortfolioValue at mintTick
    {
      address: queryAddress,
      abi: panopticQueryAbi,
      functionName: 'getPortfolioValue' as const,
      args: [p.poolAddress, p.account, p.tickAtMint, [p.tokenId]] as const,
    },
    // 4. checkCollateral at currentTick
    {
      address: queryAddress,
      abi: panopticQueryAbi,
      functionName: 'checkCollateral' as const,
      args: [p.poolAddress, p.account, [p.tokenId], currentTick] as const,
    },
    // 5. checkCollateral at mintTick
    {
      address: queryAddress,
      abi: panopticQueryAbi,
      functionName: 'checkCollateral' as const,
      args: [p.poolAddress, p.account, [p.tokenId], p.tickAtMint] as const,
    },
  ])

  const multicallResults = await client.multicall({
    contracts,
    blockNumber: targetBlockNumber,
    allowFailure: true,
  })

  const entries: [string, PositionEnrichmentResult][] = []

  for (let i = 0; i < positions.length; i++) {
    const position = positions[i]
    const baseIdx = i * OPEN_CALLS_PER_POSITION

    const premiaResult = multicallResults[baseIdx]
    const portfolioResult = multicallResults[baseIdx + 1]
    const portfolioAtMintResult = multicallResults[baseIdx + 2]
    const collateralResult = multicallResults[baseIdx + 3]
    const collateralAtMintResult = multicallResults[baseIdx + 4]

    if (premiaResult.status !== 'success') {
      throw new EnrichmentCallError(
        position.tokenId,
        'getAccumulatedFeesAndPositionsData',
        premiaResult.error,
      )
    }
    if (portfolioResult.status !== 'success') {
      throw new EnrichmentCallError(
        position.tokenId,
        'getPortfolioValue (currentTick)',
        portfolioResult.error,
      )
    }
    if (portfolioAtMintResult.status !== 'success') {
      throw new EnrichmentCallError(
        position.tokenId,
        'getPortfolioValue (mintTick)',
        portfolioAtMintResult.error,
      )
    }

    // Decode premia: shortPremium - longPremium
    const [shortPremiumPacked, longPremiumPacked] = premiaResult.result as [
      bigint,
      bigint,
      bigint[],
    ]
    const shortPremium = decodeLeftRightUnsigned(shortPremiumPacked)
    const longPremium = decodeLeftRightUnsigned(longPremiumPacked)

    const premiaOwed0 = shortPremium.right - longPremium.right // token0
    const premiaOwed1 = shortPremium.left - longPremium.left // token1

    // Decode portfolio values
    const [portfolioValue0, portfolioValue1] = portfolioResult.result as [bigint, bigint]
    const [portfolioValueAtMint0, portfolioValueAtMint1] = portfolioAtMintResult.result as [
      bigint,
      bigint,
    ]

    // Decode collateral requirements (graceful fallback to 0 if call failed)
    const collateral = decodeCollateralResult(collateralResult)
    const collateralAtMint = decodeCollateralResult(collateralAtMintResult)

    entries.push([
      position.tokenId.toString(),
      {
        premiaOwed0,
        premiaOwed1,
        portfolioValue0,
        portfolioValue1,
        portfolioValueAtMint0,
        portfolioValueAtMint1,
        collateralEffectiveBal0: collateral.effectiveBal0,
        collateralEffectiveReq0: collateral.effectiveReq0,
        collateralEffectiveBal1: collateral.effectiveBal1,
        collateralEffectiveReq1: collateral.effectiveReq1,
        collateralAtMintEffectiveBal0: collateralAtMint.effectiveBal0,
        collateralAtMintEffectiveReq0: collateralAtMint.effectiveReq0,
        collateralAtMintEffectiveBal1: collateralAtMint.effectiveBal1,
        collateralAtMintEffectiveReq1: collateralAtMint.effectiveReq1,
      },
    ])
  }

  return { entries }
}

/**
 * Decode a checkCollateral(pool, account, positionIdList, atTick) result.
 *
 * The contract returns uint256[4]: [effectiveBal0, effectiveReq0, effectiveBal1, effectiveReq1].
 * All values are in the same denomination after cross-margining:
 * - token0 units when atTick < 0 (sqrtPriceX96 < FP96)
 * - token1 units when atTick >= 0 (sqrtPriceX96 >= FP96)
 *
 * Slot 0 and slot 1 refer to the two collateral trackers, not token0/token1 directly.
 */
function decodeCollateralResult(result: { status: string; result?: unknown }): {
  effectiveBal0: bigint
  effectiveReq0: bigint
  effectiveBal1: bigint
  effectiveReq1: bigint
} {
  if (result.status !== 'success') {
    return { effectiveBal0: 0n, effectiveReq0: 0n, effectiveBal1: 0n, effectiveReq1: 0n }
  }

  const [effectiveBal0, effectiveReq0, effectiveBal1, effectiveReq1] = result.result as readonly [
    bigint,
    bigint,
    bigint,
    bigint,
  ]

  return { effectiveBal0, effectiveReq0, effectiveBal1, effectiveReq1 }
}

/**
 * Process closed positions: per-position calls at burnBlockNumber - 1.
 *
 * Returns entries array (not a map) to merge into the final result.
 */
async function processClosedPositions(
  client: PublicClient,
  queryAddress: Address,
  positions: PositionInput[],
): Promise<[string, PositionEnrichmentResult][]> {
  if (positions.length === 0) return []

  // Group positions by burnBlockNumber for batch efficiency
  const byBlock = new Map<bigint, PositionInput[]>()
  for (const p of positions) {
    if (p.burnBlockNumber == null) continue
    const readBlock = p.burnBlockNumber - 1n
    const group = byBlock.get(readBlock) ?? []
    group.push(p)
    byBlock.set(readBlock, group)
  }

  const entries: [string, PositionEnrichmentResult][] = []

  // Process each block group
  await Promise.all(
    Array.from(byBlock.entries()).map(async ([readBlock, blockPositions]) => {
      // Build multicall contracts: 4 calls per position
      const contracts = blockPositions.flatMap((p) => [
        // 1. getPortfolioValue at burnTick
        {
          address: queryAddress,
          abi: panopticQueryAbi,
          functionName: 'getPortfolioValue' as const,
          args: [p.poolAddress, p.account, p.tickAtBurn ?? 0, [p.tokenId]] as const,
        },
        // 2. getPortfolioValue at mintTick
        {
          address: queryAddress,
          abi: panopticQueryAbi,
          functionName: 'getPortfolioValue' as const,
          args: [p.poolAddress, p.account, p.tickAtMint, [p.tokenId]] as const,
        },
        // 3. checkCollateral at burnTick
        {
          address: queryAddress,
          abi: panopticQueryAbi,
          functionName: 'checkCollateral' as const,
          args: [p.poolAddress, p.account, [p.tokenId], p.tickAtBurn ?? 0] as const,
        },
        // 4. checkCollateral at mintTick
        {
          address: queryAddress,
          abi: panopticQueryAbi,
          functionName: 'checkCollateral' as const,
          args: [p.poolAddress, p.account, [p.tokenId], p.tickAtMint] as const,
        },
      ])

      const multicallResults = await client.multicall({
        contracts,
        blockNumber: readBlock,
        allowFailure: true,
      })

      for (let i = 0; i < blockPositions.length; i++) {
        const position = blockPositions[i]
        const baseIdx = i * CLOSED_CALLS_PER_POSITION

        const portfolioAtBurnResult = multicallResults[baseIdx]
        const portfolioAtMintResult = multicallResults[baseIdx + 1]
        const collateralResult = multicallResults[baseIdx + 2]
        const collateralAtMintResult = multicallResults[baseIdx + 3]

        if (portfolioAtBurnResult.status !== 'success') {
          throw new EnrichmentCallError(
            position.tokenId,
            'getPortfolioValue (burnTick)',
            portfolioAtBurnResult.error,
          )
        }
        if (portfolioAtMintResult.status !== 'success') {
          throw new EnrichmentCallError(
            position.tokenId,
            'getPortfolioValue (mintTick)',
            portfolioAtMintResult.error,
          )
        }

        const [portfolioValue0, portfolioValue1] = portfolioAtBurnResult.result as [bigint, bigint]
        const [portfolioValueAtMint0, portfolioValueAtMint1] = portfolioAtMintResult.result as [
          bigint,
          bigint,
        ]

        const collateral = decodeCollateralResult(collateralResult)
        const collateralAtMint = decodeCollateralResult(collateralAtMintResult)

        entries.push([
          position.tokenId.toString(),
          {
            premiaOwed0: position.burnPremium0 ?? 0n,
            premiaOwed1: position.burnPremium1 ?? 0n,
            portfolioValue0,
            portfolioValue1,
            portfolioValueAtMint0,
            portfolioValueAtMint1,
            collateralEffectiveBal0: collateral.effectiveBal0,
            collateralEffectiveReq0: collateral.effectiveReq0,
            collateralEffectiveBal1: collateral.effectiveBal1,
            collateralEffectiveReq1: collateral.effectiveReq1,
            collateralAtMintEffectiveBal0: collateralAtMint.effectiveBal0,
            collateralAtMintEffectiveReq0: collateralAtMint.effectiveReq0,
            collateralAtMintEffectiveBal1: collateralAtMint.effectiveBal1,
            collateralAtMintEffectiveReq1: collateralAtMint.effectiveReq1,
          },
        ])
      }
    }),
  )

  return entries
}
