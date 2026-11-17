/**
 * Unit tests for the SFPM mint/burn simulations' caller selection.
 * @module v2/simulations/sfpm.test
 */
import type { PublicClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { encodeV3PoolKeyBytes, simulateSFPMBurn, simulateSFPMMint } from './sfpm'

const SFPM = '0x1111111111111111111111111111111111111111' as const
const PANOPTIC_POOL = '0x2222222222222222222222222222222222222222' as const
const ACCOUNT = '0x3333333333333333333333333333333333333333' as const
const RESULT = [[0n, 0n, 0n, 0n], 0n, 0] as const

const call = {
  sfpmAddress: SFPM,
  poolKey: encodeV3PoolKeyBytes('0x4444444444444444444444444444444444444444'),
  tokenId: 1n,
  positionSize: 100n,
  tickLimitLow: -10,
  tickLimitHigh: 10,
}

function createClient() {
  const simulateContract = vi.fn().mockResolvedValue({ result: RESULT })
  return { client: { simulateContract } as unknown as PublicClient, simulateContract }
}

describe.each([
  ['simulateSFPMMint', simulateSFPMMint, 'mintTokenizedPosition'],
  ['simulateSFPMBurn', simulateSFPMBurn, 'burnTokenizedPosition'],
] as const)('%s', (_name, simulate, functionName) => {
  it('calls as the PanopticPool when only poolAddress is given', async () => {
    const { client, simulateContract } = createClient()
    await expect(simulate({ client, poolAddress: PANOPTIC_POOL, ...call })).resolves.toBe(RESULT)
    expect(simulateContract).toHaveBeenCalledWith(
      expect.objectContaining({ account: PANOPTIC_POOL, functionName }),
    )
  })

  it('calls as an explicit account, with or without poolAddress', async () => {
    const { client, simulateContract } = createClient()
    await simulate({ client, account: ACCOUNT, ...call })
    await simulate({ client, account: ACCOUNT, poolAddress: PANOPTIC_POOL, ...call })
    expect(simulateContract).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ account: ACCOUNT }),
    )
    expect(simulateContract).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ account: ACCOUNT }),
    )
  })
})
