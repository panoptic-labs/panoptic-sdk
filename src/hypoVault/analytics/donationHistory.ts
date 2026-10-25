import {
  type Address,
  type EIP1193RequestFn,
  type PublicClient,
  decodeAbiParameters,
  decodeEventLog,
  erc20Abi,
  parseAbi,
  zeroAddress,
} from 'viem'
import { z } from 'zod'

import { HypoVaultAbi } from '../../abis/HypoVault'
import {
  builderFactoryAbi,
  builderWalletAbi,
  collateralTrackerV2Abi,
  panopticPoolV2Abi,
  riskEngineAbi,
} from '../../abis/panoptic_v2_abis'
import { PanopticVaultAccountantManagerInputAbi } from '../../abis/PanopticVaultAccountantManagerInput'
import { requireChainDeployment } from '../chainDeployments'
import {
  getMainnetVaultPoolConfigurationAtBlock,
  getMainnetVaultPoolConfigurationHistory,
} from '../mainnetVaultPoolHistory'
import { type VaultSharePriceSnapshot } from '../sharePrice/types'
import { donationRetainedFactor, valueDonationInUnderlying } from './donations'

const guardianAbi = parseAbi([
  'function GUARDIAN_ADMIN() view returns (address)',
  'function TREASURER() view returns (address)',
])

const nativeTraceSchema = z.array(
  z.object({
    action: z.object({
      from: z.string().optional(),
      to: z.string().optional(),
      value: z.string().optional(),
      callType: z.string().optional(),
    }),
    type: z.string(),
    error: z.string().optional(),
    blockNumber: z.number().int(),
    transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  }),
)

async function getNativeDonationTransfers(
  client: PublicClient,
  vault: Address,
  sources: readonly string[],
  fromBlock: bigint,
  toBlock: bigint,
  confirmedTransactions: readonly string[],
) {
  const request = client.request as EIP1193RequestFn<
    [
      {
        Method: 'trace_filter'
        Parameters: [
          {
            fromBlock: string
            toBlock: string
            toAddress: Address[]
            after: number
            count: number
          },
        ]
        ReturnType: unknown
      },
    ]
  >
  const transfers: {
    blockNumber: bigint
    token: Address
    amount: bigint
    transactionHash: `0x${string}`
    logIndex: number
  }[] = []
  for (let page = 0; page < 100; page++) {
    const traces = nativeTraceSchema.parse(
      await request({
        method: 'trace_filter',
        params: [
          {
            fromBlock: `0x${fromBlock.toString(16)}`,
            toBlock: `0x${toBlock.toString(16)}`,
            toAddress: [vault],
            after: page * 1000,
            count: 1000,
          },
        ],
      }),
    )
    for (const trace of traces) {
      if (
        trace.error !== undefined ||
        trace.type !== 'call' ||
        trace.action.callType !== 'call' ||
        trace.action.to?.toLowerCase() !== vault.toLowerCase() ||
        (!sources.includes(trace.action.from?.toLowerCase() ?? '') &&
          !confirmedTransactions.includes(trace.transactionHash.toLowerCase())) ||
        trace.action.value === undefined
      )
        continue
      const amount = BigInt(trace.action.value)
      if (amount > 0n)
        transfers.push({
          blockNumber: BigInt(trace.blockNumber),
          token: zeroAddress,
          amount,
          transactionHash: trace.transactionHash as `0x${string}`,
          logIndex: -1,
        })
    }
    if (traces.length < 1000) return transfers
  }
  throw new Error('Native donation history exceeded pagination limit')
}

