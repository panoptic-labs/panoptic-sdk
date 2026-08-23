/**
 * Collateral strategy classification and per-strategy requirement attribution.
 *
 * `RiskEngine` does not charge collateral leg by leg. It walks the legs, and for
 * each one asks whether that leg's `riskPartner` forms one of a fixed list of
 * recognized strategies; if so, the pair is charged once, under that strategy's
 * own rule. This module reproduces that walk in TypeScript so the UI can name
 * what the contract is doing, and estimates how the authoritative total splits
 * across the recognized groups.
 *
 * **The classification is exact; the numbers are estimates.** Classification is a
 * pure re-implementation of the contract's branch conditions
 * (`RiskEngine._getRequiredCollateralSingleLegPartner`), so it either matches the
 * contract or it is a bug. The per-group amounts are NOT exact: they come from
 * pricing each group in isolation, which loses whatever the combined position
 * gets from cross-collateralization. They are used strictly as attribution
 * weights against the authoritative total — never as the total itself.
 *
 * @module v2/reads/collateralBreakdown
 */

import type { Address, PublicClient } from 'viem'

import { panopticPoolV2Abi } from '../../../generated'
import { panopticQueryAbi } from '../abis/panopticQuery'
import { getBlockMeta } from '../clients/blockMeta'
import { PanopticError } from '../errors'
import { type DecodedLeg, addLegToTokenId, decodeAllLegs } from '../tokenId/encoding'
import type { BlockMeta } from '../types'
import { REQUIRED_BASE_ERROR_SENTINEL } from './collateralEstimate'

/** Mask selecting the poolId (low 64 bits) of a tokenId. */
const POOL_ID_MASK = (1n << 64n) - 1n

/** `getRequiredBase` prices at `type(uint64).max`; results scale linearly in size. */
const MAX_UINT64 = 2n ** 64n - 1n

/**
 * How the RiskEngine treats a group of one or two legs for collateral purposes.
 *
 * Every value maps to a real branch of the contract. Two caveats, both
 * deliberate:
 *
 *  - `straddle` and `strangle` are ONE branch on-chain (`_computeStrangle`). They
 *    are split here only because traders name them differently; they must share a
 *    collateral-rule explanation, because they share a formula.
 *  - `shortCall`/`shortPut` and `longCall`/`longPut` are presentation splits of
 *    the single `_getRequiredCollateralSingleLegNoPartner` path.
 */
export type CollateralStrategyKind =
  /** Unpartnered short call — sold, collateralized at the seller ratio. */
  | 'shortCall'
  /** Unpartnered short put. */
  | 'shortPut'
  /** Unpartnered long call — bought, collateralized at the buyer ratio. */
  | 'longCall'
  /** Unpartnered long put. */
  | 'longPut'
  /** width=0 short leg: borrows the notional. Requires 100% + maintenance margin. */
  | 'loan'
  /** width=0 long leg: lends the notional. Requires 0 on its own. */
  | 'credit'
  /** Two short options, different tokenTypes, different strikes. */
  | 'strangle'
  /** Two short options, different tokenTypes, the same strike. */
  | 'straddle'
  /** Long + short, different tokenTypes, the SAME strike — the short leg only. */
  | 'synthetic'
  /** Long + short, same tokenType — defined risk, charged at max loss. */
  | 'spread'
  /** Long option funded by a credit — `max(long - credit, 1)`. */
  | 'prepaidLongOption'
  /** Short option funded by a credit — `max(short - credit, 1)`. */
  | 'cashSecuredOption'
  /** Long option paired with a loan — `max(loan, option)`. */
  | 'optionProtectedLoan'
  /** Short option paired with a loan — `max(loan, option)`. */
  | 'upfrontShortOption'
  /**
   * A leg naming a partner the contract does not recognize as a strategy —
   * mismatched asset or optionRatio, or a pairing outside the allowed list.
   * The contract silently falls back to charging each leg standalone, so this is
   * the one kind a trader most needs told: the intended netting did NOT apply.
   */
  | 'unrecognizedPair'

/** Kinds whose collateral rule is identical on-chain and must share one explanation. */
const SHARED_RULE: Partial<Record<CollateralStrategyKind, CollateralStrategyKind>> = {
  straddle: 'strangle',
}

/**
 * Collapse presentation-only distinctions to the kind that owns the collateral
 * rule. Use this to look up a formula/explanation; use the raw kind to label.
 *
 * @param kind - The classified kind
 * @returns The kind whose rule governs it (itself, unless it is an alias)
 */
export function collateralRuleKindFor(kind: CollateralStrategyKind): CollateralStrategyKind {
  return SHARED_RULE[kind] ?? kind
}

