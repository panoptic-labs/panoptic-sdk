import Decimal from 'decimal.js'
import type { Address, PublicClient } from 'viem'
import { zeroAddress } from 'viem'

import { HypoVaultAbi } from '../../abis/HypoVault'
import { collateralTrackerV2Abi, panopticPoolV2Abi } from '../../generated'
import { tickToSqrtPriceX96 } from '../../panoptic/v2/formatters/tick'
import { getHypoVaultConfigForVault } from '../hypoVaultManagerConfigs/vaultToConfig'
import { getVaultPoolInfos } from '../utils/vaultManagerInput'

const erc20Abi = [
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'symbol',
    inputs: [],
    outputs: [{ name: 'symbol', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'decimals',
    inputs: [],
    outputs: [{ name: 'decimals', type: 'uint8' }],
    stateMutability: 'view',
  },
] as const

export type VaultLendingAllocationRow = {
  market: string
  supplyRateWad: bigint | null
  borrowRateWad: bigint | null
  utilizationBps: bigint | null
  allocationSourceRaw: bigint
  sourceTokenAddress: Address
  sourceTokenSymbol: string
  sourceTokenDecimals: number
  allocationUnderlying: bigint
  allocationPctBps: bigint
  isIdle: boolean
  unfulfilledDepositAssetsRaw?: bigint
  reservedWithdrawalAssetsRaw?: bigint
  hasCollateralMetrics: boolean
  panopticPoolAddress: Address | null
  collateralTrackerAddress: Address | null
}

type RowWithoutPct = Omit<VaultLendingAllocationRow, 'allocationPctBps'>

const WAD = 1_000_000_000_000_000_000n
const SECONDS_PER_YEAR = 365n * 24n * 60n * 60n
const Q128 = 2n ** 128n

/**
 * Matches the on-chain `PanopticMath.convert0to1` / `convert1to0` truncation
 * semantics (same as `~/utils/panopticMath` in the UI app, without the
 * `@uniswap/v3-sdk` dependency).
 */
function convert0to1(amount: bigint, sqrtPriceX96: bigint): bigint {
  if (sqrtPriceX96 < Q128) {
    return (amount * sqrtPriceX96 * sqrtPriceX96) >> 192n
  }
  const sp2Hi = (sqrtPriceX96 * sqrtPriceX96) >> 64n
  return (amount * sp2Hi) >> 128n
}

function convert1to0(amount: bigint, sqrtPriceX96: bigint): bigint {
  if (sqrtPriceX96 < Q128) {
    return (amount * 2n ** 192n) / (sqrtPriceX96 * sqrtPriceX96)
  }
  const sp2Hi = (sqrtPriceX96 * sqrtPriceX96) >> 64n
  return (amount * 2n ** 128n) / sp2Hi
}

export type VaultNetLendingApyTrackerInput = {
  assets: bigint
  netBorrows: bigint
  interestRateWad: bigint
  utilizationBps: bigint
  sourceTokenAddress: Address
  token0Address: Address
  token1Address: Address
  underlyingPoolTokenAddress: Address
  twapTick: number
}

export function adjustUnderlyingIdleBalance({
  rawUnderlyingBalance,
  unfulfilledDepositAssets,
  reservedWithdrawalAssets: _reservedWithdrawalAssets,
}: {
  rawUnderlyingBalance: bigint
  unfulfilledDepositAssets: bigint
  reservedWithdrawalAssets: bigint
}): bigint {
  const nonIdleUnderlying = unfulfilledDepositAssets
  return rawUnderlyingBalance > nonIdleUnderlying ? rawUnderlyingBalance - nonIdleUnderlying : 0n
}

type PoolContext = {
  poolAddress: Address
  token0Address: Address
  token1Address: Address
  token0Symbol: string
  token1Symbol: string
  token0Decimals: number
  token1Decimals: number
  collateral0Address: Address
  collateral1Address: Address
}

type NetLendingPoolContext = Pick<
  PoolContext,
  'poolAddress' | 'token0Address' | 'token1Address' | 'collateral0Address' | 'collateral1Address'
>

function isNativeToken(tokenAddress: Address): boolean {
  return tokenAddress.toLowerCase() === zeroAddress
}

function addressesEqual(a: Address, b: Address): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

function discoverPoolAddresses({
  chainId,
  vaultAddress,
}: {
  chainId: number
  vaultAddress: Address
}): Address[] {
  const seen = new Set<string>()
  const addresses: Address[] = []

  const config = getHypoVaultConfigForVault(vaultAddress, chainId)
  const configuredPool = config?.addresses?.ethUsdc500bpsV4PanopticPool
  if (configuredPool !== undefined) {
    const key = configuredPool.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      addresses.push(configuredPool)
    }
  }

  const artifactInfos = getVaultPoolInfos(vaultAddress, chainId)

  for (const info of artifactInfos) {
    const key = info.pool.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      addresses.push(info.pool as Address)
    }
  }

  return addresses
}

