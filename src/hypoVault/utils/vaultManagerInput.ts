import { type Address, type Client, ContractFunctionExecutionError } from 'viem'
import { readContract } from 'viem/actions'

import { panopticPoolV2Abi as panopticPoolAbi } from '../../abis/panoptic_v2_abis'
import {
  BASE_CHAIN_ID,
  MAINNET_CHAIN_ID,
  requireChainDeployment,
  SEPOLIA_CHAIN_ID,
} from '../chainDeployments'
import { BaseUSDCPLPVaultPoolInfos } from '../hypoVaultManagerArtifacts/BaseUSDCPLPVaultPoolInfos'
import { BaseWETHPLPVaultPoolInfos } from '../hypoVaultManagerArtifacts/BaseWETHPLPVaultPoolInfos'
import {
  MainnetUSDCPLPLegacyVaultPoolInfos,
  MainnetUSDCPLPVaultPoolInfos,
} from '../hypoVaultManagerArtifacts/MainnetUSDCPLPVaultPoolInfos'
import {
  MainnetWETHPLPLegacyVaultPoolInfos,
  MainnetWETHPLPVaultPoolInfos,
} from '../hypoVaultManagerArtifacts/MainnetWETHPLPVaultPoolInfos'
import { SepoliaUSDCPLPVaultPoolInfos } from '../hypoVaultManagerArtifacts/SepoliaUSDCPLPVaultPoolInfos'
import { SepoliaWETHPLPVaultPoolInfos } from '../hypoVaultManagerArtifacts/SepoliaWETHPLPVaultPoolInfos'
import { type PoolInfo, buildManagerInput } from './buildManagerInput'
import { buildManagerInputAtBlock } from './buildManagerInputAtBlock'

const DEFAULT_MANAGER_INPUT = '0x' as const
const PAGE_SIZE = 1000

type CandidateTokenIdsByPool = Map<string, Set<bigint>>

type VaultPoolInfoArtifact = {
  readonly vaultAddress: Address
  readonly poolInfos: readonly PoolInfo[]
}

const VAULT_POOL_INFOS_BY_CHAIN: Record<number, readonly VaultPoolInfoArtifact[]> = {
  [MAINNET_CHAIN_ID]: [
    MainnetUSDCPLPVaultPoolInfos,
    MainnetWETHPLPVaultPoolInfos,
    MainnetUSDCPLPLegacyVaultPoolInfos,
    MainnetWETHPLPLegacyVaultPoolInfos,
  ],
  [SEPOLIA_CHAIN_ID]: [SepoliaUSDCPLPVaultPoolInfos, SepoliaWETHPLPVaultPoolInfos],
  [BASE_CHAIN_ID]: [BaseUSDCPLPVaultPoolInfos, BaseWETHPLPVaultPoolInfos],
}

const GET_POOL_ACCOUNT_BALANCE_CANDIDATES = `
  query PoolAccountBalanceCandidates(
    $first: Int!
    $skip: Int!
    $poolIds: [String!]!
    $vault: String!
  ) {
    panopticPoolAccounts(
      first: $first
      skip: $skip
      where: { panopticPool_in: $poolIds, account: $vault }
    ) {
      panopticPool {
        id
      }
      accountBalances(where: { isOpen: 1 }) {
        tokenId {
          id
        }
      }
    }
  }
`

const GET_OPTION_EVENT_CANDIDATES = `
  query OptionEventCandidates(
    $first: Int!
    $skip: Int!
    $poolIds: [String!]!
    $recipients: [String!]!
  ) {
    optionMints(
      first: $first
      skip: $skip
      orderBy: timestamp
      orderDirection: desc
      where: { panopticPool_in: $poolIds, recipient_in: $recipients }
    ) {
      panopticPool {
        id
      }
      tokenId {
        id
        idHexString
      }
    }
    optionBurns(
      first: $first
      skip: $skip
      orderBy: timestamp
      orderDirection: desc
      where: { panopticPool_in: $poolIds, recipient_in: $recipients }
    ) {
      panopticPool {
        id
      }
      tokenId {
        id
        idHexString
      }
    }
  }
`