/** One classified group of legs: either a recognized pair, or a single leg. */
export interface StrategyGroup {
  /** How the RiskEngine treats this group. */
  kind: CollateralStrategyKind
  /** Leg indices in the group, ascending. One entry, or two for a paired kind. */
  legIndices: bigint[]
  /**
   * The leg the contract actually charges, when only one of a pair carries the
   * requirement (spread charges the long leg, synthetic the short leg, the
   * composites the option leg). `null` when every leg in the group is charged —
   * standalone legs, and strangles/straddles, where each leg pays a reduced half.
   */
  chargedLegIndex: bigint | null
}

/** True when the two legs may be partnered at all (contract's gating condition). */
const partnersEligible = (a: DecodedLeg, b: DecodedLeg): boolean =>
  a.asset === b.asset && a.optionRatio === b.optionRatio

/**
 * Classify a tokenId's legs into the groups the RiskEngine charges.
 *
 * Mirrors `RiskEngine._getRequiredCollateralSingleLegPartner`: a leg is paired
 * only if its partner is a different leg, the partnership is mutual, the two
 * share an `asset` and `optionRatio`, AND the (width, isLong, tokenType, strike)
 * combination is one the contract recognizes. Anything else degrades to
 * standalone treatment — reported as `unrecognizedPair` so it is visible rather
 * than silent.
 *
 * @param tokenId - The position to classify
 * @returns One group per charged unit, in ascending leg order
 */
export function classifyStrategyGroups(tokenId: bigint): StrategyGroup[] {
  const legs = decodeAllLegs(tokenId)
  const byIndex = new Map(legs.map((leg) => [leg.index, leg]))
  const groups: StrategyGroup[] = []
  const consumed = new Set<bigint>()

  for (const leg of legs) {
    if (consumed.has(leg.index)) continue

    const partner = leg.riskPartner === leg.index ? undefined : byIndex.get(leg.riskPartner)
    // A partner that doesn't exist, or doesn't point back, is not a partnership.
    // TokenId.validate() rejects non-mutual pairings on-chain, so this is a
    // defensive path for tokenIds assembled off-chain.
    const mutual = partner !== undefined && partner.riskPartner === leg.index

    if (!mutual) {
      groups.push({ kind: standaloneKind(leg), legIndices: [leg.index], chargedLegIndex: null })
      continue
    }

    consumed.add(leg.index)
    consumed.add(partner.index)
    groups.push(classifyPair(leg, partner))
  }

  return groups
}

/** The kind of a leg the contract charges on its own. */
function standaloneKind(leg: DecodedLeg): CollateralStrategyKind {
  if (leg.width === 0n) return leg.isLong ? 'credit' : 'loan'
  if (leg.isLong) return leg.tokenType === 0n ? 'longCall' : 'longPut'
  return leg.tokenType === 0n ? 'shortCall' : 'shortPut'
}

/**
 * Classify a mutually-partnered pair. `a` and `b` are given in leg order; the
 * result is order-independent, which matters because the contract evaluates the
 * same pair from both indices and only charges one of them.
 */
function classifyPair(a: DecodedLeg, b: DecodedLeg): StrategyGroup {
  const legIndices = [a.index, b.index].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0))
  const unrecognized: StrategyGroup = {
    kind: 'unrecognizedPair',
    legIndices,
    chargedLegIndex: null,
  }

  if (!partnersEligible(a, b)) return unrecognized

  const aIsOption = a.width > 0n
  const bIsOption = b.width > 0n

  // Both legs are options.
  if (aIsOption && bIsOption) {
    if (a.tokenType !== b.tokenType) {
      if (!a.isLong && !b.isLong) {
        // STRANGLE / STRADDLE — both legs charged, each at half its base rate.
        // One branch on-chain; split here for naming only.
        return {
          kind: a.strike === b.strike ? 'straddle' : 'strangle',
          legIndices,
          chargedLegIndex: null,
        }
      }
      if (a.isLong !== b.isLong && a.strike === b.strike) {
        // SYNTHETIC STOCK — the same strike is mandatory; the short leg pays.
        return {
          kind: 'synthetic',
          legIndices,
          chargedLegIndex: a.isLong ? b.index : a.index,
        }
      }
      // Different tokenTypes, but neither a short/short pair nor a same-strike
      // long/short: e.g. a long/short pair at DIFFERENT strikes. Not recognized.
      return unrecognized
    }

    // Same tokenType.
    if (a.isLong !== b.isLong) {
      // SPREAD — defined risk, charged once, on the long leg.
      return {
        kind: 'spread',
        legIndices,
        chargedLegIndex: a.isLong ? a.index : b.index,
      }
    }
    // Same tokenType and same direction (both long or both short) — no netting.
    return unrecognized
  }

  // Exactly one leg is an option and the other is width=0 funding.
  if (aIsOption !== bIsOption) {
    const option = aIsOption ? a : b
    const funding = aIsOption ? b : a

    // The contract additionally requires matching tokenTypes for the composites.
    if (option.tokenType !== funding.tokenType) return unrecognized

    // A long funding leg is a CREDIT; a short one is a LOAN. Which composite it
    // forms then depends on the OPTION's direction. Note the contract reads this
    // off `isLongP` relative to whichever index it is evaluating — it returns 0
    // for the funding leg either way, so classifying from the option's
    // perspective is equivalent and order-independent.
    const kind: CollateralStrategyKind = funding.isLong
      ? option.isLong
        ? 'prepaidLongOption'
        : 'cashSecuredOption'
      : option.isLong
        ? 'optionProtectedLoan'
        : 'upfrontShortOption'

    return { kind, legIndices, chargedLegIndex: option.index }
  }

  // Both legs width=0 (two loans/credits partnered) — not a recognized strategy.
  return unrecognized
}