function computeAllocationPctBps({
  allocationUnderlying,
  totalUnderlying,
}: {
  allocationUnderlying: bigint
  totalUnderlying: bigint
}): bigint {
  if (totalUnderlying === 0n) {
    return 0n
  }
  return (allocationUnderlying * 10_000n) / totalUnderlying
}

function toBigInt(value: unknown): bigint | null {
  if (typeof value === 'bigint') {
    return value
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return BigInt(value)
  }
  return null
}

function getAssetsDepositedFromDepositEpochState(value: unknown): bigint {
  if (Array.isArray(value) && value.length > 0) {
    return toBigInt(value[0]) ?? 0n
  }

  if (typeof value === 'object' && value !== null && 'assetsDeposited' in value) {
    const state = value as { assetsDeposited?: unknown }
    return state.assetsDeposited === undefined ? 0n : (toBigInt(state.assetsDeposited) ?? 0n)
  }

  return 0n
}

async function readTokenSymbol({
  client,
  tokenAddress,
  blockNumber,
}: {
  client: PublicClient
  tokenAddress: Address
  blockNumber?: bigint
}): Promise<string> {
  if (isNativeToken(tokenAddress)) {
    return 'ETH'
  }

  return client.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'symbol',
    ...(blockNumber === undefined ? {} : { blockNumber }),
  })
}

async function readTokenDecimals({
  client,
  tokenAddress,
  blockNumber,
}: {
  client: PublicClient
  tokenAddress: Address
  blockNumber?: bigint
}): Promise<number> {
  if (isNativeToken(tokenAddress)) {
    return 18
  }

  try {
    const decimals = await client.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'decimals',
      ...(blockNumber === undefined ? {} : { blockNumber }),
    })
    const parsed = Number(decimals)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 18
  } catch {
    return 18
  }
}

async function readTokenBalance({
  client,
  tokenAddress,
  owner,
  blockNumber,
}: {
  client: PublicClient
  tokenAddress: Address
  owner: Address
  blockNumber?: bigint
}): Promise<bigint> {
  if (isNativeToken(tokenAddress)) {
    return client.getBalance({
      address: owner,
      ...(blockNumber === undefined ? {} : { blockNumber }),
    })
  }

  return client.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [owner],
    ...(blockNumber === undefined ? {} : { blockNumber }),
  })
}

function resolveUnderlyingPoolToken({
  underlyingTokenAddress,
  token0Address,
  token1Address,
}: {
  underlyingTokenAddress: Address
  token0Address: Address
  token1Address: Address
}): Address | null {
  if (
    addressesEqual(underlyingTokenAddress, token0Address) ||
    addressesEqual(underlyingTokenAddress, token1Address)
  ) {
    return underlyingTokenAddress
  }

  // WETH vaults use WETH as underlying while Panoptic pool token0 is native ETH.
  if (isNativeToken(token0Address)) {
    return token0Address
  }

  return null
}