type GraphQLError = { message?: string }

type GraphQLResponse<T> = {
  data?: T
  errors?: GraphQLError[]
}

type PoolAccountBalanceCandidatesResponse = {
  panopticPoolAccounts: Array<{
    panopticPool: { id: string }
    accountBalances: Array<{ tokenId: { id: string } | null }>
  }>
}

type OptionEventCandidatesResponse = {
  optionMints: Array<{
    panopticPool: { id: string }
    tokenId: { id: string; idHexString: string }
  }>
  optionBurns: Array<{
    panopticPool: { id: string }
    tokenId: { id: string; idHexString: string }
  }>
}

type FetchInit = {
  method?: string
  headers?: Record<string, string>
  body?: string
}

type FetchResponseLike = {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}

type FetchLike = (input: string, init?: FetchInit) => Promise<FetchResponseLike>

function toLowerAddress(address: string): string {
  return address.toLowerCase()
}

function parseTokenId(value: string | null | undefined): bigint | null {
  if (value === undefined || value === null || value.length === 0) {
    return null
  }

  try {
    return BigInt(value)
  } catch {
    return null
  }
}

function ensurePoolCandidateSet(
  candidatesByPool: CandidateTokenIdsByPool,
  poolAddress: string,
): Set<bigint> {
  const poolAddressLower = toLowerAddress(poolAddress)
  const existing = candidatesByPool.get(poolAddressLower)
  if (existing !== undefined) {
    return existing
  }
  const created = new Set<bigint>()
  candidatesByPool.set(poolAddressLower, created)
  return created
}

async function postGraphQL<T>({
  endpoint,
  query,
  variables,
  fetchFn,
}: {
  endpoint: string
  query: string
  variables: Record<string, unknown>
  fetchFn: FetchLike
}): Promise<T> {
  const response = await fetchFn(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query,
      variables,
    }),
  })

  if (!response.ok) {
    throw new Error(`GraphQL request failed (${response.status})`)
  }

  const json = (await response.json()) as GraphQLResponse<T>
  if ((json.errors?.length ?? 0) > 0) {
    throw new Error(json.errors?.[0]?.message ?? 'GraphQL request failed')
  }
  if (json.data === undefined) {
    throw new Error('GraphQL response did not include data')
  }

  return json.data
}

async function collectPoolAccountBalanceCandidates({
  endpoint,
  poolIds,
  vaultAddress,
  candidatesByPool,
  fetchFn,
}: {
  endpoint: string
  poolIds: string[]
  vaultAddress: string
  candidatesByPool: CandidateTokenIdsByPool
  fetchFn: FetchLike
}): Promise<void> {
  for (let skip = 0; ; skip += PAGE_SIZE) {
    const page = await postGraphQL<PoolAccountBalanceCandidatesResponse>({
      endpoint,
      query: GET_POOL_ACCOUNT_BALANCE_CANDIDATES,
      variables: {
        first: PAGE_SIZE,
        skip,
        poolIds,
        vault: vaultAddress,
      },
      fetchFn,
    })

    for (const account of page.panopticPoolAccounts) {
      const poolSet = ensurePoolCandidateSet(candidatesByPool, account.panopticPool.id)
      for (const balance of account.accountBalances) {
        const tokenId = parseTokenId(balance.tokenId?.id)
        if (tokenId !== null) {
          poolSet.add(tokenId)
        }
      }
    }

    if (page.panopticPoolAccounts.length < PAGE_SIZE) {
      break
    }
  }
}

