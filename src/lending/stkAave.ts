import { type Address, type PublicClient, erc20Abi, parseAbi } from 'viem'

import { normalizeUnsignedBigInt } from './normalize'

const stkAave = '0x4da27a545c0c5B758a6BA100e3a049001de870f5'
const aave = '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9'
const provider = '0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e'
const stakingAbi = parseAbi([
  'function previewRedeem(uint256 shares) view returns (uint256)',
  'function getTotalRewardsBalance(address account) view returns (uint256)',
])
const providerAbi = parseAbi(['function getPriceOracle() view returns (address)'])
const oracleAbi = parseAbi([
  'function BASE_CURRENCY_UNIT() view returns (uint256)',
  'function getAssetPrice(address asset) view returns (uint256)',
])

/** Reads Ethereum stkAAVE principal and claimable AAVE rewards at a single block. */
export async function getStkAaveHoldings({
  client,
  account,
}: {
  client: PublicClient
  account: Address
}) {
  const blockNumber = normalizeUnsignedBigInt(await client.getBlockNumber())
  const [rawShares, rawRewards] = await client.multicall({
    blockNumber,
    allowFailure: false,
    contracts: [
      { address: stkAave, abi: erc20Abi, functionName: 'balanceOf', args: [account] },
      {
        address: stkAave,
        abi: stakingAbi,
        functionName: 'getTotalRewardsBalance',
        args: [account],
      },
    ],
  })
  const shares = normalizeUnsignedBigInt(rawShares)
  const rewards = normalizeUnsignedBigInt(rawRewards)
  const token = { address: aave, symbol: 'AAVE', decimals: 18 } as const
  const receiptTokens: Address[] = [stkAave]
  if (shares === 0n && rewards === 0n) {
    return {
      ...token,
      shares,
      staked: 0n,
      rewards,
      price: 0n,
      priceUnit: 0n,
      receiptTokens,
      blockNumber,
    }
  }
  const [rawStaked, oracle] = await client.multicall({
    blockNumber,
    allowFailure: false,
    contracts: [
      { address: stkAave, abi: stakingAbi, functionName: 'previewRedeem', args: [shares] },
      { address: provider, abi: providerAbi, functionName: 'getPriceOracle' },
    ],
  })
  const [rawPrice, rawPriceUnit] = await client.multicall({
    blockNumber,
    allowFailure: false,
    contracts: [
      { address: oracle, abi: oracleAbi, functionName: 'getAssetPrice', args: [aave] },
      { address: oracle, abi: oracleAbi, functionName: 'BASE_CURRENCY_UNIT' },
    ],
  })
  return {
    ...token,
    shares,
    staked: normalizeUnsignedBigInt(rawStaked),
    rewards,
    price: normalizeUnsignedBigInt(rawPrice),
    priceUnit: normalizeUnsignedBigInt(rawPriceUnit),
    receiptTokens,
    blockNumber,
  }
}
