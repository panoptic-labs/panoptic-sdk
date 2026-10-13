import { describe, expect, it } from 'vitest'

import {
  getRobinhoodSpyUsdgAuthorizationGenerations,
  resolveRobinhoodSpyUsdgAuthorizationState,
} from '../robinhoodSpyUsdgAuthorization'
import { buildManageArgs, findLeafForTargetAndSignature } from '../utils/buildManageArgs'
import {
  MAINNET_USDC_REPLACEMENT_ARTIFACTS,
  MAINNET_WETH_REPLACEMENT_ARTIFACTS,
  ROBINHOOD_USDG_REPLACEMENT_ARTIFACTS,
} from './replacementPoolArtifacts'

const oldTargets = [
  '0x00000000009c7b687e833559e34503f64d7ed7c4',
  '0x3ccda7d5e841d6543d90bcec20b36a724c184de9',
  '0x69e9f9e44e5f52237493b980dd7306198c64a4e4',
  '0x000000000c21b38c54aca7c7145df01ff09d69bb',
  '0xdc508622cd7e3850c8240e88c10361cf493465b6',
  '0x9212d804953baf89c24cefa6545aa293ba08a876',
]

describe('replacement pool authorization', () => {
  it('reproduces the reviewed replacement Merkle roots', () => {
    expect(MAINNET_WETH_REPLACEMENT_ARTIFACTS.strategistLeaves.metadata.ManageRoot).toBe(
      '0x4d6b2f97937939f378ff26d99d85ccaeeef73f33e495946d3ba0fb17ae624da3',
    )
    expect(MAINNET_USDC_REPLACEMENT_ARTIFACTS.strategistLeaves.metadata.ManageRoot).toBe(
      '0x035589e259ab734a0083fdd20a5930f9f1a6daf547b69d0b0a1fe40a2043662d',
    )
    expect(ROBINHOOD_USDG_REPLACEMENT_ARTIFACTS.strategistLeaves.metadata.ManageRoot).toBe(
      '0x18a0e35a8f382475cafc92af9d6f627302c7fa4551826e595322bb2c507029e5',
    )
  })

  it.each([
    MAINNET_WETH_REPLACEMENT_ARTIFACTS,
    MAINNET_USDC_REPLACEMENT_ARTIFACTS,
    ROBINHOOD_USDG_REPLACEMENT_ARTIFACTS,
  ])(
    'excludes all old pool targets and approval spenders',
    ({ strategistLeaves, deployment, vaultPoolInfos }) => {
      expect(vaultPoolInfos.poolInfos.map(({ pool }) => pool)).toEqual([deployment.panopticPool])
      const leaves = strategistLeaves.leafs.filter(({ Description }) => Description !== '')
      for (const leaf of leaves) {
        expect(oldTargets).not.toContain(leaf.TargetAddress.toLowerCase())
        for (const address of leaf.AddressArguments)
          expect(oldTargets).not.toContain(address.toLowerCase())
      }
      const dispatch = findLeafForTargetAndSignature(
        strategistLeaves,
        deployment.panopticPool,
        'dispatch(uint256[],uint256[],uint128[],int24[3][],bool,uint256)',
        [],
      )
      expect(
        buildManageArgs([{ leaf: dispatch, data: '0x' }], strategistLeaves)[0][0],
      ).toHaveLength(4)
    },
  )

  it('preserves standalone WETH wrapping and unwrapping', () => {
    const artifact = MAINNET_WETH_REPLACEMENT_ARTIFACTS.strategistLeaves
    const weth = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
    expect(findLeafForTargetAndSignature(artifact, weth, 'deposit()', []).CanSendValue).toBe(true)
    expect(
      findLeafForTargetAndSignature(artifact, weth, 'withdraw(uint256)', []).CanSendValue,
    ).toBe(false)
  })

  it('selects replacement Robinhood artifacts only for a complete root/hash pair', () => {
    const generations = getRobinhoodSpyUsdgAuthorizationGenerations()
    const next = generations.find(({ version }) => version === 'replacement')
    const old = generations.find(({ version }) => version === '5bps')
    if (next === undefined || old === undefined) throw new Error('Missing test generation')
    expect(
      resolveRobinhoodSpyUsdgAuthorizationState({
        blockNumber: 1n,
        poolHash: next.poolHash,
        manageRoot: next.manageRoot,
      }).version,
    ).toBe('replacement')
    expect(() =>
      resolveRobinhoodSpyUsdgAuthorizationState({
        blockNumber: 1n,
        poolHash: next.poolHash,
        manageRoot: old.manageRoot,
      }),
    ).toThrow('inconsistent')
    expect(() =>
      resolveRobinhoodSpyUsdgAuthorizationState({
        blockNumber: 1n,
        poolHash: old.poolHash,
        manageRoot: next.manageRoot,
      }),
    ).toThrow('inconsistent')
  })
})