async function collectOptionEventCandidates({
  endpoint,
  poolIds,
  recipientAddresses,
  candidatesByPool,
  fetchFn,
}: {
  endpoint: string
  poolIds: string[]
  recipientAddresses: string[]
  candidatesByPool: CandidateTokenIdsByPool
  fetchFn: FetchLike
}): Promise<void> {
  for (let skip = 0; ; skip += PAGE_SIZE) {
    const page = await postGraphQL<OptionEventCandidatesResponse>({
      endpoint,
      query: GET_OPTION_EVENT_CANDIDATES,
      variables: {
        first: PAGE_SIZE,
        skip,
        poolIds,
        recipients: recipientAddresses,
      },
      fetchFn,
    })

    const events = [...page.optionMints, ...page.optionBurns]
    for (const event of events) {
      const poolSet = ensurePoolCandidateSet(candidatesByPool, event.panopticPool.id)
      const parsedFromHex = parseTokenId(event.tokenId.idHexString)
      if (parsedFromHex !== null) {
        poolSet.add(parsedFromHex)
      }
      const parsedFromId = parseTokenId(event.tokenId.id)
      if (parsedFromId !== null) {
        poolSet.add(parsedFromId)
      }
    }

    if (page.optionMints.length < PAGE_SIZE && page.optionBurns.length < PAGE_SIZE) {
      break
    }
  }
}

function sortBigintsAscending(values: Iterable<bigint>): bigint[] {
  return Array.from(values).sort((left, right) => {
    if (left < right) {
      return -1
    }
    if (left > right) {
      return 1
    }
    return 0
  })
}

function extractPositionSizeFromPackedBalance(value: unknown): bigint | null {
  if (typeof value !== 'bigint') {
    return null
  }
  return value & ((1n << 128n) - 1n)
}

// When the whole-batch read reverts (any single bad tokenId — burned or
// not-yet-minted at `blockNumber` — reverts `getFullPositionsData` for the
// entire list), we bisect the candidate list. This way a handful of bad
// tokenIds collapses to O(log N) reads instead of O(N), and the leaf-level
// per-tokenId reads run in parallel so viem's JSON-RPC batching can fold
// them into a single HTTP request.
const BISECT_LEAF_THRESHOLD = 1

async function readPositionBalances({
  viemClient,
  poolAddress,
  account,
  candidates,
  blockNumber,
}: {
  viemClient: Client
  poolAddress: Address
  account: Address
  candidates: readonly bigint[]
  blockNumber: bigint
}): Promise<readonly unknown[] | null> {
  let result: unknown
  try {
    result = await readContract(viemClient, {
      address: poolAddress,
      abi: panopticPoolAbi,
      functionName: 'getFullPositionsData',
      args: [account, false, candidates],
      blockNumber,
    })
  } catch (error) {
    // Only treat contract reverts (e.g. `PositionNotOwned` from a stale
    // candidate) as "bad batch — caller should bisect". Transport, JSON-RPC,
    // or other transient failures must propagate so the caller doesn't
    // silently treat a network blip as "all candidates closed".
    if (error instanceof ContractFunctionExecutionError) {
      return null
    }
    throw error
  }
  const maybePositionBalances = Array.isArray(result) ? result[2] : undefined
  if (!Array.isArray(maybePositionBalances)) {
    return null
  }
  return maybePositionBalances
}

async function filterOpenTokenIdsAtBlock({
  viemClient,
  poolAddress,
  account,
  candidates,
  blockNumber,
}: {
  viemClient: Client
  poolAddress: Address
  account: Address
  candidates: readonly bigint[]
  blockNumber: bigint
}): Promise<bigint[]> {
  if (candidates.length === 0) {
    return []
  }

  const collectOpen = async (chunk: readonly bigint[]): Promise<bigint[]> => {
    if (chunk.length === 0) {
      return []
    }

    const balances = await readPositionBalances({
      viemClient,
      poolAddress,
      account,
      candidates: chunk,
      blockNumber,
    })

    if (balances !== null) {
      const open: bigint[] = []
      for (let index = 0; index < chunk.length; index += 1) {
        const tokenId = chunk[index]
        const positionSize = extractPositionSizeFromPackedBalance(balances[index])
        if (tokenId !== undefined && positionSize !== null && positionSize > 0n) {
          open.push(tokenId)
        }
      }
      return open
    }

    if (chunk.length <= BISECT_LEAF_THRESHOLD) {
      // Single bad tokenId — drop it.
      return []
    }

    const mid = chunk.length >> 1
    const [leftOpen, rightOpen] = await Promise.all([
      collectOpen(chunk.slice(0, mid)),
      collectOpen(chunk.slice(mid)),
    ])
    return [...leftOpen, ...rightOpen]
  }

  const openTokenIds = await collectOpen(candidates)
  return sortBigintsAscending(openTokenIds)
}