/**
 * Rebuild a group as a standalone tokenId on the same pool, so it can be priced
 * on its own.
 *
 * Legs are re-indexed to `0..n-1` and `riskPartner` is remapped to stay
 * self-consistent — otherwise an isolated leg would point at an index that no
 * longer exists and the contract would reject the tokenId.
 *
 * @param tokenId - The full position (supplies the poolId and leg data)
 * @param legIndices - Indices of the legs to isolate
 * @returns A valid tokenId containing only those legs
 */
export function isolateGroupTokenId(tokenId: bigint, legIndices: bigint[]): bigint {
  const legs = decodeAllLegs(tokenId)
  const byIndex = new Map(legs.map((leg) => [leg.index, leg]))
  const ordered = [...legIndices].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0))
  const remapped = new Map(ordered.map((old, i) => [old, BigInt(i)]))

  let out = tokenId & POOL_ID_MASK
  for (const [index, oldIndex] of ordered.entries()) {
    const leg = byIndex.get(oldIndex)
    if (leg === undefined) {
      throw new PanopticError(`isolateGroupTokenId: leg ${oldIndex} is not present in the tokenId`)
    }
    const newIndex = BigInt(index)
    // A partner outside this group cannot survive isolation — self-partner it,
    // which is the encoding for "no partner".
    const newPartner = remapped.get(leg.riskPartner) ?? newIndex
    out = addLegToTokenId(out, {
      index: newIndex,
      asset: leg.asset,
      tokenType: leg.tokenType,
      optionRatio: leg.optionRatio,
      isLong: leg.isLong ? 1n : 0n,
      riskPartner: newPartner,
      strike: leg.strike,
      width: leg.width,
    })
  }
  return out
}

/** A classified group plus its share of the requirement. */
export interface StrategyAllocation extends StrategyGroup {
  /**
   * The group priced in isolation, in token0 units, scaled to `positionSize`.
   * `null` when that pricing failed (reverted or returned the sentinel).
   */
  isolatedRequired0: bigint | null
  /**
   * This group's share of the AUTHORITATIVE total, apportioned by
   * `isolatedRequired0`. `null` when this group could not be priced, or when no
   * group could — in which case the total is reported without a split rather
   * than with a fabricated one.
   */
  allocated: bigint | null
}

/** Parameters for {@link estimateCollateralBreakdown}. */
export interface EstimateCollateralBreakdownParams {
  /** Minimal viem client surface used by this read. */
  client: Pick<PublicClient, 'getBlock' | 'getBlockNumber' | 'multicall'>
  /** PanopticPool address */
  poolAddress: Address
  /** PanopticQuery address (holds `getRequiredBase`) */
  queryAddress: Address
  /** The position being explained */
  tokenId: bigint
  /** Position size (number of contracts) */
  positionSize: bigint
  /**
   * The authoritative requirement to apportion, in token0 units — the figure the
   * UI already displays, from the simulation or from `getRequiredBase` on the
   * whole position. Omit to report classification and isolated prices only.
   */
  authoritativeRequired0?: bigint
  /** Tick to price at. Defaults to the pool's current tick. */
  atTick?: bigint
  /** Optional block number, pinning every group to one block */
  blockNumber?: bigint
  /** Optional pre-fetched block metadata */
  _meta?: BlockMeta
}

/** Result of {@link estimateCollateralBreakdown}. */
export interface CollateralBreakdown {
  /** One entry per charged group, in ascending leg order. */
  allocations: StrategyAllocation[]
  /** The total that was apportioned, echoed back. `null` if none was supplied. */
  authoritativeRequired0: bigint | null
  /**
   * True when at least one group could not be priced, so the split covers less
   * than the whole position. The total remains authoritative either way — the
   * UI must say the breakdown is partial rather than imply the rest is free.
   */
  partial: boolean
  /** Block metadata */
  _meta: BlockMeta
}

