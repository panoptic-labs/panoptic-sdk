/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react'
import type { Address } from 'viem'
import { zeroAddress } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useRequestDeposit } from './hooks/use-request-deposit'

const mockUseAccount = vi.fn()
const mockUseReadContract = vi.fn()
const mockUseSimulateContract = vi.fn()
const mockUseWaitForTransactionReceipt = vi.fn()
const mockUseWriteContract = vi.fn()

vi.mock('wagmi', () => ({
  useAccount: () => mockUseAccount(),
  useReadContract: (args: unknown) => mockUseReadContract(args),
  useSimulateContract: (args: unknown) => mockUseSimulateContract(args),
  useWaitForTransactionReceipt: (args: unknown) => mockUseWaitForTransactionReceipt(args),
  useWriteContract: () => mockUseWriteContract(),
}))

describe('useRequestDeposit allowance guards', () => {
  beforeEach(() => {
    vi.resetAllMocks()

    mockUseAccount.mockReturnValue({
      address: '0x1111111111111111111111111111111111111111' as Address,
    })

    mockUseReadContract.mockReturnValue({
      isFetching: false,
      data: 1000n,
      refetch: vi.fn(),
    })

    mockUseSimulateContract.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: undefined,
    })

    mockUseWaitForTransactionReceipt.mockReturnValue({
      isSuccess: false,
      isLoading: false,
      error: undefined,
    })

    mockUseWriteContract.mockReturnValue({
      writeContract: vi.fn(),
      data: undefined,
      isPending: false,
      error: undefined,
    })
  })

  it('disables allowance reads when tokenAddress is zeroAddress', () => {
    renderHook(() =>
      useRequestDeposit({
        vaultAddress: '0x2222222222222222222222222222222222222222',
        assets: 1n,
        tokenAddress: zeroAddress,
      }),
    )

    expect(mockUseReadContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: undefined,
        args: undefined,
        query: expect.objectContaining({ enabled: false }),
      }),
    )

    const simulateCalls = mockUseSimulateContract.mock.calls as [unknown][]
    const approveSimulateArgs = simulateCalls[0]?.[0]
    expect(approveSimulateArgs).toEqual(
      expect.objectContaining({
        query: expect.objectContaining({ enabled: false }),
      }),
    )
  })

  it('keeps allowance reads enabled for valid ERC20 token addresses', () => {
    const tokenAddress = '0x3333333333333333333333333333333333333333' as Address
    const vaultAddress = '0x2222222222222222222222222222222222222222' as Address
    const account = '0x1111111111111111111111111111111111111111' as Address

    mockUseReadContract.mockReturnValue({
      isFetching: false,
      data: 0n,
      refetch: vi.fn(),
    })

    renderHook(() =>
      useRequestDeposit({
        vaultAddress,
        assets: 10n,
        tokenAddress,
      }),
    )

    expect(mockUseReadContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: tokenAddress,
        args: [account, vaultAddress],
        query: expect.objectContaining({ enabled: true }),
      }),
    )

    const simulateCalls = mockUseSimulateContract.mock.calls as [unknown][]
    const approveSimulateArgs = simulateCalls[0]?.[0]
    const requestSimulateArgs = simulateCalls[1]?.[0]

    expect(approveSimulateArgs).toEqual(
      expect.objectContaining({
        query: expect.objectContaining({ enabled: true }),
      }),
    )
    expect(requestSimulateArgs).toEqual(
      expect.objectContaining({
        query: expect.objectContaining({ enabled: false }),
      }),
    )
  })
})
