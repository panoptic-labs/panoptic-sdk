import type { Address, Hex } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { fetchHypoVaultRoles, parseMinimalProxyImplementation } from './hypoVaultRoles'

const VAULT = '0x1111111111111111111111111111111111111111' as Address
const IMPLEMENTATION = '0x2222222222222222222222222222222222222222' as Address
const SAFE = '0x3333333333333333333333333333333333333333' as Address
const EOA = '0x4444444444444444444444444444444444444444' as Address
const MANAGER = '0x5555555555555555555555555555555555555555' as Address
const ACCOUNTANT = '0x6666666666666666666666666666666666666666' as Address
const TIMELOCK = '0x7777777777777777777777777777777777777777' as Address
const SIGNERS = [
  '0x8888888888888888888888888888888888888888',
  '0x9999999999999999999999999999999999999999',
  '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa',
] as Address[]

const minimalProxyCode = (implementation: Address): Hex =>
  `0x363d3d373d3d3d363d73${implementation.slice(2)}5af43d82803e903d91602b57fd5bf3`

function makeClient({
  code,
  owners,
  safes,
  timelocks = {},
  proposers = [],
}: {
  code: Record<string, Hex | undefined>
  owners: Record<string, Address>
  safes: Record<string, { threshold: bigint; signers: Address[] }>
  timelocks?: Record<string, bigint>
  proposers?: Address[]
}) {
  return {
    getCode: vi.fn(async ({ address }: { address: Address }) => code[address]),
    readContract: vi.fn(
      async ({
        address,
        functionName,
        args,
      }: {
        address: Address
        functionName: string
        args?: readonly unknown[]
      }) => {
        if (functionName === 'owner') {
          const owner = owners[address]
          if (owner === undefined) throw new Error('owner() reverted')
          return owner
        }
        if (functionName === 'hasRole') {
          return proposers.includes(args?.[1] as Address)
        }
        if (functionName === 'getMinDelay') {
          const minDelay = timelocks[address]
          if (minDelay === undefined) throw new Error('not a timelock')
          return minDelay
        }
        const safe = safes[address]
        if (safe === undefined) throw new Error('not a Safe')
        return functionName === 'getThreshold' ? safe.threshold : safe.signers
      },
    ),
  } as unknown as Parameters<typeof fetchHypoVaultRoles>[0]['client']
}

describe('parseMinimalProxyImplementation', () => {
  it('extracts the implementation from EIP-1167 runtime code', () => {
    expect(parseMinimalProxyImplementation(minimalProxyCode(IMPLEMENTATION))).toBe(IMPLEMENTATION)
  })

  it('returns null for anything else', () => {
    expect(parseMinimalProxyImplementation(undefined)).toBeNull()
    expect(parseMinimalProxyImplementation('0x')).toBeNull()
    expect(parseMinimalProxyImplementation('0x6080604052')).toBeNull()
  })
})

describe('fetchHypoVaultRoles', () => {
  it('describes a Safe owner, an EOA manager owner and a contract accountant owner', async () => {
    const client = makeClient({
      code: {
        [VAULT]: minimalProxyCode(IMPLEMENTATION),
        [SAFE]: '0x6080',
        [EOA]: undefined,
        [TIMELOCK]: '0x6080',
      },
      owners: { [MANAGER]: EOA, [ACCOUNTANT]: TIMELOCK },
      safes: { [SAFE]: { threshold: 2n, signers: SIGNERS } },
    })

    await expect(
      fetchHypoVaultRoles({
        client,
        vaultAddress: VAULT,
        ownerAddress: SAFE,
        managerAddress: MANAGER,
        accountantAddress: ACCOUNTANT,
      }),
    ).resolves.toEqual({
      implementation: IMPLEMENTATION,
      owner: { address: SAFE, kind: 'safe', threshold: 2, signers: SIGNERS },
      managerOwner: { address: EOA, kind: 'eoa' },
      accountantOwner: { address: TIMELOCK, kind: 'contract' },
    })
  })

  it('describes a timelock owner with its delay', async () => {
    const client = makeClient({
      code: { [TIMELOCK]: '0x6080' },
      owners: {},
      safes: {},
      timelocks: { [TIMELOCK]: 86_400n },
    })

    const roles = await fetchHypoVaultRoles({
      client,
      vaultAddress: VAULT,
      ownerAddress: TIMELOCK,
      managerAddress: null,
      accountantAddress: null,
    })

    expect(roles.owner).toEqual({
      address: TIMELOCK,
      kind: 'timelock',
      minDelaySeconds: 86_400,
      proposers: [],
    })
  })

  it('lists the timelock proposers that hold PROPOSER_ROLE among the candidates', async () => {
    const client = makeClient({
      code: { [TIMELOCK]: '0x6080', [SAFE]: '0x6080', [EOA]: undefined },
      owners: {},
      safes: { [SAFE]: { threshold: 3n, signers: SIGNERS } },
      timelocks: { [TIMELOCK]: 86_400n },
      proposers: [SAFE],
    })

    const roles = await fetchHypoVaultRoles({
      client,
      vaultAddress: VAULT,
      ownerAddress: TIMELOCK,
      managerAddress: null,
      accountantAddress: null,
      timelockProposerCandidates: [SAFE, EOA],
    })

    expect(roles.owner).toEqual({
      address: TIMELOCK,
      kind: 'timelock',
      minDelaySeconds: 86_400,
      proposers: [{ address: SAFE, kind: 'safe', threshold: 3, signers: SIGNERS }],
    })
  })

  it('treats an EIP-7702 delegated account as an EOA', async () => {
    const client = makeClient({
      code: { [EOA]: '0xef01002222222222222222222222222222222222222222' },
      owners: {},
      safes: {},
    })

    const roles = await fetchHypoVaultRoles({
      client,
      vaultAddress: VAULT,
      ownerAddress: EOA,
      managerAddress: null,
      accountantAddress: null,
    })

    expect(roles.owner).toEqual({ address: EOA, kind: 'eoa' })
  })

  it('degrades each field independently', async () => {
    const client = makeClient({
      code: { [VAULT]: '0x6080', [SAFE]: '0x6080' },
      owners: {},
      safes: { [SAFE]: { threshold: 3n, signers: SIGNERS } },
    })

    await expect(
      fetchHypoVaultRoles({
        client,
        vaultAddress: VAULT,
        ownerAddress: SAFE,
        managerAddress: MANAGER,
        accountantAddress: null,
      }),
    ).resolves.toEqual({
      implementation: null,
      owner: { address: SAFE, kind: 'safe', threshold: 3, signers: SIGNERS },
      managerOwner: null,
      accountantOwner: null,
    })
  })
})
