import { describe, expect, it } from 'vitest'

import { buildManageArgs, findLeafForTarget } from '../utils/buildManageArgs'
import {
  type StrategistLeafDefinition,
  createStrategistLeavesArtifact,
} from './createStrategistLeavesArtifact'
import {
  MAINNET_USDC_PLP_PRE_V3_MANAGE_ROOT,
  MAINNET_USDC_PLP_STRATEGIST_LEAF_DEFINITIONS,
  MainnetUSDCPLPStrategistLeaves,
} from './MainnetUSDCPLPStrategistLeaves'
import {
  MAINNET_WETH_PLP_STRATEGIST_LEAF_DEFINITIONS,
  MainnetWETHPLPStrategistLeaves,
} from './MainnetWETHPLPStrategistLeaves'

const NEW_POOL = '0x00000000009C7B687e833559e34503f64d7ed7c4'
const OLD_POOL = '0x00000000563b70d704f4c6675a5f6ac989fbae13'
const CURRENT_PO_ETH = '0x1e46b0289B7E0F710E2Db8Ab87800dd782D624f7'
const CURRENT_PO_USDC = '0x12bF31955522BAC337D93e1bC0a39F68D8BDa216'
const NEW_PO_USDC = '0x3CCdA7d5E841d6543D90BcEc20b36a724C184DE9'
const NEW_PO_WETH = '0x69E9f9e44E5F52237493b980dd7306198C64A4E4'
const WSPCXX_PO_USDC = '0x141cc517a6276542B59732Fd85C1A2C536eF7aCA'
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const DISPATCH = 'Dispatch mint/burn options on PanopticPool'
const DISPATCH_SIGNATURE = 'dispatch(uint256[],uint256[],uint128[],int24[3][],bool,uint256)'
const TRACKER_ACTIONS = [
  'deposit(uint256,address)',
  'withdraw(uint256,address,address)',
  'withdraw(uint256,address,address,uint256[],bool)',
  'mint(uint256,address)',
  'redeem(uint256,address,address)',
] as const
const STRATEGIST_DEFINITION_SETS: readonly (readonly StrategistLeafDefinition[])[] = [
  MAINNET_WETH_PLP_STRATEGIST_LEAF_DEFINITIONS,
  MAINNET_USDC_PLP_STRATEGIST_LEAF_DEFINITIONS,
]

function expectErc20TrackerLifecycle(
  definitions: readonly StrategistLeafDefinition[],
  token: string,
  tracker: string,
) {
  const approvalLeaves = definitions.filter(
    ({ target, functionSignature, addressArguments }) =>
      target.toLowerCase() === token.toLowerCase() &&
      functionSignature === 'approve(address,uint256)' &&
      addressArguments[0]?.toLowerCase() === tracker.toLowerCase(),
  )
  const trackerLeaves = definitions.filter(
    ({ target }) => target.toLowerCase() === tracker.toLowerCase(),
  )

  expect(approvalLeaves).toHaveLength(1)
  expect(approvalLeaves[0]?.canSendValue).toBe(false)
  expect(trackerLeaves).toHaveLength(TRACKER_ACTIONS.length)
  expect(trackerLeaves.map(({ functionSignature }) => functionSignature)).toEqual(
    expect.arrayContaining([...TRACKER_ACTIONS]),
  )
  expect(trackerLeaves.every(({ canSendValue }) => !canSendValue)).toBe(true)
}

function expectNativeTrackerLifecycle(
  definitions: readonly StrategistLeafDefinition[],
  tracker: string,
) {
  const trackerLeaves = definitions.filter(
    ({ target }) => target.toLowerCase() === tracker.toLowerCase(),
  )

  expect(trackerLeaves).toHaveLength(TRACKER_ACTIONS.length)
  expect(trackerLeaves.map(({ functionSignature }) => functionSignature)).toEqual(
    expect.arrayContaining([...TRACKER_ACTIONS]),
  )
  for (const leaf of trackerLeaves) {
    expect(leaf.canSendValue).toBe(
      leaf.functionSignature === 'deposit(uint256,address)' ||
        leaf.functionSignature === 'mint(uint256,address)',
    )
  }
}

