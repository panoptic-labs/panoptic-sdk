import { type Hex, type PublicClient, ContractFunctionRevertedError } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { isSafeAccount } from './isSafeAccount'
import { safeAbi } from './signedSafeTx'

const address = '0x0000000000000000000000000000000000000001'
function setup(code: Hex | undefined = '0x6001') {
  const getCode = vi.fn(async (): Promise<Hex | undefined> => code)
  const readContract = vi.fn(
    async ({ functionName }: { functionName: string }): Promise<unknown> => {
      if (functionName === 'VERSION') return '1.5.0'
      if (functionName === 'getThreshold') return 1n
      return [address]
    },
  )
  const client = { getCode, readContract } as unknown as Pick<
    PublicClient,
    'getCode' | 'readContract'
  >
  return { client, getCode, readContract }
}

describe('isSafeAccount', () => {
  it.each([undefined, '0x'] as const)(
    'identifies accounts without code (%s) without contract reads',
    async (code) => {
      const { client, getCode, readContract } = setup()
      getCode.mockResolvedValue(code)
      await expect(isSafeAccount({ client, address })).resolves.toBe(false)
      expect(readContract).not.toHaveBeenCalled()
    },
  )

  it('detects a deployed Safe independently of its wallet connector', async () => {
    const { client } = setup()
    await expect(isSafeAccount({ client, address })).resolves.toBe(true)
  })

  it('rejects a contract without the Safe interface', async () => {
    const { client, readContract } = setup()
    readContract.mockRejectedValue(
      new ContractFunctionRevertedError({ abi: safeAbi, functionName: 'VERSION', data: '0x' }),
    )
    await expect(isSafeAccount({ client, address })).resolves.toBe(false)
  })

  it('rejects an invalid Safe threshold', async () => {
    const { client, readContract } = setup()
    readContract.mockImplementation(async ({ functionName }) => {
      if (functionName === 'VERSION') return '1.5.0'
      if (functionName === 'getThreshold') return 2n
      return [address]
    })
    await expect(isSafeAccount({ client, address })).resolves.toBe(false)
  })

  it('does not classify RPC failures as a non-Safe account', async () => {
    const { client, readContract } = setup()
    const error = new Error('RPC unavailable')
    readContract.mockRejectedValue(error)
    await expect(isSafeAccount({ client, address })).rejects.toBe(error)
  })
})