export function getVaultPoolInfos(vaultAddress: Address, chainId?: number): readonly PoolInfo[] {
  const vaultAddressLower = toLowerAddress(vaultAddress)
  const artifacts =
    chainId === undefined
      ? Object.values(VAULT_POOL_INFOS_BY_CHAIN).flat()
      : (VAULT_POOL_INFOS_BY_CHAIN[chainId] ?? [])
  const artifact = artifacts.find(
    (candidate) => toLowerAddress(candidate.vaultAddress) === vaultAddressLower,
  )
  return artifact?.poolInfos ?? []
}

export type VaultPoolCandidateTokenIds = {
  poolAddress: Address
  /**
   * All-time candidate tokenIds (subgraph balances ∪ option events), sorted
   * ascending. Block-INDEPENDENT: a superset valid for any historical block.
   */
  candidates: bigint[]
}

/**
 * Resolve the block-INDEPENDENT candidate tokenIds per pool for a vault — i.e. the
 * two subgraph paging queries only, with no on-chain verification. Pair with
 * {@link verifyVaultOpenTokenIdsAtBlock} to narrow to positions open at a given
 * block. Splitting these out lets a timeseries fetch the candidate set ONCE per
 * vault instead of re-running the subgraph paging for every anchor block. The
 * combined {@link resolveVaultTokenIdsByPool} remains for one-shot callers.
 */
export async function resolveVaultHistoricalCandidatesByPool({
  chainId,
  vaultAddress,
  managerAddress,
  poolInfos,
  panopticSubgraphUrl,
  fetchFn = fetch,
}: {
  chainId: number
  vaultAddress: Address
  managerAddress?: Address | null
  poolInfos?: readonly PoolInfo[]
  panopticSubgraphUrl?: string
  fetchFn?: FetchLike
}): Promise<VaultPoolCandidateTokenIds[]> {
  const resolvedPoolInfos = poolInfos ?? getVaultPoolInfos(vaultAddress, chainId)
  if (resolvedPoolInfos.length === 0) {
    return []
  }

  const configuredEndpoint =
    panopticSubgraphUrl ?? requireChainDeployment(chainId).subgraphs.panoptic
  if (configuredEndpoint === undefined) {
    return resolvedPoolInfos.map((poolInfo) => ({ poolAddress: poolInfo.pool, candidates: [] }))
  }

  const vaultAddressLower = toLowerAddress(vaultAddress)
  const recipientAddresses = Array.from(
    new Set(
      [vaultAddressLower, managerAddress?.toLowerCase()]
        .filter((value): value is string => value !== undefined && value.length > 0)
        .map((value) => value.toLowerCase()),
    ),
  )
  const poolIds = Array.from(
    new Set(resolvedPoolInfos.map((poolInfo) => toLowerAddress(poolInfo.pool))),
  )

  const balanceCandidatesByPool: CandidateTokenIdsByPool = new Map()
  const eventCandidatesByPool: CandidateTokenIdsByPool = new Map()

  await collectPoolAccountBalanceCandidates({
    endpoint: configuredEndpoint,
    poolIds,
    vaultAddress: vaultAddressLower,
    candidatesByPool: balanceCandidatesByPool,
    fetchFn,
  })

  await collectOptionEventCandidates({
    endpoint: configuredEndpoint,
    poolIds,
    recipientAddresses,
    candidatesByPool: eventCandidatesByPool,
    fetchFn,
  })

  return resolvedPoolInfos.map((poolInfo) => {
    const poolAddressLower = toLowerAddress(poolInfo.pool)
    const openBalances = balanceCandidatesByPool.get(poolAddressLower) ?? new Set<bigint>()
    const eventCandidates = eventCandidatesByPool.get(poolAddressLower) ?? new Set<bigint>()
    const candidates = sortBigintsAscending(new Set<bigint>([...openBalances, ...eventCandidates]))
    return { poolAddress: poolInfo.pool, candidates }
  })
}

