/**
 * Tests for decodeDispatchCalldata, including smart contract wallet wrappers.
 */
import { encodeFunctionData, getAddress } from 'viem'
import { describe, expect, it } from 'vitest'

import { panopticPoolV2Abi } from '../../../generated'
import { decodeDispatchCalldata } from './snapshotRecovery'

// ─── Helpers ────────────────────────────────────────────────────────────────

const POOL_ADDRESS = '0x1234567890123456789012345678901234567890' as const
const ACCOUNT = getAddress('0xabcdef1234567890abcdef1234567890abcdef12')

/** Encode a direct dispatch call */
function encodeDispatch(
  positionIdList: bigint[],
  finalPositionIdList: bigint[],
  positionSizes: bigint[],
) {
  return encodeFunctionData({
    abi: panopticPoolV2Abi,
    functionName: 'dispatch',
    args: [
      positionIdList,
      finalPositionIdList,
      positionSizes,
      positionIdList.map(() => [0, 0, 0] as [number, number, number]),
      false,
      0n,
    ],
  })
}

/** Encode a direct dispatchFrom call */
function encodeDispatchFrom(
  positionIdListFrom: bigint[],
  account: `0x${string}`,
  positionIdListTo: bigint[],
  positionIdListToFinal: bigint[],
) {
  return encodeFunctionData({
    abi: panopticPoolV2Abi,
    functionName: 'dispatchFrom',
    args: [positionIdListFrom, account, positionIdListTo, positionIdListToFinal, 0n],
  })
}

/** Wrap calldata in executeBatch((address,uint256,bytes)[]) */
function wrapInExecuteBatch(calls: { target: `0x${string}`; data: `0x${string}` }[]) {
  return encodeFunctionData({
    abi: [
      {
        type: 'function' as const,
        name: 'executeBatch' as const,
        inputs: [
          {
            type: 'tuple[]' as const,
            components: [
              { type: 'address' as const, name: 'target' as const },
              { type: 'uint256' as const, name: 'value' as const },
              { type: 'bytes' as const, name: 'data' as const },
            ],
          },
        ],
        outputs: [],
        stateMutability: 'nonpayable' as const,
      },
    ],
    functionName: 'executeBatch',
    args: [calls.map((c) => ({ target: c.target, value: 0n, data: c.data }))],
  })
}

/** Wrap calldata inside an arbitrary intermediate function (simulating a vault manager) */
function wrapInManage(innerCalls: { target: `0x${string}`; data: `0x${string}` }[]) {
  // Simulate manage(bytes[] pools, address[] targets, bytes[] datas)
  // The key thing is the dispatch calldata is nested inside a bytes parameter
  return encodeFunctionData({
    abi: [
      {
        type: 'function' as const,
        name: 'manage' as const,
        inputs: [
          {
            type: 'tuple[]' as const,
            components: [
              { type: 'bytes32[]' as const, name: 'poolIds' as const },
              { type: 'address' as const, name: 'target' as const },
              { type: 'address[]' as const, name: 'pools' as const },
              {
                type: 'bytes[]' as const,
                name: 'datas' as const,
              },
            ],
          },
        ],
        outputs: [],
        stateMutability: 'nonpayable' as const,
      },
    ],
    functionName: 'manage',
    args: [
      innerCalls.map((c) => ({
        poolIds: [
          '0x0000000000000000000000000000000000000000000000000000000000000001' as `0x${string}`,
        ],
        target: c.target,
        pools: [POOL_ADDRESS],
        datas: [c.data],
      })),
    ],
  })
}

// ─── Assertion Helper ────────────────────────────────────────────────────────

