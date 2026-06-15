/**
 * Position enrichment data for UI display.
 *
 * Batches all contract reads needed to enrich subgraph position data with
 * on-chain premia, portfolio values, and collateral requirements.
 *
 * @module v2/reads/enrichment
 */

import type { Address, PublicClient } from 'viem'

import { panopticPoolV2Abi, panopticQueryAbi } from '../../../generated'
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
   * Per-token collateral requirement from `getFullPositionsData.collateralRequirements[]`.
   * These are NOT cross-margined — each is in its own token denomination.
   * For closed positions these are 0n (collateral is moot).
   */
  collateralReqToken0: bigint
  collateralReqToken1: bigint
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
 * - **Open positions**: 3 calls per position in a single multicall at current block:
 *   1. `getFullPositionsData` → premia + collateral requirements
 *   2. `getPortfolioValue` at currentTick → current portfolio value
 *   3. `getPortfolioValue` at mintTick → portfolio value at mint
 * - **Closed positions**: 2 calls per position at `burnBlockNumber - 1`:
 *   1. `getPortfolioValue` at burnTick → portfolio value at close
 *   2. `getPortfolioValue` at mintTick → portfolio value at mint
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
const OPEN_CALLS_PER_POSITION = 3
/** Number of multicall contracts per closed position */
const CLOSED_CALLS_PER_POSITION = 2

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

  // Build multicall contracts: 3 calls per position
  const contracts = positions.flatMap((p) => [
    // 1. getFullPositionsData → premia + collateral requirements
    {
      address: p.poolAddress,
      abi: panopticPoolV2Abi,
      functionName: 'getFullPositionsData' as const,
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

    if (premiaResult.status !== 'success') {
      throw new EnrichmentCallError(position.tokenId, 'getFullPositionsData', premiaResult.error)
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

    // Decode getFullPositionsData: [shortPremium, longPremium, balances[], collateralReqs[], netPremia[]]
    const [shortPremiumPacked, longPremiumPacked, , collateralReqsPacked] = premiaResult.result as [
      bigint,
      bigint,
      bigint[],
      bigint[],
      bigint[],
    ]
    const shortPremium = decodeLeftRightUnsigned(shortPremiumPacked)
    const longPremium = decodeLeftRightUnsigned(longPremiumPacked)

    const premiaOwed0 = shortPremium.right - longPremium.right // token0
    const premiaOwed1 = shortPremium.left - longPremium.left // token1

    // Decode per-token collateral requirements from collateralReqs[0] (LeftRightUnsigned)
    const collateralReq = decodeLeftRightUnsigned(collateralReqsPacked[0] ?? 0n)

    // Decode portfolio values
    const [portfolioValue0, portfolioValue1] = portfolioResult.result as [bigint, bigint]
    const [portfolioValueAtMint0, portfolioValueAtMint1] = portfolioAtMintResult.result as [
      bigint,
      bigint,
    ]

    entries.push([
      position.tokenId.toString(),
      {
        premiaOwed0,
        premiaOwed1,
        portfolioValue0,
        portfolioValue1,
        portfolioValueAtMint0,
        portfolioValueAtMint1,
        collateralReqToken0: collateralReq.right,
        collateralReqToken1: collateralReq.left,
      },
    ])
  }

  return { entries }
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
      // Build multicall contracts: 2 calls per position
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

        // Closed position reads can fail legitimately (e.g. position minted and burned
        // in the same block — at burnBlock-1 it doesn't exist yet). Fall back to zeros.
        const [portfolioValue0, portfolioValue1] =
          portfolioAtBurnResult.status === 'success'
            ? (portfolioAtBurnResult.result as [bigint, bigint])
            : [0n, 0n]
        const [portfolioValueAtMint0, portfolioValueAtMint1] =
          portfolioAtMintResult.status === 'success'
            ? (portfolioAtMintResult.result as [bigint, bigint])
            : [0n, 0n]

        entries.push([
          position.tokenId.toString(),
          {
            premiaOwed0: position.burnPremium0 ?? 0n,
            premiaOwed1: position.burnPremium1 ?? 0n,
            portfolioValue0,
            portfolioValue1,
            portfolioValueAtMint0,
            portfolioValueAtMint1,
            collateralReqToken0: 0n,
            collateralReqToken1: 0n,
          },
        ])
      }
    }),
  )

  return entries
}
