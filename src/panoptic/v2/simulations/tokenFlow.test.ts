import { type PublicClient, encodeAbiParameters } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { simulateWithTokenFlow } from './tokenFlow'

const pool = '0x0000000000000000000000000000000000000001'
const user = '0x0000000000000000000000000000000000000002'
const assets = encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [1n, 2n])
const tick = encodeAbiParameters([{ type: 'int24' }], [0])

const clientWith = (multicall: ReturnType<typeof vi.fn>) =>
  ({
    multicall,
    simulateContract: vi.fn().mockResolvedValue({ result: [assets, tick, '0x', tick, assets] }),
  }) as unknown as PublicClient

const simulate = (client: PublicClient) =>
  simulateWithTokenFlow({ client, poolAddress: pool, user, callData: '0x', estimateGas: false })

const trackersThenInterest = (tracker: string, interest: bigint) =>
  vi
    .fn()
    .mockResolvedValueOnce([tracker, tracker])
    .mockResolvedValue([interest, interest + 1n])

describe('simulateWithTokenFlow owed interest', () => {
  it('reports owed interest and reuses trackers for the same client', async () => {
    const multicall = trackersThenInterest(pool, 5n)
    const client = clientWith(multicall)
    expect((await simulate(client)).tokenFlow).toMatchObject({
      interestOwed0: 5n,
      interestOwed1: 6n,
    })
    await simulate(client)
    expect(multicall).toHaveBeenCalledTimes(3)
  })

  it('does not share cached trackers between clients', async () => {
    const other = trackersThenInterest(user, 7n)
    await simulate(clientWith(trackersThenInterest(pool, 5n)))
    await simulate(clientWith(other))
    expect(other).toHaveBeenCalledTimes(2)
    expect(other.mock.calls[1]?.[0].contracts[0].address).toBe(user)
  })

  it('leaves interest unset when the read fails but keeps the flow', async () => {
    const result = await simulate(clientWith(vi.fn().mockRejectedValue(new Error('rpc'))))
    expect(result.success).toBe(true)
    expect(result.tokenFlow?.interestOwed0).toBeUndefined()
    expect(result.tokenFlow?.interestOwed1).toBeUndefined()
  })
})
