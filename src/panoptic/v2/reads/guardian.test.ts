import type { PublicClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { getGuardianLockAuthority } from './guardian'

const POOL = '0x2222222222222222222222222222222222222222'
const RISK_ENGINE = '0x4444444444444444444444444444444444444444'
const GUARDIAN = '0x3333333333333333333333333333333333333333'
const KEEPER = '0x1111111111111111111111111111111111111111'

function client(isBuilderAdmin: boolean, revoked: boolean) {
  return {
    readContract: vi.fn(async ({ functionName }: { functionName: string }) =>
      functionName === 'riskEngine' ? RISK_ENGINE : GUARDIAN,
    ),
    multicall: vi.fn(async () => [isBuilderAdmin, revoked]),
  }
}

describe('getGuardianLockAuthority', () => {
  it('resolves the guardian through the RiskEngine and checks the builder admin', async () => {
    const mock = client(true, false)
    await expect(
      getGuardianLockAuthority({
        client: mock as unknown as PublicClient,
        poolAddress: POOL,
        account: KEEPER,
        builderCode: 42n,
      }),
    ).resolves.toEqual({
      guardianAddress: GUARDIAN,
      isBuilderAdmin: true,
      revoked: false,
      canLock: true,
    })
    expect(mock.multicall).toHaveBeenCalledWith(
      expect.objectContaining({
        contracts: [
          expect.objectContaining({ address: GUARDIAN, args: [KEEPER, POOL, 42n] }),
          expect.objectContaining({ address: GUARDIAN, args: [KEEPER] }),
        ],
      }),
    )
  })

  it('cannot lock when revoked or not the builder admin', async () => {
    for (const [isAdmin, revoked] of [
      [true, true],
      [false, false],
    ] as const) {
      const authority = await getGuardianLockAuthority({
        client: client(isAdmin, revoked) as unknown as PublicClient,
        poolAddress: POOL,
        account: KEEPER,
        builderCode: 42n,
      })
      expect(authority.canLock).toBe(false)
    }
  })
})