/** Resolve fee counterparties from deployed contracts, including builder wallet administrators. */
export async function getVaultDonationSources(
  client: PublicClient,
  chainId: number,
  toBlock: bigint,
) {
  const deployment = requireChainDeployment(chainId)
  const factory = deployment.panoptic.v2.builderFactory
  const [builders, owner, guardians] = await Promise.all([
    client.getContractEvents({
      address: factory,
      abi: builderFactoryAbi,
      eventName: 'BuilderWalletDeployed',
      strict: true,
      fromBlock: 0n,
      toBlock,
    }),
    client.readContract({
      address: factory,
      abi: builderFactoryAbi,
      functionName: 'OWNER',
      blockNumber: toBlock,
    }),
    Promise.all(
      [...new Set([...deployment.riskEngines, ...(deployment.deprecatedRiskEngines ?? [])])].map(
        async (address) => {
          const guardian = await client.readContract({
            address,
            abi: riskEngineAbi,
            functionName: 'GUARDIAN',
            blockNumber: toBlock,
          })
          const [admin, treasurer] = await Promise.all(
            ['GUARDIAN_ADMIN', 'TREASURER'].map((functionName) =>
              client.readContract({
                address: guardian,
                abi: guardianAbi,
                functionName: functionName as 'GUARDIAN_ADMIN' | 'TREASURER',
                blockNumber: toBlock,
              }),
            ),
          )
          return [address, guardian, admin, treasurer]
        },
      ),
    ),
  ])
  const currentAdmins = await Promise.all(
    builders.map((event) =>
      client.readContract({
        address: event.args.wallet,
        abi: builderWalletAbi,
        functionName: 'builderAdmin',
        blockNumber: toBlock,
      }),
    ),
  )
  return [
    ...new Set(
      [
        owner,
        ...guardians.flat(),
        ...currentAdmins,
        ...builders.flatMap((event) => [event.args.wallet, event.args.builderAdmin]),
      ]
        .filter((address): address is Address => address !== undefined && address !== zeroAddress)
        .map((address) => address.toLowerCase()),
    ),
  ]
}

export async function getVaultDonationTransfers({
  client,
  vaultAddress,
  chainId,
  fromBlock,
  toBlock,
  sources,
  confirmedTransactions = [],
}: {
  client: PublicClient
  vaultAddress: Address
  chainId: number
  fromBlock: bigint
  toBlock: bigint
  sources: readonly string[]
  confirmedTransactions?: readonly string[]
}) {
  const history = getMainnetVaultPoolConfigurationHistory({ chainId, vaultAddress })
  if (history === null || history === undefined) throw new Error('Missing vault pool history')
  const pools = [
    ...new Map(
      history
        .flatMap((configuration) => configuration.poolInfos)
        .map((pool) => [pool.pool.toLowerCase(), pool]),
    ).values(),
  ]
  const trackers = await Promise.all(
    pools.map(async (pool) => ({
      ...pool,
      trackers: await Promise.all(
        ['collateralToken0', 'collateralToken1'].map((functionName) =>
          client.readContract({
            address: pool.pool,
            abi: panopticPoolV2Abi,
            functionName: functionName as 'collateralToken0' | 'collateralToken1',
            blockNumber: toBlock,
          }),
        ),
      ),
    })),
  )
  const recognizedTokens = new Set(
    trackers
      .flatMap((pool) => [pool.token0, pool.token1, ...pool.trackers])
      .map((address) => address.toLowerCase()),
  )
  const [incoming, native] = await Promise.all([
    client.getContractEvents({
      abi: erc20Abi,
      eventName: 'Transfer',
      strict: true,
      args: { to: vaultAddress },
      fromBlock,
      toBlock,
    }),
    getNativeDonationTransfers(
      client,
      vaultAddress,
      sources,
      fromBlock,
      toBlock,
      confirmedTransactions,
    ),
  ])
  const candidates = [
    ...incoming
      .filter(
        (log) =>
          (sources.includes(log.args.from.toLowerCase()) ||
            confirmedTransactions.includes(log.transactionHash.toLowerCase())) &&
          recognizedTokens.has(log.address.toLowerCase()) &&
          log.args.value > 0n,
      )
      .map((log) => ({
        blockNumber: log.blockNumber,
        token: log.address,
        amount: log.args.value,
        transactionHash: log.transactionHash,
        logIndex: log.logIndex,
      })),
    ...native,
  ]
  const receipts = new Map(
    await Promise.all(
      [...new Set(candidates.map((log) => log.transactionHash))].map(
        async (hash) => [hash, await client.getTransactionReceipt({ hash })] as const,
      ),
    ),
  )
  return candidates
    .filter((log) => {
      const receipt = receipts.get(log.transactionHash)
      if (receipt === undefined) throw new Error('Missing donation receipt')
      if (receipt.status !== 'success') return false
      // A funding transfer accompanying a deposit request is investor capital, not investment income.
      return !receipt.logs.some((event) => {
        if (event.address.toLowerCase() !== vaultAddress.toLowerCase()) return false
        try {
          return (
            decodeEventLog({ abi: HypoVaultAbi, data: event.data, topics: event.topics })
              .eventName === 'DepositRequested'
          )
        } catch {
          return false
        }
      })
    })
    .map((log) => ({
      blockNumber: log.blockNumber,
      token: log.token,
      amount: log.amount,
      transactionHash: log.transactionHash,
      logIndex: log.logIndex,
      pools: trackers,
    }))
}

