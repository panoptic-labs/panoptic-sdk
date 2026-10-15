import { type Address, type Hash, encodeFunctionData } from 'viem'
import { describe, expect, it } from 'vitest'

import { panopticPoolV2Abi } from '../../../generated'
import { updatePositionSnapshot } from './positionSnapshot'

const poolAddress: Address = '0x0000000000000000000000000000000000000001'
const account: Address = '0x0000000000000000000000000000000000000002'
const manager: Address = '0x0000000000000000000000000000000000000003'
const hash = `0x${'11'.repeat(32)}` as Hash
const transaction = { hash, input: '0x' as const, from: manager, to: manager }
const base = { poolAddress, account, transaction }

describe('updatePositionSnapshot', () => {
  it('tracks manager-mediated mints, full burns and reopening in event order', () => {
    const minted = updatePositionSnapshot({ ...base, change: { type: 'mint', tokenId: 7n } })
    const second = updatePositionSnapshot({
      ...base,
      previous: minted,
      change: { type: 'mint', tokenId: 8n },
    })
    const burnt = updatePositionSnapshot({
      ...base,
      previous: second,
      change: { type: 'burn', tokenId: 7n },
    })
    expect(burnt.positionIds).toEqual([8n])
    expect(
      updatePositionSnapshot({ ...base, previous: burnt, change: { type: 'mint', tokenId: 7n } })
        .positionIds,
    ).toEqual([7n, 8n])
    expect(minted.positionIds).toEqual([7n])
  })

  it('uses the dispatch final list and ignores intermediate events from that transaction', () => {
    const input = encodeFunctionData({
      abi: panopticPoolV2Abi,
      functionName: 'dispatch',
      args: [[], [9n], [], [], false, 0n],
    })
    const direct = {
      ...base,
      transaction: { ...transaction, from: account, to: poolAddress, input },
    }
    const first = updatePositionSnapshot({ ...direct, change: { type: 'mint', tokenId: 7n } })
    expect(first.positionIds).toEqual([9n])
    expect(first.fromDispatch).toBe(true)
    expect(
      updatePositionSnapshot({ ...direct, previous: first, change: { type: 'burn', tokenId: 9n } })
        .positionIds,
    ).toEqual([9n])
    expect(
      updatePositionSnapshot({
        ...base,
        transaction: { ...transaction, hash: `0x${'22'.repeat(32)}` },
        previous: first,
        change: { type: 'burn', tokenId: 9n },
      }).positionIds,
    ).toEqual([])
  })

  it('does not attribute a different pool or caller dispatch list to this account', () => {
    const input = encodeFunctionData({
      abi: panopticPoolV2Abi,
      functionName: 'dispatch',
      args: [[], [9n], [], [], false, 0n],
    })
    for (const tx of [
      { ...transaction, input, from: account },
      { ...transaction, input, to: poolAddress },
    ]) {
      expect(
        updatePositionSnapshot({ ...base, transaction: tx, change: { type: 'mint', tokenId: 7n } })
          .positionIds,
      ).toEqual([7n])
    }
  })
})

it('uses the targeted dispatchFrom final list, including liquidation to an empty list', () => {
  for (const final of [[8n], []]) {
    const input = encodeFunctionData({
      abi: panopticPoolV2Abi,
      functionName: 'dispatchFrom',
      args: [[], account, [7n, 8n], final, 0n],
    })
    expect(
      updatePositionSnapshot({
        ...base,
        transaction: { ...transaction, to: poolAddress, input },
        change: { type: 'burn', tokenId: 7n },
      }),
    ).toMatchObject({ positionIds: final, fromDispatch: true })
  }
})

it('uses the last matching dispatch in a pool multicall', () => {
  const calls = [[7n], [8n]].map((ids) =>
    encodeFunctionData({
      abi: panopticPoolV2Abi,
      functionName: 'dispatch',
      args: [[], ids, [], [], false, 0n],
    }),
  )
  const input = encodeFunctionData({
    abi: [
      {
        type: 'function',
        name: 'multicall',
        stateMutability: 'payable',
        inputs: [{ name: 'data', type: 'bytes[]' }],
        outputs: [{ name: 'results', type: 'bytes[]' }],
      },
    ],
    functionName: 'multicall',
    args: [calls],
  })
  expect(
    updatePositionSnapshot({
      ...base,
      transaction: { ...transaction, from: account, to: poolAddress, input },
      change: { type: 'mint', tokenId: 7n },
    }).positionIds,
  ).toEqual([8n])
})

it('reads non-enumerable transaction fields exposed by an indexing proxy', () => {
  for (const direct of [false, true]) {
    const data = {
      ...transaction,
      ...(direct
        ? {
            from: account,
            to: poolAddress,
            input: encodeFunctionData({
              abi: panopticPoolV2Abi,
              functionName: 'dispatch',
              args: [[], [9n], [], [], false, 0n],
            }),
          }
        : {}),
    }
    const proxy = new Proxy(data, {
      getOwnPropertyDescriptor: () => undefined,
    })
    expect({ ...proxy }).toEqual({})
    expect(
      updatePositionSnapshot({
        ...base,
        transaction: proxy,
        change: { type: 'mint', tokenId: 7n },
      }),
    ).toEqual({
      positionIds: direct ? [9n] : [7n],
      transactionHash: hash,
      fromDispatch: direct,
    })
  }
})
