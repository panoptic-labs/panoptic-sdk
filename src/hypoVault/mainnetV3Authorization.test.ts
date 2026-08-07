import { createClient, custom, numberToHex } from 'viem'
import { mainnet } from 'viem/chains'
import { describe, expect, it } from 'vitest'

import { MAINNET_CHAIN_ID, requireChainDeployment } from './chainDeployments'
import {
  getMainnetV3AuthorizationGenerations,
  resolveMainnetV3AuthorizationArtifacts,
} from './mainnetV3Authorization'

const deployment = requireChainDeployment(MAINNET_CHAIN_ID)
const vaultAddress = deployment.hypovault.vaults.wethPlpVault
const blockNumber = 24_000_000n

function clientForState({ poolHash, manageRoot }: { poolHash: string; manageRoot: string }) {
  return createClient({
    chain: mainnet,
    transport: custom({
      request: async ({ method, params }) => {
        if (method === 'eth_blockNumber') {
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
  it('preserves the exact pre-transition pool hashes and manage roots', () => {
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
  })

  it.each(['next', 'previous'] as const)(
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

      expect(resolved?.version).toBe(version)
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
})