/** Assert value is non-null, narrowing the type for subsequent usage. */
function assertNonNull<T>(value: T | null | undefined): T {
  expect(value).not.toBeNull()
  return value as T
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('decodeDispatchCalldata', () => {
  describe('direct dispatch', () => {
    it('decodes a direct dispatch call', () => {
      const input = encodeDispatch([1n], [1n, 2n], [100n])
      const res = assertNonNull(decodeDispatchCalldata(input))
      expect(res.positionIds).toEqual([1n, 2n])
      expect(res.targetAccount).toBeUndefined()
    })

    it('decodes a direct dispatchFrom call', () => {
      const input = encodeDispatchFrom([1n], ACCOUNT, [2n], [2n, 3n])
      const res = assertNonNull(decodeDispatchCalldata(input))
      expect(res.positionIds).toEqual([2n, 3n])
      expect(res.targetAccount).toBe(ACCOUNT)
    })

    it('returns null for unrelated calldata', () => {
      const result = decodeDispatchCalldata('0xdeadbeef')
      expect(result).toBeNull()
    })
  })

  describe('smart contract wallet wrappers', () => {
    it('decodes dispatch inside executeBatch (Turnkey / ERC-4337)', () => {
      const dispatchData = encodeDispatch([1n], [1n, 2n], [100n])
      const batchData = wrapInExecuteBatch([{ target: POOL_ADDRESS, data: dispatchData }])
      const res = assertNonNull(decodeDispatchCalldata(batchData))
      expect(res.positionIds).toEqual([1n, 2n])
    })

    it('decodes dispatch inside executeBatch with multiple calls', () => {
      const approveData = '0x095ea7b3' + '0'.repeat(128) // fake approve call
      const dispatchData = encodeDispatch([10n], [10n, 20n, 30n], [500n])
      const batchData = wrapInExecuteBatch([
        {
          target: '0x0000000000000000000000000000000000000001',
          data: approveData as `0x${string}`,
        },
        { target: POOL_ADDRESS, data: dispatchData },
      ])
      const res = assertNonNull(decodeDispatchCalldata(batchData))
      expect(res.positionIds).toEqual([10n, 20n, 30n])
    })

    it('decodes dispatch nested inside executeBatch → manage (vault manager)', () => {
      const dispatchData = encodeDispatch([5n], [5n, 6n], [200n])
      const manageData = wrapInManage([{ target: POOL_ADDRESS, data: dispatchData }])
      const batchData = wrapInExecuteBatch([
        { target: '0x95ec124faab70d7ae147c3be0336e01a828ae2d5', data: manageData },
      ])
      const res = assertNonNull(decodeDispatchCalldata(batchData))
      expect(res.positionIds).toEqual([5n, 6n])
    })

    it('decodes dispatchFrom inside executeBatch', () => {
      const dispatchFromData = encodeDispatchFrom([1n], ACCOUNT, [2n], [2n, 3n])
      const batchData = wrapInExecuteBatch([{ target: POOL_ADDRESS, data: dispatchFromData }])
      const res = assertNonNull(decodeDispatchCalldata(batchData))
      expect(res.positionIds).toEqual([2n, 3n])
      expect(res.targetAccount).toBe(ACCOUNT)
    })

    it('returns null when executeBatch contains no dispatch', () => {
      const approveData = '0x095ea7b3' + '0'.repeat(128)
      const batchData = wrapInExecuteBatch([
        {
          target: '0x0000000000000000000000000000000000000001',
          data: approveData as `0x${string}`,
        },
      ])
      const result = decodeDispatchCalldata(batchData)
      expect(result).toBeNull()
    })

    it('decodes dispatch with empty positionIdList (close last position)', () => {
      const dispatchData = encodeDispatch([1n], [], [100n])
      const batchData = wrapInExecuteBatch([{ target: POOL_ADDRESS, data: dispatchData }])
      const res = assertNonNull(decodeDispatchCalldata(batchData))
      expect(res.positionIds).toEqual([])
    })

    it('picks the correct nested payload when two Panoptic calls are batched', () => {
      const dispatchFromData = encodeDispatchFrom([2n], ACCOUNT, [3n], [2n, 3n])
      const dispatchData = encodeDispatch([7n], [7n, 8n], [100n])
      const batchData = wrapInExecuteBatch([
        { target: POOL_ADDRESS, data: dispatchFromData },
        { target: POOL_ADDRESS, data: dispatchData },
      ])
      const res = assertNonNull(decodeDispatchCalldata(batchData))
      // The decoder returns the last (deepest) match — the dispatch call
      expect(res.positionIds).toEqual([7n, 8n])
    })
  })
})
