import { describe, expect, it, vi } from 'vitest'

import { getPositionChunkData } from '../sync/chunkTracking'
import { encodeLeg } from '../tokenId/encoding'
import { getPositionsFillability, isPositionFillable } from './positionFillability'

vi.mock('../sync/chunkTracking', () => ({ getPositionChunkData: vi.fn() }))

const poolId = (10n << 48n) | (8n << 40n) | 123n
const leg = (index: bigint, asset = 0n, tokenType = 0n, optionRatio = 1n) =>
  encodeLeg({
    index,
    asset,
    tokenType,
    optionRatio,
    isLong: 1n,
    riskPartner: index,
    strike: 0n,
    width: 10n,
  })
const position = (tokenId = poolId | leg(0n)) => ({
  tokenId,
  positionSize: 10n ** 18n,
  maxMultiplier: '2',
})
const chunks = (net: bigint, long = 0n) => ({
  '-50-50-0': { netLiquidity: net, longLiquidity: long },
})

describe('position fillability', () => {
  it.each([0n, 1n])(
    'evaluates token%s denomination without rounding large amounts through numbers',
    (asset) => {
      expect(isPositionFillable(position(poolId | leg(0n, asset)), chunks(10n ** 23n))).toBe(true)
      expect(isPositionFillable(position(poolId | leg(0n, asset)), chunks(1n))).toBe(false)
    },
  )

  it('requires every long chunk, including mixed assets and token types', () => {
    const mixed = position(poolId | leg(0n) | leg(1n, 1n, 1n))
    expect(isPositionFillable(mixed, chunks(10n ** 23n))).toBe(false)
    expect(
      isPositionFillable(mixed, {
        ...chunks(10n ** 23n),
        '-50-50-1': { netLiquidity: 10n ** 23n, longLiquidity: 0n },
      }),
    ).toBe(true)
  })

  it('accounts for repeated chunks and leg ratios', () => {
    const single = position()
    const repeated = position(poolId | leg(0n) | leg(1n))
    const doubled = position(poolId | leg(0n, 0n, 0n, 2n))
    const available = chunks(300n * 10n ** 18n)
    expect(isPositionFillable(single, available)).toBe(true)
    expect(isPositionFillable(repeated, available)).toBe(false)
    expect(isPositionFillable(doubled, available)).toBe(false)
  })

  it('honors the spread cap and rejects missing or malformed inputs', () => {
    const available = chunks(300n * 10n ** 18n)
    expect(isPositionFillable({ ...position(), maxMultiplier: '1.01' }, available)).toBe(false)
    for (const maxMultiplier of [null, 'NaN', 'Infinity', '1', 'bad']) {
      expect(isPositionFillable({ ...position(), maxMultiplier }, available)).toBe(false)
    }
    expect(isPositionFillable({ ...position(), positionSize: 0n }, available)).toBe(false)
    expect(isPositionFillable(position(poolId), available)).toBe(false)
    expect(isPositionFillable(position(), {})).toBe(false)
  })

  it('keeps RPC failures distinct from unavailable liquidity', async () => {
    vi.mocked(getPositionChunkData).mockRejectedValueOnce(new Error('offline'))
    const client = {} as Parameters<typeof getPositionsFillability>[0]['client']
    await expect(
      getPositionsFillability({
        client,
        poolAddress: '0x0000000000000000000000000000000000000001',
        queryAddress: '0x0000000000000000000000000000000000000002',
        positions: [position()],
      }),
    ).rejects.toThrow('offline')
  })

  it('evaluates distinct sizes against the same pinned chunk snapshot', async () => {
    const small = position()
    const large = { ...small, positionSize: 10n ** 30n }
    const meta = { blockNumber: 42n, blockTimestamp: 100n, blockHash: '0xabc' as const }
    vi.mocked(getPositionChunkData).mockResolvedValueOnce({
      positions: [
        {
          tokenId: small.tokenId,
          legs: [
            { legIndex: 0, netLiquidity: 10n ** 23n, removedLiquidity: 0n, spreadWad: 10n ** 18n },
          ],
        },
      ],
      _meta: meta,
    })
    const client = {} as Parameters<typeof getPositionsFillability>[0]['client']
    const result = await getPositionsFillability({
      client,
      poolAddress: '0x0000000000000000000000000000000000000001',
      queryAddress: '0x0000000000000000000000000000000000000002',
      positions: [small, large],
      blockNumber: 42n,
    })
    expect(result.results.map((item) => item.fillable)).toEqual([true, false])
    expect(result._meta).toEqual(meta)
    expect(getPositionChunkData).toHaveBeenLastCalledWith(
      expect.objectContaining({ tokenIds: [small.tokenId], blockNumber: 42n }),
    )
  })
})