function convertToUnderlying({
  amount,
  sourceTokenAddress,
  token0Address,
  token1Address,
  underlyingPoolTokenAddress,
  twapTick,
}: {
  amount: bigint
  sourceTokenAddress: Address
  token0Address: Address
  token1Address: Address
  underlyingPoolTokenAddress: Address
  twapTick: number
}): bigint {
  if (amount === 0n) {
    return 0n
  }

  if (addressesEqual(sourceTokenAddress, underlyingPoolTokenAddress)) {
    return amount
  }

  const sourceIsToken0 = addressesEqual(sourceTokenAddress, token0Address)
  const sourceIsToken1 = addressesEqual(sourceTokenAddress, token1Address)
  const underlyingIsToken0 = addressesEqual(underlyingPoolTokenAddress, token0Address)
  const underlyingIsToken1 = addressesEqual(underlyingPoolTokenAddress, token1Address)

  if ((!sourceIsToken0 && !sourceIsToken1) || (!underlyingIsToken0 && !underlyingIsToken1)) {
    return 0n
  }

  const sqrtPriceX96 = tickToSqrtPriceX96(BigInt(twapTick))

  if (sourceIsToken0 && underlyingIsToken1) {
    return convert0to1(amount, sqrtPriceX96)
  }
  if (sourceIsToken1 && underlyingIsToken0) {
    return convert1to0(amount, sqrtPriceX96)
  }

  return 0n
}

function convertSignedToUnderlying({
  amount,
  sourceTokenAddress,
  token0Address,
  token1Address,
  underlyingPoolTokenAddress,
  twapTick,
}: {
  amount: bigint
  sourceTokenAddress: Address
  token0Address: Address
  token1Address: Address
  underlyingPoolTokenAddress: Address
  twapTick: number
}): bigint {
  if (amount >= 0n) {
    return convertToUnderlying({
      amount,
      sourceTokenAddress,
      token0Address,
      token1Address,
      underlyingPoolTokenAddress,
      twapTick,
    })
  }

  return -convertToUnderlying({
    amount: -amount,
    sourceTokenAddress,
    token0Address,
    token1Address,
    underlyingPoolTokenAddress,
    twapTick,
  })
}

export function calculateVaultNetLendingApyPctFromTrackerInputs(
  inputs: VaultNetLendingApyTrackerInput[],
): number | null {
  let totalAssetsUnderlying = 0n
  let totalNetYieldUnderlying = 0n

  for (const input of inputs) {
    if (input.assets === 0n) {
      continue
    }

    const supplyRateWad = (input.interestRateWad * input.utilizationBps) / 10_000n
    const annualSupplyRateWad = supplyRateWad * SECONDS_PER_YEAR
    const annualBorrowRateWad = input.interestRateWad * SECONDS_PER_YEAR
    const positiveNetBorrows = input.netBorrows > 0n ? input.netBorrows : 0n
    const grossSupplyYield = (input.assets * annualSupplyRateWad) / WAD
    const borrowCost = (positiveNetBorrows * annualBorrowRateWad) / WAD
    const netYield = grossSupplyYield - borrowCost

    const assetsUnderlying = convertToUnderlying({
      amount: input.assets,
      sourceTokenAddress: input.sourceTokenAddress,
      token0Address: input.token0Address,
      token1Address: input.token1Address,
      underlyingPoolTokenAddress: input.underlyingPoolTokenAddress,
      twapTick: input.twapTick,
    })

    if (assetsUnderlying === 0n) {
      continue
    }

    const netYieldUnderlying = convertSignedToUnderlying({
      amount: netYield,
      sourceTokenAddress: input.sourceTokenAddress,
      token0Address: input.token0Address,
      token1Address: input.token1Address,
      underlyingPoolTokenAddress: input.underlyingPoolTokenAddress,
      twapTick: input.twapTick,
    })

    totalAssetsUnderlying += assetsUnderlying
    totalNetYieldUnderlying += netYieldUnderlying
  }

  if (totalAssetsUnderlying === 0n) {
    return null
  }

  const apyPct = new Decimal(totalNetYieldUnderlying.toString())
    .div(totalAssetsUnderlying.toString())
    .mul(100)
    .toNumber()

  return Number.isFinite(apyPct) ? apyPct : null
}