/**
 * Narrow pre-resolved {@link VaultPoolCandidateTokenIds} to the tokenIds actually
 * open at `blockNumber`, per pool, via on-chain `getFullPositionsData` (bisecting
 * on stale candidates). This is the per-block half of the candidate/verify split.
 */
export async function verifyVaultOpenTokenIdsAtBlock({
  viemClient,
  vaultAddress,
  candidatesByPool,
  blockNumber,
}: {
  viemClient: Client
  vaultAddress: Address
  candidatesByPool: readonly VaultPoolCandidateTokenIds[]
  blockNumber: bigint
}): Promise<bigint[][]> {
  const tokenIdsByPool: bigint[][] = []
  for (const { poolAddress, candidates } of candidatesByPool) {
    const openTokenIds = await filterOpenTokenIdsAtBlock({
      viemClient,
      poolAddress,
      account: vaultAddress,
      candidates,
      blockNumber,
    })
    tokenIdsByPool.push(openTokenIds)
  }
  return tokenIdsByPool
}

export async function resolveVaultTokenIdsByPool({
  viemClient,
  chainId,
  vaultAddress,
  managerAddress,
  poolInfos,
  panopticSubgraphUrl,
  verificationBlockNumber,
  fetchFn = fetch,
}: {
  viemClient: Client
  chainId: number
  vaultAddress: Address
  managerAddress?: Address | null
  poolInfos?: readonly PoolInfo[]
  panopticSubgraphUrl?: string
  verificationBlockNumber?: bigint
  fetchFn?: FetchLike
}): Promise<bigint[][]> {
  const resolvedPoolInfos = poolInfos ?? getVaultPoolInfos(vaultAddress, chainId)
  if (resolvedPoolInfos.length === 0) {
    return []
  }

  const configuredEndpoint =
    panopticSubgraphUrl ?? requireChainDeployment(chainId).subgraphs.panoptic
  if (configuredEndpoint === undefined) {
    return resolvedPoolInfos.map(() => [])
  }

  const vaultAddressLower = toLowerAddress(vaultAddress)
  const recipientAddresses = Array.from(
    new Set(
      [vaultAddressLower, managerAddress?.toLowerCase()]
        .filter((value): value is string => value !== undefined && value.length > 0)
        .map((value) => value.toLowerCase()),
    ),
  )
  const poolIds = Array.from(
    new Set(resolvedPoolInfos.map((poolInfo) => toLowerAddress(poolInfo.pool))),
  )

  const balanceCandidatesByPool: CandidateTokenIdsByPool = new Map()
  const eventCandidatesByPool: CandidateTokenIdsByPool = new Map()

  await collectPoolAccountBalanceCandidates({
    endpoint: configuredEndpoint,
    poolIds,
    vaultAddress: vaultAddressLower,
    candidatesByPool: balanceCandidatesByPool,
    fetchFn,
  })

  await collectOptionEventCandidates({
    endpoint: configuredEndpoint,
    poolIds,
    recipientAddresses,
    candidatesByPool: eventCandidatesByPool,
    fetchFn,
  })

  const tokenIdsByPool: bigint[][] = []
  for (const poolInfo of resolvedPoolInfos) {
    const poolAddressLower = toLowerAddress(poolInfo.pool)
    const openBalances = sortBigintsAscending(balanceCandidatesByPool.get(poolAddressLower) ?? [])

    if (verificationBlockNumber !== undefined) {
      const eventCandidates = sortBigintsAscending(
        eventCandidatesByPool.get(poolAddressLower) ?? [],
      )
      const historicalCandidates = sortBigintsAscending(
        Array.from(new Set([...openBalances, ...eventCandidates])),
      )
      const historicalOpenTokenIds = await filterOpenTokenIdsAtBlock({
        viemClient,
        poolAddress: poolInfo.pool,
        account: vaultAddress,
        candidates: historicalCandidates,
        blockNumber: verificationBlockNumber,
      })
      tokenIdsByPool.push(historicalOpenTokenIds)
      continue
    }

    if (openBalances.length > 0) {
      tokenIdsByPool.push(openBalances)
      continue
    }

    const eventCandidates = sortBigintsAscending(eventCandidatesByPool.get(poolAddressLower) ?? [])
    if (eventCandidates.length === 0) {
      tokenIdsByPool.push([])
      continue
    }

    try {
      const result = await readContract(viemClient, {
        address: poolInfo.pool,
        abi: panopticPoolAbi,
        functionName: 'getFullPositionsData',
        args: [vaultAddress, false, eventCandidates],
        ...(verificationBlockNumber === undefined ? {} : { blockNumber: verificationBlockNumber }),
      })

      const maybePositionBalances = Array.isArray(result) ? result[2] : undefined
      if (!Array.isArray(maybePositionBalances)) {
        tokenIdsByPool.push([])
        continue
      }

      const openTokenIds: bigint[] = []
      for (let index = 0; index < eventCandidates.length; index += 1) {
        const tokenId = eventCandidates[index]
        const packedBalance = maybePositionBalances[index]
        if (tokenId === undefined || typeof packedBalance !== 'bigint') {
          continue
        }
        const positionSize = packedBalance & ((1n << 128n) - 1n)
        if (positionSize > 0n) {
          openTokenIds.push(tokenId)
        }
      }
      tokenIdsByPool.push(sortBigintsAscending(openTokenIds))
    } catch {
      // If fallback verification fails, return no positions for safety.
      tokenIdsByPool.push([])
    }
  }

  return tokenIdsByPool
}

