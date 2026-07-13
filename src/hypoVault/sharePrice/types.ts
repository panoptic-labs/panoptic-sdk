import type { Hex, PublicClient } from 'viem'

import type { VaultPoolCandidateTokenIds } from '../utils/vaultManagerInput'

export type VaultApyVaultLike = {
  id: string
  accountant: string
  createdAt: string
  createdAtBlock?: string
  firstDepositTimestampSec?: number
  underlyingToken: {
    id: string
    symbol?: string
    decimals?: string
    name?: string
  }
}

export type VaultApyMetrics = {
  apy7dPct: number | null
  apy30dPct: number | null
  apySinceInceptionPct: number | null
  premiumApyPct?: number | null
  premiumApy7dPct?: number | null
  premiumApy30dPct?: number | null
  premiumApySinceInceptionPct?: number | null
  premiumVaultAssetsApy7dPct?: number | null
  premiumVaultAssetsApy30dPct?: number | null
  premiumVaultAssetsApySinceInceptionPct?: number | null
  instantBorrowApyPct?: number | null
  sharePriceNow?: string | null
  sharePriceSinceInception?: string | null
  sharePriceNowNavRaw?: string | null
  sharePriceNowAssetsDepositedRaw?: string | null
  sharePriceNowReservedWithdrawalAssetsRaw?: string | null
  sharePriceNowSharesRaw?: string | null
  sharePriceNowAdjustedAssetsRaw?: string | null
  sharePriceNowBlockNumber?: string | null
  sharePriceNowFormula?: string | null
  createdAtProbeSharePrice?: string | null
  createdAtProbeBlockNumber?: string | null
  firstNonNullSharePrice?: string | null
  firstNonNullSharePriceTimestampSec?: number | null
  firstNonNullSharePriceBlockNumber?: string | null
  firstNonNullVsHardcodedInceptionDeltaPct?: string | null
  firstNonNullScanAttempts?: number | null
  firstNonNullScanFailures?: number | null
  hourAgoSharePrice?: string | null
  hourlyDeltaPct?: string | null
  /**
   * Raw `managerInput` bytes captured at the "now" snapshot. Reusing these
   * lets `<DepositWithdrawPanel>` skip rebuilding the manager input itself
   * (the same heavy candidate-token-id gather + on-chain filter that drives
   * the APY pipeline). Null when the "now" snapshot couldn't be taken.
   */
  sharePriceNowManagerInputBytes?: Hex | null
}

export type VaultApyTimescale = '7d' | '30d' | 'allTime'

export type VaultApySeriesPoint = {
  timestampSec: number
  apyPct: number
}

export type VaultSharePriceSeriesPoint = {
  timestampSec: number
  sharePrice: string
}

export type VaultApyMetricKind = 'nav' | 'premium' | 'borrowRate'

export type PremiumApyConfig = {
  premiumSourceId?: string
}

export type BorrowRateApyConfig = {
  rateSourceId?: string
}

export type ManagerInputProviderContext = {
  chainId: number
  vault: VaultApyVaultLike
  client: PublicClient
  blockNumber: bigint
  /**
   * Pre-resolved, block-independent candidate tokenIds (from
   * `strategy.resolveCandidates`). When supplied, the provider verifies these at
   * `blockNumber` instead of re-running the subgraph candidate paging — lets a
   * timeseries resolve candidates once per vault rather than once per anchor.
   */
  candidates?: readonly VaultPoolCandidateTokenIds[]
}

export type ManagerInputProviderDiagnostics = {
  poolAddresses: string[]
  tokenIdsByPool: bigint[][]
}

export type ManagerInputProviderResult =
  | Hex
  | {
      managerInput: Hex
      diagnostics?: ManagerInputProviderDiagnostics
    }

export type CandidateResolverContext = {
  chainId: number
  vault: VaultApyVaultLike
  client: PublicClient
}

export type VaultApyStrategy = {
  enabledMetrics: VaultApyMetricKind[]
  managerInputProvider: (ctx: ManagerInputProviderContext) => Promise<ManagerInputProviderResult>
  /**
   * Optional: resolve the block-independent candidate tokenIds once per vault.
   * The result is threaded into every `managerInputProvider` call for a
   * timeseries via `ManagerInputProviderContext.candidates`. Strategies with no
   * subgraph candidate gather (e.g. the default `0x` strategy) omit this.
   */
  resolveCandidates?: (ctx: CandidateResolverContext) => Promise<VaultPoolCandidateTokenIds[]>
  premium?: PremiumApyConfig
  borrowRate?: BorrowRateApyConfig
}

export type VaultApyAnchorWindowDays = 7 | 30

export type VaultApyAnchor = {
  number: number
  timestamp: number
}

export type VaultApyAnchors = {
  now: VaultApyAnchor
  lookbackByDays: Record<VaultApyAnchorWindowDays, VaultApyAnchor>
  nowWindow: VaultApyAnchor[]
  lookbackWindowByDays: Record<VaultApyAnchorWindowDays, VaultApyAnchor[]>
}

export type VaultSharePriceSnapshot = {
  sharePrice: string | null
  nav: bigint
  assetsDeposited: bigint
  reservedWithdrawalAssets: bigint
  shares: bigint
  blockNumber: bigint
  navSource: 'computeNAV' | 'computeNAVStateOverride' | 'offchainLendingEstimate'
  managerInputBytes: Hex
  managerInputByteLength: number
  managerInputHash: Hex
  tokenIdCountsByPool: Array<{ poolAddress: string | null; tokenCount: number }> | null
  tokenIdsByPool: Array<{ poolAddress: string | null; tokenIds: string[] }> | null
}