export function calculateVaultNetLendingYieldUnderlyingFromTrackerInputs({
  inputs,
  intervalSeconds,
}: {
  inputs: VaultNetLendingApyTrackerInput[]
  intervalSeconds: bigint
}): bigint | null {
  if (intervalSeconds <= 0n) {
    return 0n
  }

  let sawAssets = false
  let totalNetYieldUnderlying = 0n

  for (const input of inputs) {
    if (input.assets === 0n) {
      continue
    }

    const supplyRateWad = (input.interestRateWad * input.utilizationBps) / 10_000n
    const supplyYield = (input.assets * supplyRateWad * intervalSeconds) / WAD
    const positiveNetBorrows = input.netBorrows > 0n ? input.netBorrows : 0n
    const borrowCost = (positiveNetBorrows * input.interestRateWad * intervalSeconds) / WAD
    const netYield = supplyYield - borrowCost

    const netYieldUnderlying = convertSignedToUnderlying({
      amount: netYield,
      sourceTokenAddress: input.sourceTokenAddress,
      token0Address: input.token0Address,
      token1Address: input.token1Address,
      underlyingPoolTokenAddress: input.underlyingPoolTokenAddress,
      twapTick: input.twapTick,
    })

    sawAssets = true
    totalNetYieldUnderlying += netYieldUnderlying
  }

  return sawAssets ? totalNetYieldUnderlying : null
}

export async function fetchVaultNetLendingApyPct({
  client,
  chainId,
  vaultAddress,
  underlyingTokenAddress,
  blockNumber,
}: {
  client: PublicClient
  chainId: number
  vaultAddress: Address
  underlyingTokenAddress: Address
  blockNumber?: bigint
}): Promise<number | null> {
  const poolAddresses = discoverPoolAddresses({
    chainId,
    vaultAddress,
  })
  if (poolAddresses.length === 0) {
    return null
  }

  const poolContexts = await Promise.all(
    poolAddresses.map(async (poolAddress): Promise<NetLendingPoolContext> => {
      const [collateral0Address, collateral1Address] = await Promise.all([
        client.readContract({
          address: poolAddress,
          abi: panopticPoolV2Abi,
          functionName: 'collateralToken0',
          ...(blockNumber === undefined ? {} : { blockNumber }),
        }),
        client.readContract({
          address: poolAddress,
          abi: panopticPoolV2Abi,
          functionName: 'collateralToken1',
          ...(blockNumber === undefined ? {} : { blockNumber }),
        }),
      ])

      const [token0Address, token1Address] = await Promise.all([
        client.readContract({
          address: collateral0Address,
          abi: collateralTrackerV2Abi,
          functionName: 'asset',
          ...(blockNumber === undefined ? {} : { blockNumber }),
        }),
        client.readContract({
          address: collateral1Address,
          abi: collateralTrackerV2Abi,
          functionName: 'asset',
          ...(blockNumber === undefined ? {} : { blockNumber }),
        }),
      ])

      return {
        poolAddress,
        token0Address,
        token1Address,
        collateral0Address,
        collateral1Address,
      }
    }),
  )

  const trackerInputs = await Promise.all(
    poolContexts.flatMap((context) =>
      [0, 1].map(async (tokenIndex): Promise<VaultNetLendingApyTrackerInput | null> => {
        const trackerAddress =
          tokenIndex === 0 ? context.collateral0Address : context.collateral1Address
        const trackerTokenAddress = tokenIndex === 0 ? context.token0Address : context.token1Address
        const underlyingPoolTokenAddress = resolveUnderlyingPoolToken({
          underlyingTokenAddress,
          token0Address: context.token0Address,
          token1Address: context.token1Address,
        })
        if (underlyingPoolTokenAddress === null) {
          return null
        }

        const [interestRate, poolData, trackerAssets, interestState, twapTick] = await Promise.all([
          client.readContract({
            address: trackerAddress,
            abi: collateralTrackerV2Abi,
            functionName: 'interestRate',
            ...(blockNumber === undefined ? {} : { blockNumber }),
          }),
          client.readContract({
            address: trackerAddress,
            abi: collateralTrackerV2Abi,
            functionName: 'getPoolData',
            ...(blockNumber === undefined ? {} : { blockNumber }),
          }),
          client.readContract({
            address: trackerAddress,
            abi: collateralTrackerV2Abi,
            functionName: 'assetsOf',
            args: [vaultAddress],
            ...(blockNumber === undefined ? {} : { blockNumber }),
          }),
          client.readContract({
            address: trackerAddress,
            abi: collateralTrackerV2Abi,
            functionName: 'interestState',
            args: [vaultAddress],
            ...(blockNumber === undefined ? {} : { blockNumber }),
          }),
          client.readContract({
            address: context.poolAddress,
            abi: panopticPoolV2Abi,
            functionName: 'getTWAP',
            ...(blockNumber === undefined ? {} : { blockNumber }),
          }),
        ])

        if (trackerAssets === 0n) {
          return null
        }

        return {
          assets: trackerAssets,
          netBorrows: interestState[1],
          interestRateWad: interestRate,
          utilizationBps: poolData[3],
          sourceTokenAddress: trackerTokenAddress,
          token0Address: context.token0Address,
          token1Address: context.token1Address,
          underlyingPoolTokenAddress,
          twapTick,
        }
      }),
    ),
  )

  return calculateVaultNetLendingApyPctFromTrackerInputs(
    trackerInputs.filter((input): input is VaultNetLendingApyTrackerInput => input !== null),
  )
}