describe('mainnet strategist leaves', () => {
  it('reproduces the previous roots from the preserved leaf prefixes', () => {
    const wethPrevious = createStrategistLeavesArtifact(
      {
        accountantAddress: '0x65aA902AE3135658587FFC36ED51B61c927114e1',
        boringVaultAddress: '0xd4e2c720a760049cc4151bcf61e3a9348db9cd92',
        decoderAndSanitizerAddress: '0xC87c45d2dbE5acb56013e2591427ECC84Fa251E6',
        managerAddress: '0xB6Fc48e658C9B1a7dbdFA51A5E153ab60BB2e04d',
      },
      MAINNET_WETH_PLP_STRATEGIST_LEAF_DEFINITIONS.slice(0, 10),
    )
    const usdcPrevious = createStrategistLeavesArtifact(
      {
        accountantAddress: '0x65aA902AE3135658587FFC36ED51B61c927114e1',
        boringVaultAddress: '0x236d0558f06cd60780b232d4Ec4c92d2cb7e4D18',
        decoderAndSanitizerAddress: '0xC87c45d2dbE5acb56013e2591427ECC84Fa251E6',
        managerAddress: '0x2ce65016366ef7320078e0758D58Cf1038bc7C4e',
      },
      MAINNET_USDC_PLP_STRATEGIST_LEAF_DEFINITIONS.slice(0, 12),
    )

    expect(wethPrevious.metadata.ManageRoot).toBe(
      '0x14c4c96cc3730452ce71a447bdde6132f81acec862098a9ddd5e086805046a07',
    )
    expect(usdcPrevious.metadata.ManageRoot).toBe(MAINNET_USDC_PLP_PRE_V3_MANAGE_ROOT)
  })

  it('selects and proves each dispatch leaf by pool target', () => {
    for (const artifact of [MainnetWETHPLPStrategistLeaves, MainnetUSDCPLPStrategistLeaves]) {
      const oldDispatch = findLeafForTarget(artifact, DISPATCH, OLD_POOL)
      const newDispatch = findLeafForTarget(artifact, DISPATCH, NEW_POOL)

      expect(oldDispatch.LeafDigest).not.toBe(newDispatch.LeafDigest)
      expect(oldDispatch.TargetAddress.toLowerCase()).toBe(OLD_POOL.toLowerCase())
      expect(newDispatch.TargetAddress.toLowerCase()).toBe(NEW_POOL.toLowerCase())

      const [proofs, , targets] = buildManageArgs(
        [
          { leaf: oldDispatch, data: '0x' },
          { leaf: newDispatch, data: '0x' },
        ],
        artifact,
      )
      expect(proofs).toHaveLength(2)
      expect(proofs[0]).toHaveLength(5)
      expect(proofs[1]).toHaveLength(5)
      expect(targets.map((target) => target.toLowerCase())).toEqual([
        OLD_POOL.toLowerCase(),
        NEW_POOL.toLowerCase(),
      ])
    }
  })

  it('authorizes complete two-sided lifecycles for the existing ETH/USDC pool', () => {
    expectNativeTrackerLifecycle(MAINNET_WETH_PLP_STRATEGIST_LEAF_DEFINITIONS, CURRENT_PO_ETH)
    expectErc20TrackerLifecycle(MAINNET_WETH_PLP_STRATEGIST_LEAF_DEFINITIONS, USDC, CURRENT_PO_USDC)
    expectNativeTrackerLifecycle(MAINNET_USDC_PLP_STRATEGIST_LEAF_DEFINITIONS, CURRENT_PO_ETH)
    expectErc20TrackerLifecycle(MAINNET_USDC_PLP_STRATEGIST_LEAF_DEFINITIONS, USDC, CURRENT_PO_USDC)
  })

  it('authorizes exactly one complete two-sided lifecycle and dispatch for the v3 pool', () => {
    for (const definitions of STRATEGIST_DEFINITION_SETS) {
      expectErc20TrackerLifecycle(definitions, USDC, NEW_PO_USDC)
      expectErc20TrackerLifecycle(definitions, WETH, NEW_PO_WETH)

      const dispatchLeaves = definitions.filter(
        ({ target, functionSignature }) =>
          target.toLowerCase() === NEW_POOL.toLowerCase() &&
          functionSignature === DISPATCH_SIGNATURE,
      )
      expect(dispatchLeaves).toHaveLength(1)
      expect(dispatchLeaves[0]?.canSendValue).toBe(false)
    }
  })

  it('does not authorize swaps, conversion, transfers, delegation, or unexpected targets', () => {
    const allowedTargets = new Set(
      [
        OLD_POOL,
        NEW_POOL,
        CURRENT_PO_ETH,
        CURRENT_PO_USDC,
        NEW_PO_WETH,
        NEW_PO_USDC,
        WSPCXX_PO_USDC,
        WETH,
        USDC,
      ].map((address) => address.toLowerCase()),
    )
    const allowedSignatures = new Set([
      'approve(address,uint256)',
      'deposit()',
      'deposit(uint256,address)',
      DISPATCH_SIGNATURE,
      'mint(uint256,address)',
      'redeem(uint256,address,address)',
      'withdraw(uint256)',
      'withdraw(uint256,address,address)',
      'withdraw(uint256,address,address,uint256[],bool)',
    ])

    for (const definitions of STRATEGIST_DEFINITION_SETS) {
      for (const definition of definitions) {
        expect(allowedTargets.has(definition.target.toLowerCase())).toBe(true)
        expect(allowedSignatures.has(definition.functionSignature)).toBe(true)
        expect(definition.description).not.toMatch(/swap|router|transfer|delegat|convert/i)
        expect(definition.functionSignature).not.toMatch(
          /swap|dispatchFrom|transfer|delegat|convert/i,
        )
      }
    }
  })
})
