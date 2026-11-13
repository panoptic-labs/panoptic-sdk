import type { Address, PublicClient } from 'viem'

import { collateralTrackerV2Abi, panopticPoolV2Abi } from '../../../generated'
import { getBlockMeta } from '../clients/blockMeta'
import type { BlockMeta } from '../types'
import type { CollateralAddresses } from './collateral'

/** Borrow interest a tracker will try to settle against an account's collateral shares. */
export interface TokenInterestShortfall {
  /** Collateral tracker that settles the interest and receives the deposit. */
  collateralTracker: Address
  /** Interest the next settlement will charge, in token units. */
  interestOwed: bigint
  /** Collateral the account holds in the tracker, in token units. */
  collateralAssets: bigint
  /**
   * Smallest deposit, in token units, that lets the next settlement pay the
   * interest in full. Zero when the collateral already covers it.
   */
  shortfall: bigint
  /** Deposit to suggest: the shortfall plus headroom for accrual until the deposit lands. */
  recommendedDeposit: bigint
}

export interface InterestShortfall {
  token0: TokenInterestShortfall
  token1: TokenInterestShortfall
  _meta: BlockMeta
}

export interface ComputeInterestShortfallParams {
  collateralTracker: Address
  interestOwed: bigint
  /** Signed net borrows from `interestState`; non-positive means nothing accrues. */
  netBorrows: bigint
  /** `interestRate()`: per-second borrow rate, WAD-scaled. */
  interestRatePerSecond: bigint
  shareBalance: bigint
  totalSupply: bigint
  totalAssets: bigint
}

const ceilDiv = (numerator: bigint, denominator: bigint): bigint =>
  numerator === 0n ? 0n : (numerator - 1n) / denominator + 1n

const WAD = 10n ** 18n
/** Covers approve + deposit + dispatch confirmations and time spent in the review dialog. */
const ACCRUAL_HORIZON_SECONDS = 3_600n

/**
 * Mirrors `CollateralTracker._accrueInterest`: when the shares needed to pay
 * the interest exceed the balance, the whole balance is burned and the debt is
 * kept (`InsolvencyPenaltyApplied`). Every PanopticPool entry point settles
 * interest before crediting any shares, so only a prior `deposit` avoids it.
 *
 * Uses the stored `totalAssets`, which excludes interest accrued since the last
 * interaction, so the shares required are never underestimated.
 */
export function computeInterestShortfall(
  params: ComputeInterestShortfallParams,
): TokenInterestShortfall {
  const {
    collateralTracker,
    interestOwed,
    netBorrows,
    interestRatePerSecond,
    shareBalance,
    totalSupply,
    totalAssets,
  } = params
  const collateralAssets = totalSupply === 0n ? 0n : (shareBalance * totalAssets) / totalSupply
  if (interestOwed === 0n || totalSupply === 0n || totalAssets === 0n) {
    return {
      collateralTracker,
      interestOwed,
      collateralAssets,
      shortfall: 0n,
      recommendedDeposit: 0n,
    }
  }

  const sharesRequired = ceilDiv(interestOwed * totalSupply, totalAssets)
  if (sharesRequired <= shareBalance) {
    return {
      collateralTracker,
      interestOwed,
      collateralAssets,
      shortfall: 0n,
      recommendedDeposit: 0n,
    }
  }

  // `deposit` mints floor(assets * supply / totalAssets) shares.
  const shortfall = ceilDiv((sharesRequired - shareBalance) * totalAssets, totalSupply)
  const accruingBorrows = netBorrows > 0n ? netBorrows : 0n
  const headroom =
    ceilDiv(accruingBorrows * interestRatePerSecond * ACCRUAL_HORIZON_SECONDS, WAD) + 1n
  return {
    collateralTracker,
    interestOwed,
    collateralAssets,
    shortfall,
    recommendedDeposit: shortfall + headroom,
  }
}

/** Reads the pool's two CollateralTracker addresses at a fixed block. */
async function readTrackers(
  client: PublicClient,
  poolAddress: Address,
  blockNumber: bigint,
): Promise<CollateralAddresses> {
  const [collateralToken0, collateralToken1] = await client.multicall({
    contracts: [
      { address: poolAddress, abi: panopticPoolV2Abi, functionName: 'collateralToken0' },
      { address: poolAddress, abi: panopticPoolV2Abi, functionName: 'collateralToken1' },
    ],
    allowFailure: false,
    blockNumber,
  })
  return { collateralToken0, collateralToken1 }
}

export interface GetInterestShortfallParams {
  client: PublicClient
  poolAddress: Address
  account: Address
  blockNumber?: bigint
  collateralAddresses?: CollateralAddresses
}

/**
 * Per-token interest shortfall for an account: how much it must deposit before
 * its next mint, burn or settlement to avoid the insolvency penalty.
 */
export async function getInterestShortfall(
  params: GetInterestShortfallParams,
): Promise<InterestShortfall> {
  const { client, poolAddress, account } = params
  const blockNumber = params.blockNumber ?? (await client.getBlockNumber())

  const trackers =
    params.collateralAddresses ?? (await readTrackers(client, poolAddress, blockNumber))

  const trackerReads = (address: Address) =>
    [
      {
        address,
        abi: collateralTrackerV2Abi,
        functionName: 'previewOwedInterest',
        args: [account],
      },
      { address, abi: collateralTrackerV2Abi, functionName: 'balanceOf', args: [account] },
      { address, abi: collateralTrackerV2Abi, functionName: 'totalSupply' },
      { address, abi: collateralTrackerV2Abi, functionName: 'totalAssets' },
      { address, abi: collateralTrackerV2Abi, functionName: 'interestState', args: [account] },
      { address, abi: collateralTrackerV2Abi, functionName: 'interestRate' },
    ] as const

  const [results, _meta] = await Promise.all([
    client.multicall({
      contracts: [
        ...trackerReads(trackers.collateralToken0),
        ...trackerReads(trackers.collateralToken1),
      ],
      allowFailure: false,
      blockNumber,
    }),
    getBlockMeta({ client, blockNumber }),
  ])

  const [owed0, balance0, supply0, assets0, state0, rate0] = results
  const [, , , , , , owed1, balance1, supply1, assets1, state1, rate1] = results

  return {
    token0: computeInterestShortfall({
      collateralTracker: trackers.collateralToken0,
      interestOwed: owed0,
      netBorrows: state0[1],
      interestRatePerSecond: rate0,
      shareBalance: balance0,
      totalSupply: supply0,
      totalAssets: assets0,
    }),
    token1: computeInterestShortfall({
      collateralTracker: trackers.collateralToken1,
      interestOwed: owed1,
      netBorrows: state1[1],
      interestRatePerSecond: rate1,
      shareBalance: balance1,
      totalSupply: supply1,
      totalAssets: assets1,
    }),
    _meta,
  }
}