export async function fetchVaultNetLendingYieldUnderlying({
  client,
  chainId,
  vaultAddress,
  underlyingTokenAddress,
  blockNumber,
  intervalSeconds,
}: {
  client: PublicClient
  chainId: number
  vaultAddress: Address
  underlyingTokenAddress: Address
  blockNumber: bigint
  intervalSeconds: bigint
}): Promise<bigint | null> {
  const poolAddresses = discoverPoolAddresses({
    chainId,
    vaultAddress,
  })
  if (poolAddresses.length === 0) {
    return null
  }

  const poolContexts = await Promise.all(
    poolAddresses.map(async (poolAddress): Promise<NetLendingPoolContext> => {
      const [collateral0Address, collateral1Address] = await Promise.all([
        client.readContract({
          address: poolAddress,
          abi: panopticPoolV2Abi,
          functionName: 'collateralToken0',
          blockNumber,
        }),
        client.readContract({
          address: poolAddress,
          abi: panopticPoolV2Abi,
          functionName: 'collateralToken1',
          blockNumber,
        }),
      ])

      const [token0Address, token1Address] = await Promise.all([
        client.readContract({
          address: collateral0Address,
          abi: collateralTrackerV2Abi,
          functionName: 'asset',
          blockNumber,
        }),
        client.readContract({
          address: collateral1Address,
          abi: collateralTrackerV2Abi,
          functionName: 'asset',
          blockNumber,
        }),
      ])

      return {
        poolAddress,
        token0Address,
        token1Address,
        collateral0Address,
        collateral1Address,
      }
    }),
  )

  const trackerInputs = await Promise.all(
    poolContexts.flatMap((context) =>
      [0, 1].map(async (tokenIndex): Promise<VaultNetLendingApyTrackerInput | null> => {
        const trackerAddress =
          tokenIndex === 0 ? context.collateral0Address : context.collateral1Address
        const trackerTokenAddress = tokenIndex === 0 ? context.token0Address : context.token1Address
        const underlyingPoolTokenAddress = resolveUnderlyingPoolToken({
          underlyingTokenAddress,
          token0Address: context.token0Address,
          token1Address: context.token1Address,
        })
        if (underlyingPoolTokenAddress === null) {
          return null
        }

        const [interestRate, poolData, trackerAssets, interestState, twapTick] = await Promise.all([
          client.readContract({
            address: trackerAddress,
            abi: collateralTrackerV2Abi,
            functionName: 'interestRate',
            blockNumber,
          }),
          client.readContract({
            address: trackerAddress,
            abi: collateralTrackerV2Abi,
            functionName: 'getPoolData',
            blockNumber,
          }),
          client.readContract({
            address: trackerAddress,
            abi: collateralTrackerV2Abi,
            functionName: 'assetsOf',
            args: [vaultAddress],
            blockNumber,
          }),
          client.readContract({
            address: trackerAddress,
            abi: collateralTrackerV2Abi,
            functionName: 'interestState',
            args: [vaultAddress],
            blockNumber,
          }),
          client.readContract({
            address: context.poolAddress,
            abi: panopticPoolV2Abi,
            functionName: 'getTWAP',
            blockNumber,
          }),
        ])

        if (trackerAssets === 0n) {
          return null
        }

        return {
          assets: trackerAssets,
          netBorrows: interestState[1],
          interestRateWad: interestRate,
          utilizationBps: poolData[3],
          sourceTokenAddress: trackerTokenAddress,
          token0Address: context.token0Address,
          token1Address: context.token1Address,
          underlyingPoolTokenAddress,
          twapTick,
        }
      }),
    ),
  )

  return calculateVaultNetLendingYieldUnderlyingFromTrackerInputs({
    inputs: trackerInputs.filter(
      (input): input is VaultNetLendingApyTrackerInput => input !== null,
    ),
    intervalSeconds,
  })
}

