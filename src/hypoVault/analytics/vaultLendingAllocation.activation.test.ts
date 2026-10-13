import { type Address, type PublicClient, getAddress } from 'viem'
import type * as ViemActions from 'viem/actions'
import { describe, expect, it, vi } from 'vitest'

import { MAINNET_CHAIN_ID, requireChainDeployment, ROBINHOOD_CHAIN_ID } from '../chainDeployments'
import { getMainnetV3AuthorizationGenerations } from '../mainnetV3Authorization'
import { getRobinhoodSpyUsdgAuthorizationGenerations } from '../robinhoodSpyUsdgAuthorization'
import {
  fetchVaultLendingAllocation,
  fetchVaultNetLendingApyPct,
  fetchVaultNetLendingYieldUnderlying,
} from './vaultLendingAllocation'

vi.mock('viem/actions', async (importOriginal) => ({
  ...(await importOriginal<typeof ViemActions>()),
  readContract: (client: PublicClient, args: Parameters<PublicClient['readContract']>[0]) =>
    client.readContract(args),
}))

const cases = [MAINNET_CHAIN_ID, ROBINHOOD_CHAIN_ID].flatMap((chainId) => {
  const deployment = requireChainDeployment(chainId)
  const vaults =
    chainId === ROBINHOOD_CHAIN_ID
      ? [deployment.hypovault.vaults.usdgPlpVault]
      : [deployment.hypovault.vaults.wethPlpVault, deployment.hypovault.vaults.usdcPlpVault]
  return vaults.flatMap((vaultAddress) => {
    if (vaultAddress === undefined) throw new Error('Missing vault deployment')
    const mainnet = getMainnetV3AuthorizationGenerations({ chainId, vaultAddress })
    const generations =
      chainId === ROBINHOOD_CHAIN_ID
        ? getRobinhoodSpyUsdgAuthorizationGenerations()
        : Object.values(mainnet ?? {})
    return generations.map((generation, index) => ({
      chainId,
      vaultAddress,
      generation,
      index,
    }))
  })
})

describe('lending analytics across pool activations', () => {
  it.each(cases.flatMap((entry) => [0, 1].map((tokenIndex) => ({ ...entry, tokenIndex }))))(
    'reads authorized generation $index on chain $chainId for $vaultAddress',
    async ({ chainId, vaultAddress, generation, tokenIndex }) => {
      const blockNumber = 100_000_000n
      const collateral0 = getAddress('0x000000000000000000000000000000000000c001')
      const collateral1 = getAddress('0x000000000000000000000000000000000000c002')
      const poolInfo = generation.poolInfos[0]
      if (poolInfo === undefined) throw new Error('Missing pool info')
      const underlyingTokenAddress = tokenIndex === 0 ? poolInfo.token0 : poolInfo.token1
      const fundedCollateral = tokenIndex === 0 ? collateral0 : collateral1
      const readContract = vi.fn(
        async ({
          functionName,
          address,
          blockNumber: readBlock,
        }: {
          functionName: string
          address: Address
          blockNumber?: bigint
        }) => {
          expect(readBlock).toBe(blockNumber)
          if (functionName === 'vaultHashes') return generation.poolHash
          if (functionName === 'manageRoot') return generation.manageRoot
          if (functionName === 'reservedWithdrawalAssets' || functionName === 'depositEpoch')
            return 0n
          if (functionName === 'depositEpochState') return [0n]
          if (functionName === 'collateralToken0' || functionName === 'collateralToken1') {
            expect(generation.poolInfos.map(({ pool }) => pool.toLowerCase())).toContain(
              address.toLowerCase(),
            )
            return functionName === 'collateralToken0' ? collateral0 : collateral1
          }
          if (functionName === 'asset')
            return address === collateral0 ? poolInfo.token0 : poolInfo.token1
          if (functionName === 'symbol') return address === underlyingTokenAddress ? 'USDG' : 'SPY'
          if (functionName === 'decimals') return 6
          if (functionName === 'interestRate') return 1_000_000_000n
          if (functionName === 'getPoolData') return [0n, 0n, 0n, 5_000n]
          if (functionName === 'assetsOf') return address === fundedCollateral ? 3_300_000_000n : 0n
          if (functionName === 'interestState') return [0n, 0n]
          if (functionName === 'getTWAP') return 0
          if (functionName === 'balanceOf') return 0n
          throw new Error(`Unexpected read: ${functionName}`)
        },
      )
      const getBlockNumber = vi.fn(async () => blockNumber)
      const client = {
        readContract,
        getBlockNumber,
        getBalance: vi.fn(async () => 0n),
      } as unknown as PublicClient
      const args = { client, chainId, vaultAddress, underlyingTokenAddress }
      const rows = await fetchVaultLendingAllocation(args)
      expect(rows).toHaveLength(generation.poolInfos.length)
      expect(rows.every((row) => !row.isIdle && row.allocationSourceRaw === 3_300_000_000n)).toBe(
        true,
      )
      expect(rows.reduce((sum, row) => sum + row.allocationPctBps, 0n)).toBeGreaterThanOrEqual(
        9_999n,
      )
      expect(await fetchVaultNetLendingApyPct(args)).toBeGreaterThan(0)
      expect(
        await fetchVaultNetLendingYieldUnderlying({
          ...args,
          blockNumber,
          intervalSeconds: 1_000n,
        }),
      ).toBeGreaterThan(0n)
      expect(getBlockNumber).toHaveBeenCalledTimes(2)
    },
  )
})
