import { createClient, custom, encodeFunctionResult, zeroHash } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { Multicall3Abi } from '../../../abis/multicall3'
import { readBlockAndAggregate } from './multicallBlock'

describe('multicall block identity', () => {
  it.each([109825958n, undefined])(
    'preserves RPC block %s when the EVM reports its L1 origin',
    async (blockNumber) => {
      const l1Block = 26375342n
      const timestamp = 1794203354n
      const request = vi.fn().mockResolvedValue(
        encodeFunctionResult({
          abi: Multicall3Abi,
          functionName: 'blockAndAggregate',
          result: [
            l1Block,
            zeroHash,
            [
              { success: true, returnData: '0x1234' },
              {
                success: true,
                returnData: encodeFunctionResult({
                  abi: Multicall3Abi,
                  functionName: 'getCurrentBlockTimestamp',
                  result: timestamp,
                }),
              },
            ],
          ],
        }),
      )
      const client = createClient({ transport: custom({ request }) })
      const result = await readBlockAndAggregate({
        client,
        blockNumber,
        calls: [{ target: '0x0000000000000000000000000000000000000001', callData: '0x1234' }],
      })
      expect(result._meta).toMatchObject({
        blockNumber: blockNumber ?? l1Block,
        blockTimestamp: timestamp,
      })
      expect(result.results).toEqual([{ success: true, returnData: '0x1234' }])
      expect(request.mock.calls[0]?.[0].params[1]).toBe(
        blockNumber === undefined ? 'latest' : '0x68bcfa6',
      )
    },
  )
})