export async function fetchVaultLendingAllocation({
  client,
  chainId,
  vaultAddress,
  underlyingTokenAddress,
  blockNumber,
}: {
  client: PublicClient
  chainId: number
  vaultAddress: Address
  underlyingTokenAddress: Address
  blockNumber?: bigint
}): Promise<VaultLendingAllocationRow[]> {
  const [reservedWithdrawalAssetsRaw, depositEpochRaw] = await Promise.all([
    client.readContract({
      address: vaultAddress,
      abi: HypoVaultAbi,
      functionName: 'reservedWithdrawalAssets',
      ...(blockNumber === undefined ? {} : { blockNumber }),
    }),
    client.readContract({
      address: vaultAddress,
      abi: HypoVaultAbi,
      functionName: 'depositEpoch',
      ...(blockNumber === undefined ? {} : { blockNumber }),
    }),
  ])

  const reservedWithdrawalAssets = toBigInt(reservedWithdrawalAssetsRaw) ?? 0n
  const depositEpoch = toBigInt(depositEpochRaw)
  const depositEpochStateRaw =
    depositEpoch === null
      ? null
      : await client.readContract({
          address: vaultAddress,
          abi: HypoVaultAbi,
          functionName: 'depositEpochState',
          args: [depositEpoch],
          ...(blockNumber === undefined ? {} : { blockNumber }),
        })
  const unfulfilledDepositAssets =
    depositEpochStateRaw === null
      ? 0n
      : getAssetsDepositedFromDepositEpochState(depositEpochStateRaw)

  const poolAddresses = discoverPoolAddresses({
    chainId,
    vaultAddress,
  })

  const poolContexts = await Promise.all(
    poolAddresses.map(async (poolAddress): Promise<PoolContext> => {
      const [collateral0Address, collateral1Address] = await Promise.all([
        client.readContract({
          address: poolAddress,
          abi: panopticPoolV2Abi,
          functionName: 'collateralToken0',
          ...(blockNumber === undefined ? {} : { blockNumber }),
        }),
        client.readContract({
          address: poolAddress,
          abi: panopticPoolV2Abi,
          functionName: 'collateralToken1',
          ...(blockNumber === undefined ? {} : { blockNumber }),
        }),
      ])

      const [token0Address, token1Address] = await Promise.all([
        client.readContract({
          address: collateral0Address,
          abi: collateralTrackerV2Abi,
          functionName: 'asset',
          ...(blockNumber === undefined ? {} : { blockNumber }),
        }),
        client.readContract({
          address: collateral1Address,
          abi: collateralTrackerV2Abi,
          functionName: 'asset',
          ...(blockNumber === undefined ? {} : { blockNumber }),
        }),
      ])

      const [token0Symbol, token1Symbol, token0Decimals, token1Decimals] = await Promise.all([
        readTokenSymbol({
          client,
          tokenAddress: token0Address,
          blockNumber,
        }),
        readTokenSymbol({
          client,
          tokenAddress: token1Address,
          blockNumber,
        }),
        readTokenDecimals({
          client,
          tokenAddress: token0Address,
          blockNumber,
        }),
        readTokenDecimals({
          client,
          tokenAddress: token1Address,
          blockNumber,
        }),
      ])

      return {
        poolAddress,
        token0Address,
        token1Address,
        token0Symbol,
        token1Symbol,
        token0Decimals,
        token1Decimals,
        collateral0Address,
        collateral1Address,
      }
    }),
  )

  const trackerRows = await Promise.all(
    poolContexts.flatMap((context) =>
      [0, 1].map(async (tokenIndex): Promise<RowWithoutPct | null> => {
        const trackerAddress =
          tokenIndex === 0 ? context.collateral0Address : context.collateral1Address
        const trackerTokenAddress = tokenIndex === 0 ? context.token0Address : context.token1Address
        const trackerTokenSymbol = tokenIndex === 0 ? context.token0Symbol : context.token1Symbol
        const trackerTokenDecimals =
          tokenIndex === 0 ? context.token0Decimals : context.token1Decimals

        const [interestRate, poolData, trackerAssets, twapTick] = await Promise.all([
          client.readContract({
            address: trackerAddress,
            abi: collateralTrackerV2Abi,
            functionName: 'interestRate',
            ...(blockNumber === undefined ? {} : { blockNumber }),
          }),
          client.readContract({
            address: trackerAddress,
            abi: collateralTrackerV2Abi,
            functionName: 'getPoolData',
            ...(blockNumber === undefined ? {} : { blockNumber }),
          }),
          client.readContract({
            address: trackerAddress,
            abi: collateralTrackerV2Abi,
            functionName: 'assetsOf',
            args: [vaultAddress],
            ...(blockNumber === undefined ? {} : { blockNumber }),
          }),
          client.readContract({
            address: context.poolAddress,
            abi: panopticPoolV2Abi,
            functionName: 'getTWAP',
            ...(blockNumber === undefined ? {} : { blockNumber }),
          }),
        ])

        if (trackerAssets === 0n) {
          return null
        }

        const underlyingPoolTokenAddress = resolveUnderlyingPoolToken({
          underlyingTokenAddress,
          token0Address: context.token0Address,
          token1Address: context.token1Address,
        })

        if (underlyingPoolTokenAddress === null) {
          return null
        }

        const allocationUnderlying = convertToUnderlying({
          amount: trackerAssets,
          sourceTokenAddress: trackerTokenAddress,
          token0Address: context.token0Address,
          token1Address: context.token1Address,
          underlyingPoolTokenAddress,
          twapTick,
        })

        const utilizationBps = poolData[3]
        const supplyRateWad = (interestRate * utilizationBps) / 10_000n

        return {
          market: `${context.token0Symbol}/${context.token1Symbol} (${trackerTokenSymbol})`,
          supplyRateWad,
          borrowRateWad: interestRate,
          utilizationBps,
          allocationSourceRaw: trackerAssets,
          sourceTokenAddress: trackerTokenAddress,
          sourceTokenSymbol: trackerTokenSymbol,
          sourceTokenDecimals: trackerTokenDecimals,
          allocationUnderlying,
          isIdle: false,
          hasCollateralMetrics: true,
          panopticPoolAddress: context.poolAddress,
          collateralTrackerAddress: trackerAddress,
        }
      }),
    ),
  )

  const tokenContexts = new Map<string, { address: Address; symbol: string; decimals: number }>()
  const underlyingSymbol = await readTokenSymbol({
    client,
    tokenAddress: underlyingTokenAddress,
    blockNumber,
  })
  const underlyingDecimals = await readTokenDecimals({
    client,
    tokenAddress: underlyingTokenAddress,
    blockNumber,
  })
  tokenContexts.set(underlyingTokenAddress.toLowerCase(), {
    address: underlyingTokenAddress,
    symbol: underlyingSymbol,
    decimals: underlyingDecimals,
  })
  for (const context of poolContexts) {
    tokenContexts.set(context.token0Address.toLowerCase(), {
      address: context.token0Address,
      symbol: context.token0Symbol,
      decimals: context.token0Decimals,
    })
    tokenContexts.set(context.token1Address.toLowerCase(), {
      address: context.token1Address,
      symbol: context.token1Symbol,
      decimals: context.token1Decimals,
    })
  }

  const idleRows = await Promise.all(
    Array.from(tokenContexts.values()).map(
      async ({ address, symbol, decimals }): Promise<RowWithoutPct | null> => {
        const balance = await readTokenBalance({
          client,
          tokenAddress: address,
          owner: vaultAddress,
          blockNumber,
        })

        const adjustedBalance = addressesEqual(address, underlyingTokenAddress)
          ? adjustUnderlyingIdleBalance({
              rawUnderlyingBalance: balance,
              unfulfilledDepositAssets,
              reservedWithdrawalAssets,
            })
          : balance

        if (adjustedBalance === 0n) {
          return null
        }

        const convertibleContext = poolContexts.find((context) => {
          const underlyingPoolTokenAddress = resolveUnderlyingPoolToken({
            underlyingTokenAddress,
            token0Address: context.token0Address,
            token1Address: context.token1Address,
          })
          if (underlyingPoolTokenAddress === null) {
            return false
          }

          return (
            addressesEqual(address, context.token0Address) ||
            addressesEqual(address, context.token1Address) ||
            addressesEqual(address, underlyingPoolTokenAddress)
          )
        })

        if (convertibleContext === undefined) {
          const isUnderlyingIdle = addressesEqual(address, underlyingTokenAddress)
          return {
            market: `Idle ${symbol}`,
            supplyRateWad: null,
            borrowRateWad: null,
            utilizationBps: null,
            allocationSourceRaw: adjustedBalance,
            sourceTokenAddress: address,
            sourceTokenSymbol: symbol,
            sourceTokenDecimals: decimals,
            allocationUnderlying: 0n,
            isIdle: true,
            unfulfilledDepositAssetsRaw: isUnderlyingIdle ? unfulfilledDepositAssets : undefined,
            reservedWithdrawalAssetsRaw: isUnderlyingIdle ? reservedWithdrawalAssets : undefined,
            hasCollateralMetrics: false,
            panopticPoolAddress: null,
            collateralTrackerAddress: null,
          }
        }

        const twapTick = await client.readContract({
          address: convertibleContext.poolAddress,
          abi: panopticPoolV2Abi,
          functionName: 'getTWAP',
          ...(blockNumber === undefined ? {} : { blockNumber }),
        })

        const underlyingPoolTokenAddress = resolveUnderlyingPoolToken({
          underlyingTokenAddress,
          token0Address: convertibleContext.token0Address,
          token1Address: convertibleContext.token1Address,
        })
        if (underlyingPoolTokenAddress === null) {
          return null
        }

        const allocationUnderlying = convertToUnderlying({
          amount: adjustedBalance,
          sourceTokenAddress: address,
          token0Address: convertibleContext.token0Address,
          token1Address: convertibleContext.token1Address,
          underlyingPoolTokenAddress,
          twapTick,
        })

        const isUnderlyingIdle = addressesEqual(address, underlyingTokenAddress)
        return {
          market: `Idle ${symbol}`,
          supplyRateWad: null,
          borrowRateWad: null,
          utilizationBps: null,
          allocationSourceRaw: adjustedBalance,
          sourceTokenAddress: address,
          sourceTokenSymbol: symbol,
          sourceTokenDecimals: decimals,
          allocationUnderlying,
          isIdle: true,
          unfulfilledDepositAssetsRaw: isUnderlyingIdle ? unfulfilledDepositAssets : undefined,
          reservedWithdrawalAssetsRaw: isUnderlyingIdle ? reservedWithdrawalAssets : undefined,
          hasCollateralMetrics: false,
          panopticPoolAddress: null,
          collateralTrackerAddress: null,
        }
      },
    ),
  )

  const rowsWithoutPct: RowWithoutPct[] = [
    ...trackerRows.filter((row): row is RowWithoutPct => row !== null),
    ...idleRows.filter((row): row is RowWithoutPct => row !== null),
  ]

  const totalUnderlying = rowsWithoutPct.reduce((sum, row) => sum + row.allocationUnderlying, 0n)
  return rowsWithoutPct.map((row) => ({
    ...row,
    allocationPctBps: computeAllocationPctBps({
      allocationUnderlying: row.allocationUnderlying,
      totalUnderlying,
    }),
  }))
}
