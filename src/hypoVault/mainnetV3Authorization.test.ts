import { createClient, custom, numberToHex } from 'viem'
import { mainnet } from 'viem/chains'
import { describe, expect, it } from 'vitest'

import { MAINNET_CHAIN_ID, requireChainDeployment } from './chainDeployments'
import {
  MAINNET_USDC_PLP_PRE_V3_AUTHORIZATION_BLOCK,
  MAINNET_USDC_PLP_PRE_V3_MANAGE_ROOT,
  MAINNET_USDC_PLP_PRE_V3_STRATEGIST,
} from './hypoVaultManagerArtifacts/MainnetUSDCPLPStrategistLeaves'
import {
  getMainnetV3AuthorizationArtifactsAtBlock,
  getMainnetV3AuthorizationGenerations,
  MAINNET_V3_AUTHORIZATION_BLOCK,
  resolveMainnetV3AuthorizationArtifacts,
} from './mainnetV3Authorization'

const deployment = requireChainDeployment(MAINNET_CHAIN_ID)
const vaultAddress = deployment.hypovault.vaults.wethPlpVault
const blockNumber = 24_000_000n

function clientForState(
  { poolHash, manageRoot }: { poolHash: string; manageRoot: string },
  { rejectBlockNumber = false }: { rejectBlockNumber?: boolean } = {},
) {
  return createClient({
    chain: mainnet,
    transport: custom({
      request: async ({ method, params }) => {
        if (method === 'eth_blockNumber') {
          if (rejectBlockNumber) throw new Error('Unexpected latest-block lookup')
          return numberToHex(blockNumber)
        }
        if (method === 'eth_call') {
          const call = params[0]
          return call.to?.toLowerCase() === deployment.hypovault.core.accountant.toLowerCase()
            ? poolHash
            : manageRoot
        }
        throw new Error(`Unexpected RPC method ${method}`)
      },
    }),
  })
}