/**
 * Classify a position and estimate how its collateral requirement splits across
 * the strategies the RiskEngine recognizes.
 *
 * Every group is priced in ONE multicall, at one tick and one block, so the
 * weights are mutually consistent. A group that reverts or returns the
 * `getRequiredBase` error sentinel is dropped from the apportionment (and flips
 * `partial`) rather than being scaled from a garbage value.
 *
 * The apportionment preserves the total exactly: shares are floor-divided and
 * the rounding residue is given to the last priced group, so the allocations sum
 * to `authoritativeRequired0` with no bigint dust.
 *
 * @param params - The parameters
 * @returns The classified groups with their estimated allocations
 */
export async function estimateCollateralBreakdown(
  params: EstimateCollateralBreakdownParams,
): Promise<CollateralBreakdown> {
  const {
    client,
    poolAddress,
    queryAddress,
    tokenId,
    positionSize,
    authoritativeRequired0,
    atTick,
    blockNumber,
  } = params

  if (
    blockNumber !== undefined &&
    params._meta !== undefined &&
    params._meta.blockNumber !== blockNumber
  ) {
    throw new PanopticError(
      'estimateCollateralBreakdown: blockNumber and _meta.blockNumber disagree; cannot guarantee same-block consistency',
    )
  }

  const targetBlockNumber =
    blockNumber ?? params._meta?.blockNumber ?? (await client.getBlockNumber())

  const groups = classifyStrategyGroups(tokenId)

  // One tick for every group, so the weights are mutually comparable.
  const effectiveTick =
    atTick ??
    BigInt(
      (
        await client.multicall({
          contracts: [
            {
              address: poolAddress,
              abi: panopticPoolV2Abi,
              functionName: 'getCurrentTick',
            },
          ],
          blockNumber: targetBlockNumber,
          allowFailure: false,
        })
      )[0],
    )

  const [results, _meta] = await Promise.all([
    client.multicall({
      contracts: groups.map((group) => ({
        address: queryAddress,
        abi: panopticQueryAbi,
        functionName: 'getRequiredBase' as const,
        args: [poolAddress, isolateGroupTokenId(tokenId, group.legIndices), Number(effectiveTick)],
      })),
      blockNumber: targetBlockNumber,
      allowFailure: true,
    }),
    params._meta ?? getBlockMeta({ client, blockNumber: targetBlockNumber }),
  ])

  const isolated = results.map((result) => {
    if (result.status !== 'success') return null
    const raw = result.result as bigint
    // The sentinel is type(uint128).max, not a requirement — never scale it.
    if (raw >= REQUIRED_BASE_ERROR_SENTINEL) return null
    return (raw * positionSize) / MAX_UINT64
  })

  const allocations = apportion(groups, isolated, authoritativeRequired0 ?? null)

  return {
    allocations,
    authoritativeRequired0: authoritativeRequired0 ?? null,
    partial: isolated.some((value) => value === null),
    _meta,
  }
}

/**
 * Split `total` across the priced groups in proportion to their isolated
 * requirements, giving the rounding residue to the last priced group so the
 * parts sum to the whole exactly.
 *
 * Exported for testing; the allocation is pure and worth pinning independently
 * of the RPC layer.
 *
 * @param groups - The classified groups
 * @param isolated - Per-group isolated price, `null` where pricing failed
 * @param total - The authoritative total to apportion, or `null` for none
 * @returns Allocations aligned 1:1 with `groups`
 */
export function apportion(
  groups: StrategyGroup[],
  isolated: (bigint | null)[],
  total: bigint | null,
): StrategyAllocation[] {
  if (groups.length !== isolated.length) {
    throw new PanopticError(
      `apportion: groups and isolated must have equal lengths (${groups.length} !== ${isolated.length})`,
    )
  }

  const weightSum = isolated.reduce<bigint>((sum, value) => sum + (value ?? 0n), 0n)

  // Nothing to apportion, or nothing to apportion it by. Report the
  // classification without inventing numbers — a group showing 0 would read as
  // "this part is free", which is a different and wrong claim.
  if (total === null || total <= 0n || weightSum <= 0n) {
    return groups.map((group, i) => ({
      ...group,
      isolatedRequired0: isolated[i],
      allocated: null,
    }))
  }

  const lastPriced = isolated.reduce<number>((last, value, i) => (value === null ? last : i), -1)

  let assigned = 0n
  return groups.map((group, i) => {
    const weight = isolated[i]
    if (weight === null) {
      return { ...group, isolatedRequired0: null, allocated: null }
    }
    // The last priced group absorbs the floor-division residue, so the
    // allocations sum to `total` exactly.
    const allocated = i === lastPriced ? total - assigned : (total * weight) / weightSum
    assigned += allocated
    return { ...group, isolatedRequired0: weight, allocated }
  })
}