export async function buildVaultManagerInput({
  viemClient,
  chainId,
  vaultAddress,
  underlyingToken,
  managerAddress,
  panopticSubgraphUrl,
  fetchFn,
}: {
  viemClient: Client
  chainId: number
  vaultAddress: Address
  underlyingToken: Address
  managerAddress?: Address | null
  panopticSubgraphUrl?: string
  fetchFn?: FetchLike
}): Promise<`0x${string}`> {
  const poolInfos = getVaultPoolInfos(vaultAddress, chainId)
  if (poolInfos.length === 0) {
    return DEFAULT_MANAGER_INPUT
  }

  const tokenIds = await resolveVaultTokenIdsByPool({
    viemClient,
    chainId,
    vaultAddress,
    managerAddress,
    poolInfos,
    panopticSubgraphUrl,
    fetchFn,
  })

  return buildManagerInput({
    viemClient,
    poolInfos,
    tokenIds,
    underlyingToken,
  })
}

export async function buildVaultManagerInputAtBlock({
  viemClient,
  chainId,
  vaultAddress,
  underlyingToken,
  blockNumber,
  managerAddress,
  panopticSubgraphUrl,
  fetchFn,
}: {
  viemClient: Client
  chainId: number
  vaultAddress: Address
  underlyingToken: Address
  blockNumber: bigint
  managerAddress?: Address | null
  panopticSubgraphUrl?: string
  fetchFn?: FetchLike
}): Promise<`0x${string}`> {
  const poolInfos = getVaultPoolInfos(vaultAddress, chainId)
  if (poolInfos.length === 0) {
    return DEFAULT_MANAGER_INPUT
  }

  const tokenIds = await resolveVaultTokenIdsByPool({
    viemClient,
    chainId,
    vaultAddress,
    managerAddress,
    poolInfos,
    panopticSubgraphUrl,
    verificationBlockNumber: blockNumber,
    fetchFn,
  })

  return buildManagerInputAtBlock({
    viemClient,
    poolInfos,
    tokenIds,
    underlyingToken,
    blockNumber,
  })
}
