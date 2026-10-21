import { type Address, type PublicClient, erc20Abi, parseAbi } from 'viem'

import { normalizeTokenDecimals, normalizeUnsignedBigInt } from './normalize'

const providerAbi = parseAbi([
  'function getPoolDataProvider() view returns (address)',
  'function getPriceOracle() view returns (address)',
])
const dataAbi = parseAbi([
  'function getAllReservesTokens() view returns ((string symbol, address tokenAddress)[])',
  'function getAllATokens() view returns ((string symbol, address tokenAddress)[])',
  'function getUserReserveData(address asset, address user) view returns (uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint40,bool)',
  'function getReserveData(address asset) view returns (uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint40)',
])
const RAY = 10n ** 27n
const SECONDS_PER_YEAR = 31_536_000

/** Aave rates are per-second-compounded APRs in ray; convert to an APY in percent. */
function rayAprToApyPct(rate: bigint): number {
  const apr = Number((rate * 1_000_000n) / RAY) / 1_000_000
  return ((1 + apr / SECONDS_PER_YEAR) ** SECONDS_PER_YEAR - 1) * 100
}
const oracleAbi = parseAbi([
  'function BASE_CURRENCY_UNIT() view returns (uint256)',
  'function getAssetPrice(address asset) view returns (uint256)',
])

/** Reads accrued Aave V3 balances and oracle prices at a single block. */
export async function getAaveHoldings({
  client,
  provider,
  account,
}: {
  client: PublicClient
  provider: Address
  account: Address
}): Promise<{
  holdings: {
    address: Address
    symbol: string
    decimals: number
    supplied: bigint
    debt: bigint
    price: bigint
    priceUnit: bigint
    /** Current supply APY, percent. */
    supplyApyPct: number
    /** Current variable borrow APY, percent. */
    borrowApyPct: number
  }[]
  receiptTokens: Address[]
  blockNumber: bigint
}> {
  const blockNumber = normalizeUnsignedBigInt(await client.getBlockNumber())
  const [dataProvider, oracle] = await client.multicall({
    blockNumber,
    allowFailure: false,
    contracts: [
      { address: provider, abi: providerAbi, functionName: 'getPoolDataProvider' },
      { address: provider, abi: providerAbi, functionName: 'getPriceOracle' },
    ],
  })
  const [reserves, receipts, rawPriceUnit] = await Promise.all([
    client.readContract({
      address: dataProvider,
      abi: dataAbi,
      functionName: 'getAllReservesTokens',
      blockNumber,
    }),
    client.readContract({
      address: dataProvider,
      abi: dataAbi,
      functionName: 'getAllATokens',
      blockNumber,
    }),
    client.readContract({
      address: oracle,
      abi: oracleAbi,
      functionName: 'BASE_CURRENCY_UNIT',
      blockNumber,
    }),
  ])
  const priceUnit = normalizeUnsignedBigInt(rawPriceUnit)
  const rawBalances = await client.multicall({
    blockNumber,
    allowFailure: false,
    contracts: reserves.map((reserve) => ({
      address: dataProvider,
      abi: dataAbi,
      functionName: 'getUserReserveData' as const,
      args: [reserve.tokenAddress, account] as const,
    })),
  })
  const balances = rawBalances.map(([supplied, stableDebt, variableDebt, , , stableBorrowRate]) => [
    normalizeUnsignedBigInt(supplied),
    normalizeUnsignedBigInt(stableDebt),
    normalizeUnsignedBigInt(variableDebt),
    normalizeUnsignedBigInt(stableBorrowRate),
  ])
  const holdings = await Promise.all(
    reserves.flatMap((reserve, i) => {
      const [supplied, stableDebt, variableDebt, stableBorrowRate] = balances[i]
      const debt = stableDebt + variableDebt
      if (supplied === 0n && debt === 0n) return []
      return [
        (async () => {
          const [rawDecimals, rawPrice, reserveData] = await Promise.all([
            client.readContract({
              address: reserve.tokenAddress,
              abi: erc20Abi,
              functionName: 'decimals',
              blockNumber,
            }),
            client.readContract({
              address: oracle,
              abi: oracleAbi,
              functionName: 'getAssetPrice',
              args: [reserve.tokenAddress],
              blockNumber,
            }),
            client.readContract({
              address: dataProvider,
              abi: dataAbi,
              functionName: 'getReserveData',
              args: [reserve.tokenAddress],
              blockNumber,
            }),
          ])
          const decimals = normalizeTokenDecimals(rawDecimals)
          const price = normalizeUnsignedBigInt(rawPrice)
          return {
            address: reserve.tokenAddress,
            symbol: reserve.symbol,
            decimals,
            supplied,
            debt,
            price,
            priceUnit,
            supplyApyPct: rayAprToApyPct(normalizeUnsignedBigInt(reserveData[5])),
            // Legacy stable debt accrues at the user's own stable rate; weight
            // it against the reserve's variable rate by balance.
            borrowApyPct: (() => {
              const variableApy = rayAprToApyPct(normalizeUnsignedBigInt(reserveData[6]))
              if (stableDebt === 0n) return variableApy
              const stableApy = rayAprToApyPct(stableBorrowRate)
              const stableWeight = Number((stableDebt * 1_000_000n) / debt) / 1_000_000
              return stableApy * stableWeight + variableApy * (1 - stableWeight)
            })(),
          }
        })(),
      ]
    }),
  )
  return { holdings, receiptTokens: receipts.map((token) => token.tokenAddress), blockNumber }
}
