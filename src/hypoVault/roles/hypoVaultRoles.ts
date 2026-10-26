import { type Address, type Hex, type PublicClient, getAddress, keccak256, toHex } from 'viem'

import { HypoVaultManagerWithMerkleVerificationAbi } from '../../abis/HypoVaultManagerWithMerkleVerification'
import { PanopticVaultAccountantAbi } from '../../abis/PanopticVaultAccountant'

const SAFE_ABI = [
  {
    type: 'function',
    name: 'getThreshold',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getOwners',
    inputs: [],
    outputs: [{ name: '', type: 'address[]' }],
    stateMutability: 'view',
  },
] as const

const TIMELOCK_ABI = [
  {
    type: 'function',
    name: 'getMinDelay',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'hasRole',
    inputs: [
      { name: 'role', type: 'bytes32' },
      { name: 'account', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
] as const

const TIMELOCK_PROPOSER_ROLE = keccak256(toHex('PROPOSER_ROLE'))

const EIP_1167_RUNTIME_CODE = /^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/
const EIP_7702_DELEGATION_PREFIX = '0xef0100'

export type HypoVaultSignerAccount =
  | { address: Address; kind: 'eoa' | 'contract' }
  | { address: Address; kind: 'safe'; threshold: number; signers: Address[] }

export type HypoVaultRoleAccount =
  | HypoVaultSignerAccount
  | {
      address: Address
      kind: 'timelock'
      minDelaySeconds: number
      /** Candidates confirmed to hold PROPOSER_ROLE; the timelock does not enumerate roles. */
      proposers: HypoVaultSignerAccount[]
    }

export type HypoVaultRoles = {
  /** Null when the vault is not an EIP-1167 minimal proxy. */
  implementation: Address | null
  owner: HypoVaultRoleAccount | null
  managerOwner: HypoVaultRoleAccount | null
  accountantOwner: HypoVaultRoleAccount | null
}

type RolesClient = Pick<PublicClient, 'getCode' | 'readContract'>

export function parseMinimalProxyImplementation(code: Hex | undefined): Address | null {
  const match = code?.toLowerCase().match(EIP_1167_RUNTIME_CODE)
  return match?.[1] === undefined ? null : getAddress(`0x${match[1]}`)
}

async function describeSignerAccount(
  client: RolesClient,
  address: Address,
): Promise<HypoVaultSignerAccount | null> {
  const code = await client.getCode({ address })
  if (
    code === undefined ||
    code === '0x' ||
    code.toLowerCase().startsWith(EIP_7702_DELEGATION_PREFIX)
  ) {
    return { address, kind: 'eoa' }
  }

  try {
    const [threshold, signers] = await Promise.all([
      client.readContract({ address, abi: SAFE_ABI, functionName: 'getThreshold' }),
      client.readContract({ address, abi: SAFE_ABI, functionName: 'getOwners' }),
    ])
    return { address, kind: 'safe', threshold: Number(threshold), signers: [...signers] }
  } catch {
    return null
  }
}

async function describeRoleAccount(
  client: RolesClient,
  address: Address,
  timelockProposerCandidates: Address[],
): Promise<HypoVaultRoleAccount> {
  const signer = await describeSignerAccount(client, address)
  if (signer !== null) {
    return signer
  }

  try {
    const minDelay = await client.readContract({
      address,
      abi: TIMELOCK_ABI,
      functionName: 'getMinDelay',
    })
    const proposers = await Promise.all(
      timelockProposerCandidates.map(async (candidate) => {
        const isProposer = await client.readContract({
          address,
          abi: TIMELOCK_ABI,
          functionName: 'hasRole',
          args: [TIMELOCK_PROPOSER_ROLE, candidate],
        })
        if (!isProposer) {
          return null
        }
        return (
          (await describeSignerAccount(client, candidate)) ?? {
            address: candidate,
            kind: 'contract' as const,
          }
        )
      }),
    )
    return {
      address,
      kind: 'timelock',
      minDelaySeconds: Number(minDelay),
      proposers: proposers.flatMap((proposer) => (proposer === null ? [] : [proposer])),
    }
  } catch {
    return { address, kind: 'contract' }
  }
}

async function settleOrNull<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise
  } catch {
    return null
  }
}

/**
 * Reads who ultimately controls a HypoVault: its implementation, and the accounts that own
 * the vault, its manager and its accountant. Each field degrades to null independently so
 * one failing read does not hide the others.
 */
export async function fetchHypoVaultRoles({
  client,
  vaultAddress,
  ownerAddress,
  managerAddress,
  accountantAddress,
  timelockProposerCandidates = [],
}: {
  client: RolesClient
  vaultAddress: Address
  ownerAddress: Address | null
  managerAddress: Address | null
  accountantAddress: Address | null
  /** Accounts to check for PROPOSER_ROLE when an owner turns out to be a timelock. */
  timelockProposerCandidates?: Address[]
}): Promise<HypoVaultRoles> {
  const describeOwnerOf = async (
    contract: Address | null,
    abi: typeof HypoVaultManagerWithMerkleVerificationAbi | typeof PanopticVaultAccountantAbi,
  ) => {
    if (contract === null) {
      return null
    }
    const contractOwner = await client.readContract({
      address: contract,
      abi,
      functionName: 'owner',
    })
    return describeRoleAccount(client, contractOwner, timelockProposerCandidates)
  }

  const [implementation, owner, managerOwner, accountantOwner] = await Promise.all([
    settleOrNull(client.getCode({ address: vaultAddress }).then(parseMinimalProxyImplementation)),
    ownerAddress === null
      ? null
      : settleOrNull(describeRoleAccount(client, ownerAddress, timelockProposerCandidates)),
    settleOrNull(describeOwnerOf(managerAddress, HypoVaultManagerWithMerkleVerificationAbi)),
    settleOrNull(describeOwnerOf(accountantAddress, PanopticVaultAccountantAbi)),
  ])

  return { implementation, owner, managerOwner, accountantOwner }
}
