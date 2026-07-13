import { type Address, type PublicClient, getAddress, zeroAddress } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { SepoliaWETHPLPVaultPoolInfos } from '../hypoVaultManagerArtifacts/SepoliaWETHPLPVaultPoolInfos'
import {
  adjustUnderlyingIdleBalance,
  calculateVaultNetLendingYieldUnderlyingFromTrackerInputs,
  fetchVaultLendingAllocation,
} from './vaultLendingAllocation'

describe('fetchVaultLendingAllocation', () => {
  const token1Address = getAddress('0x0000000000000000000000000000000000000abc')

  it('estimates positive interval lending yield', () => {
    const yieldUnderlying = calculateVaultNetLendingYieldUnderlyingFromTrackerInputs({
      intervalSeconds: 1n,
      inputs: [
        {
          assets: 1_000n,
          netBorrows: 0n,
          interestRateWad: 1_000_000_000_000_000_000n,
          utilizationBps: 5_000n,
          sourceTokenAddress: zeroAddress,
          token0Address: zeroAddress,
          token1Address,
          underlyingPoolTokenAddress: zeroAddress,
          twapTick: 0,
        },
      ],
    })

    expect(yieldUnderlying).toBe(500n)
  })

  it('allows negative interval lending yield when borrow cost exceeds supply yield', () => {
    const yieldUnderlying = calculateVaultNetLendingYieldUnderlyingFromTrackerInputs({
      intervalSeconds: 1n,
      inputs: [
        {
          assets: 1_000n,
          netBorrows: 2_000n,
          interestRateWad: 1_000_000_000_000_000_000n,
          utilizationBps: 5_000n,
          sourceTokenAddress: zeroAddress,
          token0Address: zeroAddress,
          token1Address,
          underlyingPoolTokenAddress: zeroAddress,
          twapTick: 0,
        },
      ],
    })

    expect(yieldUnderlying).toBe(-1_500n)
  })

  it('returns null when there are no tracker assets for lending yield', () => {
    const yieldUnderlying = calculateVaultNetLendingYieldUnderlyingFromTrackerInputs({
      intervalSeconds: 1n,
      inputs: [
        {
          assets: 0n,
          netBorrows: 0n,
          interestRateWad: 1_000_000_000_000_000_000n,
          utilizationBps: 5_000n,
          sourceTokenAddress: zeroAddress,
          token0Address: zeroAddress,
          token1Address,
          underlyingPoolTokenAddress: zeroAddress,
          twapTick: 0,
        },
      ],
    })

    expect(yieldUnderlying).toBeNull()
  })

  it('keeps full wallet balance when there are no pending deposits', () => {
    const adjusted = adjustUnderlyingIdleBalance({
      rawUnderlyingBalance: 10_000_000n,
      unfulfilledDepositAssets: 0n,
      reservedWithdrawalAssets: 12_000_000n,
    })

    expect(adjusted).toBe(10_000_000n)
  })

  it('subtracts pending deposits from underlying idle and ignores reserved withdrawals', () => {
    const adjusted = adjustUnderlyingIdleBalance({
      rawUnderlyingBalance: 10_000_000n,
      unfulfilledDepositAssets: 2_000_000n,
      reservedWithdrawalAssets: 12_000_000n,
    })

    expect(adjusted).toBe(8_000_000n)
  })

  it('clamps underlying idle at zero when pending deposits exceed wallet balance', () => {
    const adjusted = adjustUnderlyingIdleBalance({
      rawUnderlyingBalance: 10_000_000n,
      unfulfilledDepositAssets: 12_000_000n,
      reservedWithdrawalAssets: 1_000_000n,
    })

    expect(adjusted).toBe(0n)
  })

  it('includes source-token amount and decimals for tracker rows', async () => {
    const collateral0Address = getAddress('0x000000000000000000000000000000000000c001')
    const collateral1Address = getAddress('0x000000000000000000000000000000000000c002')
    const token1Address = getAddress('0x0000000000000000000000000000000000000abc')
    const vaultAddress = getAddress(SepoliaWETHPLPVaultPoolInfos.vaultAddress)

    const readContract = vi.fn(
      async ({ functionName, address }: { functionName: string; address: Address }) => {
        if (functionName === 'reservedWithdrawalAssets') return 0n
        if (functionName === 'depositEpoch') return 1n
        if (functionName === 'depositEpochState') return [0n]
        if (functionName === 'collateralToken0') return collateral0Address
        if (functionName === 'collateralToken1') return collateral1Address
        if (functionName === 'asset') {
          if (address.toLowerCase() === collateral0Address.toLowerCase()) return zeroAddress
          return token1Address
        }
        if (functionName === 'symbol') return 'USDC'
        if (functionName === 'decimals') return 6
        if (functionName === 'interestRate') return 1n
        if (functionName === 'getPoolData') return [0n, 0n, 0n, 5_000n]
        if (functionName === 'assetsOf') {
          if (address.toLowerCase() === collateral0Address.toLowerCase())
            return 1_000_000_000_000_000n
          if (address.toLowerCase() === collateral1Address.toLowerCase()) return 5_000_000n
          return 0n
        }
        if (functionName === 'getTWAP') return 0
        if (functionName === 'balanceOf') return 0n
        throw new Error(`unexpected function ${functionName} at ${address}`)
      },
    )

    const client = {
      readContract,
      getBalance: vi.fn(async () => 0n),
    } as unknown as PublicClient

    const rows = await fetchVaultLendingAllocation({
      client,
      chainId: 11155111,
      vaultAddress,
      underlyingTokenAddress: zeroAddress,
    })

    const trackerRows = rows.filter((row) => !row.isIdle)
    expect(trackerRows.length).toBeGreaterThan(0)

    const ethTrackerRow = trackerRows.find((row) => row.sourceTokenSymbol === 'ETH')
    expect(ethTrackerRow).toBeDefined()
    expect(ethTrackerRow?.sourceTokenDecimals).toBe(18)
    expect((ethTrackerRow?.allocationSourceRaw ?? 0n) > 0n).toBe(true)
  })
})