export async function valueVaultDonationBlock({
  client,
  chainId,
  vaultAddress,
  underlyingToken,
  transfers,
  snapshot,
  timestampSec,
}: {
  client: PublicClient
  chainId: number
  vaultAddress: Address
  underlyingToken: Address
  transfers: Awaited<ReturnType<typeof getVaultDonationTransfers>>
  snapshot: VaultSharePriceSnapshot
  timestampSec: number
}) {
  const first = transfers[0]
  if (first === undefined) throw new Error('Missing donation transfers')
  if (
    snapshot.blockNumber !== first.blockNumber ||
    transfers.some((transfer) => transfer.blockNumber !== first.blockNumber)
  )
    throw new Error('Donation valuation requires one historical block')
  const configuration = getMainnetVaultPoolConfigurationAtBlock({
    chainId,
    vaultAddress,
    blockNumber: first.blockNumber,
  })
  if (configuration === null) throw new Error('Missing historical vault configuration')
  const [prices, configuredPools] = decodeAbiParameters(
    PanopticVaultAccountantManagerInputAbi,
    snapshot.managerInputBytes,
  )
  let donatedAssetsRaw = 0n
  for (const transfer of transfers) {
    const pool = transfer.pools.find(
      (pool) =>
        configuration.poolInfos.some(
          (active) => active.pool.toLowerCase() === pool.pool.toLowerCase(),
        ) &&
        [pool.token0, pool.token1, ...pool.trackers].some(
          (token) => token.toLowerCase() === transfer.token.toLowerCase(),
        ),
    )
    // Assets outside the accountant's active configuration do not contribute to NAV.
    if (pool === undefined) continue
    const tokenIndex = [pool.token0, pool.trackers[0]].some(
      (token) => token?.toLowerCase() === transfer.token.toLowerCase(),
    )
      ? 0
      : 1
    const underlyingIndex =
      pool.token0.toLowerCase() === underlyingToken.toLowerCase()
        ? 0
        : pool.token1.toLowerCase() === underlyingToken.toLowerCase()
          ? 1
          : null
    if (underlyingIndex === null) throw new Error('Unsupported donation denomination')
    const isTracker = pool.trackers.some(
      (token) => token.toLowerCase() === transfer.token.toLowerCase(),
    )
    const assetsRaw = isTracker
      ? await client.readContract({
          address: transfer.token,
          abi: collateralTrackerV2Abi,
          functionName: 'convertToAssets',
          args: [transfer.amount],
          blockNumber: transfer.blockNumber,
        })
      : transfer.amount
    const poolIndex = configuredPools.findIndex(
      (configured) => configured.pool.toLowerCase() === pool.pool.toLowerCase(),
    )
    const price = prices[poolIndex]
    if (price === undefined) throw new Error('Missing donation conversion price')
    const tick = tokenIndex === 0 ? price.token0Price : price.token1Price
    donatedAssetsRaw += valueDonationInUnderlying({ assetsRaw, tokenIndex, underlyingIndex, tick })
  }
  if (snapshot.shares <= 0n) return null
  return {
    timestampSec,
    blockNumber: first.blockNumber.toString(),
    donatedAssetsRaw: donatedAssetsRaw.toString(),
    // End-of-block attribution matches the historical NAV snapshot granularity.
    retainedFactor: donationRetainedFactor(
      donatedAssetsRaw,
      snapshot.nav + 1n - snapshot.assetsDeposited - snapshot.reservedWithdrawalAssets,
    ),
  }
}