describe('mainnet v3 authorization transition', () => {
  it('selects historical artifacts at the execution block boundary without a client', () => {
    const before = getMainnetV3AuthorizationArtifactsAtBlock({
      chainId: MAINNET_CHAIN_ID,
      vaultAddress,
      blockNumber: MAINNET_V3_AUTHORIZATION_BLOCK - 1n,
    })
    const current = getMainnetV3AuthorizationArtifactsAtBlock({
      chainId: MAINNET_CHAIN_ID,
      vaultAddress,
      blockNumber: MAINNET_V3_AUTHORIZATION_BLOCK,
    })

    expect(before?.version).toBe('previous')
    expect(before?.poolInfos).toHaveLength(1)
    expect(current?.version).toBe('next')
    expect(current?.poolInfos).toHaveLength(2)
  })

  it('preserves the exact pre-transition pool hashes and manage roots', () => {
    // Previous values were read from mainnet at block 25,704,950, immediately before execution.
    const wethGenerations = getMainnetV3AuthorizationGenerations({
      chainId: MAINNET_CHAIN_ID,
      vaultAddress,
    })
    const usdcGenerations = getMainnetV3AuthorizationGenerations({
      chainId: MAINNET_CHAIN_ID,
      vaultAddress: deployment.hypovault.vaults.usdcPlpVault,
    })

    expect(wethGenerations?.previous.poolHash).toBe(
      '0x10c87ff39e0bfadaa7b8ef86391b0578b66cec8b93e4bf5157c9ab7cc8db578b',
    )
    expect(wethGenerations?.previous.manageRoot).toBe(
      '0x14c4c96cc3730452ce71a447bdde6132f81acec862098a9ddd5e086805046a07',
    )
    expect(wethGenerations?.next.poolHash).toBe(
      '0x9d6a4835d0acf5b962185bc9ae5c82d8b3f0424945aa13e86d9766549011ca1f',
    )
    expect(wethGenerations?.next.manageRoot).toBe(
      '0x4d2fb008ac93d2a363881e31e65f31bacbefef39efb44cf2f95b65cf49c65c7d',
    )
    expect(wethGenerations?.current.poolHash).toBe(
      '0x450c55809afb4950087cf439f3ee4c9ec6f13478568c0a7c9e919418b379b975',
    )
    expect(wethGenerations?.current.manageRoot).toBe(
      '0x99baae2a0ddf55db31bf2e340856e6e76c87d37add86e95483bd7d1bad93e95c',
    )
    expect(usdcGenerations?.previous.poolHash).toBe(
      '0x32148c1d3efa7ecf95c9b76cdaef4497a14a756deca81cfa2adfe4f6f30a9889',
    )
    expect(usdcGenerations?.previous.manageRoot).toBe(
      '0xed7d4ae055fd62c6edc93bd676456748f52fe4f4b78f60ab3ef6394bacc31b5d',
    )
    expect(usdcGenerations?.next.poolHash).toBe(
      '0x34f9775b7712b73ed2f82344ae1e727f3d217c5df69fd9cfd230796731de62c9',
    )
    expect(usdcGenerations?.next.manageRoot).toBe(
      '0x3223880461fe3e61dc96d9d81579ae943507ec95f17cba100b462cec53967e14',
    )
    expect(usdcGenerations?.current.poolHash).toBe(
      '0x450c55809afb4950087cf439f3ee4c9ec6f13478568c0a7c9e919418b379b975',
    )
    expect(usdcGenerations?.current.manageRoot).toBe(
      '0x29587b0f67aefbf4a11ecffe3bfb56ebef54e441df95fa260d44273d182027b7',
    )
  })

  it.each(['current', 'next', 'previous'] as const)(
    'selects the %s generation atomically',
    async (version) => {
      const generations = getMainnetV3AuthorizationGenerations({
        chainId: MAINNET_CHAIN_ID,
        vaultAddress,
      })
      expect(generations).not.toBeNull()
      if (generations === null) return

      const generation = generations[version]
      const resolved = await resolveMainnetV3AuthorizationArtifacts({
        viemClient: clientForState(generation),
        chainId: MAINNET_CHAIN_ID,
        vaultAddress,
      })

      expect(resolved?.version).toBe(version === 'current' ? 'v3-only' : version)
      expect(resolved?.blockNumber).toBe(blockNumber)
      expect(resolved?.poolInfos).toHaveLength(version === 'next' ? 2 : 1)
      expect(resolved?.strategistLeaves.metadata.ManageRoot).toBe(generation.manageRoot)
    },
  )

  it('rejects a mixed accountant and manager generation', async () => {
    const generations = getMainnetV3AuthorizationGenerations({
      chainId: MAINNET_CHAIN_ID,
      vaultAddress,
    })
    expect(generations).not.toBeNull()
    if (generations === null) return

    await expect(
      resolveMainnetV3AuthorizationArtifacts({
        viemClient: clientForState({
          poolHash: generations.next.poolHash,
          manageRoot: generations.previous.manageRoot,
        }),
        chainId: MAINNET_CHAIN_ID,
        vaultAddress,
      }),
    ).rejects.toThrow('Unsupported or inconsistent mainnet v3 authorization state')
  })

  it.each([
    [
      'accountant pool hash',
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      null,
    ],
    ['manager root', null, '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
  ] as const)('rejects an unknown %s', async (_label, poolHashOverride, manageRootOverride) => {
    const generations = getMainnetV3AuthorizationGenerations({
      chainId: MAINNET_CHAIN_ID,
      vaultAddress,
    })
    expect(generations).not.toBeNull()
    if (generations === null) return

    await expect(
      resolveMainnetV3AuthorizationArtifacts({
        viemClient: clientForState({
          poolHash: poolHashOverride ?? generations.next.poolHash,
          manageRoot: manageRootOverride ?? generations.next.manageRoot,
        }),
        chainId: MAINNET_CHAIN_ID,
        vaultAddress,
      }),
    ).rejects.toThrow('Unsupported or inconsistent mainnet v3 authorization state')
  })

  it('returns null before reading state for non-mainnet chains and unknown vaults', async () => {
    const client = clientForState({ poolHash: '0x', manageRoot: '0x' })
    await expect(
      resolveMainnetV3AuthorizationArtifacts({
        viemClient: client,
        chainId: 8453,
        vaultAddress,
      }),
    ).resolves.toBeNull()
    await expect(
      resolveMainnetV3AuthorizationArtifacts({
        viemClient: client,
        chainId: MAINNET_CHAIN_ID,
        vaultAddress: '0x0000000000000000000000000000000000000001',
      }),
    ).resolves.toBeNull()
  })

  it('uses a caller-supplied block without resolving the latest block', async () => {
    const generations = getMainnetV3AuthorizationGenerations({
      chainId: MAINNET_CHAIN_ID,
      vaultAddress,
    })
    expect(generations).not.toBeNull()
    if (generations === null) return
    const client = clientForState(generations.next, { rejectBlockNumber: true })

    const resolved = await resolveMainnetV3AuthorizationArtifacts({
      viemClient: client,
      chainId: MAINNET_CHAIN_ID,
      vaultAddress,
      blockNumber: 25_704_950n,
    })

    expect(resolved?.blockNumber).toBe(25_704_950n)
  })

  it('matches the independently recorded USDC strategist root before authorization', async () => {
    const usdcVaultAddress = deployment.hypovault.vaults.usdcPlpVault
    const generations = getMainnetV3AuthorizationGenerations({
      chainId: MAINNET_CHAIN_ID,
      vaultAddress: usdcVaultAddress,
    })
    expect(generations).not.toBeNull()
    if (generations === null) return

    const resolved = await resolveMainnetV3AuthorizationArtifacts({
      viemClient: clientForState(
        {
          poolHash: generations.previous.poolHash,
          manageRoot: MAINNET_USDC_PLP_PRE_V3_MANAGE_ROOT,
        },
        { rejectBlockNumber: true },
      ),
      chainId: MAINNET_CHAIN_ID,
      vaultAddress: usdcVaultAddress,
      blockNumber: MAINNET_USDC_PLP_PRE_V3_AUTHORIZATION_BLOCK,
    })

    expect(MAINNET_USDC_PLP_PRE_V3_STRATEGIST).toBe('0x3c1c79d0cfc316Ba959194c89696a8382d7d283b')
    expect(resolved?.strategistLeaves.metadata.ManageRoot).toBe(MAINNET_USDC_PLP_PRE_V3_MANAGE_ROOT)
  })
})
