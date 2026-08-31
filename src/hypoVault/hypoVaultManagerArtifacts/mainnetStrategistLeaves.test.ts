import { describe, expect, it } from 'vitest'

import {
  buildManageArgs,
  findLeafForTarget,
  findLeafForTargetAndSignature,
} from '../utils/buildManageArgs'
import {
  type StrategistLeafDefinition,
  createStrategistLeavesArtifact,
} from './createStrategistLeavesArtifact'
import {
  MAINNET_USDC_PLP_PRE_V3_MANAGE_ROOT,
  MAINNET_USDC_PLP_STRATEGIST_LEAF_DEFINITIONS,
  MAINNET_USDC_PLP_V3_AUTHORIZED_STRATEGIST_LEAF_DEFINITIONS,
  MainnetUSDCPLPStrategistLeaves,
  MainnetUSDCPLPV3AuthorizedStrategistLeaves,
} from './MainnetUSDCPLPStrategistLeaves'
import {
  MAINNET_WETH_PLP_STRATEGIST_LEAF_DEFINITIONS,
  MAINNET_WETH_PLP_V3_AUTHORIZED_STRATEGIST_LEAF_DEFINITIONS,
  MainnetWETHPLPStrategistLeaves,
  MainnetWETHPLPV3AuthorizedStrategistLeaves,
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

describe('mainnet strategist leaves', () => {
  it('reproduces the previous roots from the preserved leaf prefixes', () => {
    const wethPrevious = createStrategistLeavesArtifact(
      {
        accountantAddress: '0x65aA902AE3135658587FFC36ED51B61c927114e1',
        boringVaultAddress: '0xd4e2c720a760049cc4151bcf61e3a9348db9cd92',
        decoderAndSanitizerAddress: '0xC87c45d2dbE5acb56013e2591427ECC84Fa251E6',
        managerAddress: '0xB6Fc48e658C9B1a7dbdFA51A5E153ab60BB2e04d',
      },
      MAINNET_WETH_PLP_V3_AUTHORIZED_STRATEGIST_LEAF_DEFINITIONS.slice(0, 10),
    )
    const usdcPrevious = createStrategistLeavesArtifact(
      {
        accountantAddress: '0x65aA902AE3135658587FFC36ED51B61c927114e1',
        boringVaultAddress: '0x236d0558f06cd60780b232d4Ec4c92d2cb7e4D18',
        decoderAndSanitizerAddress: '0xC87c45d2dbE5acb56013e2591427ECC84Fa251E6',
        managerAddress: '0x2ce65016366ef7320078e0758D58Cf1038bc7C4e',
      },
      MAINNET_USDC_PLP_V3_AUTHORIZED_STRATEGIST_LEAF_DEFINITIONS.slice(0, 12),
    )

    expect(wethPrevious.metadata.ManageRoot).toBe(
      '0x14c4c96cc3730452ce71a447bdde6132f81acec862098a9ddd5e086805046a07',
    )
    expect(usdcPrevious.metadata.ManageRoot).toBe(MAINNET_USDC_PLP_PRE_V3_MANAGE_ROOT)
  })

  it('proves only the active v3 dispatch leaf in current artifacts', () => {
    for (const artifact of [MainnetWETHPLPStrategistLeaves, MainnetUSDCPLPStrategistLeaves]) {
      const newDispatch = findLeafForTarget(artifact, DISPATCH, NEW_POOL)

      expect(newDispatch.TargetAddress.toLowerCase()).toBe(NEW_POOL.toLowerCase())
      expect(() => findLeafForTarget(artifact, DISPATCH, OLD_POOL)).toThrow('Leaf not found')

      const [proofs, , targets] = buildManageArgs([{ leaf: newDispatch, data: '0x' }], artifact)
      expect(proofs).toHaveLength(1)
      expect(proofs[0]).toHaveLength(4)
      expect(targets.map((target) => target.toLowerCase())).toEqual([NEW_POOL.toLowerCase()])
    }
  })

  it('preserves the exact v3-authorized roots for rollback and cleanup proofs', () => {
    expect(MainnetWETHPLPV3AuthorizedStrategistLeaves.metadata.ManageRoot).toBe(
      '0x4d2fb008ac93d2a363881e31e65f31bacbefef39efb44cf2f95b65cf49c65c7d',
    )
    expect(MainnetUSDCPLPV3AuthorizedStrategistLeaves.metadata.ManageRoot).toBe(
      '0x3223880461fe3e61dc96d9d81579ae943507ec95f17cba100b462cec53967e14',
    )
  })

  it('retains provable WETH wrap and unwrap permissions after pool retirement', () => {
    const wrap = findLeafForTargetAndSignature(
      MainnetWETHPLPStrategistLeaves,
      WETH,
      'deposit()',
      [],
    )
    const unwrap = findLeafForTargetAndSignature(
      MainnetWETHPLPStrategistLeaves,
      WETH,
      'withdraw(uint256)',
      [],
    )
    const [proofs, , targets] = buildManageArgs(
      [
        { leaf: wrap, data: '0x' },
        { leaf: unwrap, data: '0x' },
      ],
      MainnetWETHPLPStrategistLeaves,
    )

    expect(wrap.CanSendValue).toBe(true)
    expect(unwrap.CanSendValue).toBe(false)
    expect(proofs.every((proof) => proof.length === 4)).toBe(true)
    expect(targets.map((target) => target.toLowerCase())).toEqual([
      WETH.toLowerCase(),
      WETH.toLowerCase(),
    ])
  })

  it('selects the retained v3 ERC-20 approval by address arguments', () => {
    const v3Approval = findLeafForTargetAndSignature(
      MainnetUSDCPLPStrategistLeaves,
      USDC,
      'approve(address,uint256)',
      [NEW_PO_USDC],
    )

    expect(v3Approval.AddressArguments[0]?.toLowerCase()).toBe(NEW_PO_USDC.toLowerCase())
    expect(() =>
      findLeafForTargetAndSignature(
        MainnetUSDCPLPStrategistLeaves,
        USDC,
        'approve(address,uint256)',
        [CURRENT_PO_USDC],
      ),
    ).toThrow('found 0')
  })

  it('rejects missing semantic leaf matches', () => {
    expect(() =>
      findLeafForTargetAndSignature(
        MainnetUSDCPLPStrategistLeaves,
        '0x0000000000000000000000000000000000000001',
        'approve(address,uint256)',
        [CURRENT_PO_USDC],
      ),
    ).toThrow('found 0')
  })

  it('rejects ambiguous semantic leaf matches', () => {
    const v3Approval = findLeafForTargetAndSignature(
      MainnetUSDCPLPStrategistLeaves,
      USDC,
      'approve(address,uint256)',
      [NEW_PO_USDC],
    )
    const duplicateArtifact = {
      ...MainnetUSDCPLPStrategistLeaves,
      leafs: [...MainnetUSDCPLPStrategistLeaves.leafs, v3Approval],
    }

    expect(() =>
      findLeafForTargetAndSignature(duplicateArtifact, USDC, 'approve(address,uint256)', [
        NEW_PO_USDC,
      ]),
    ).toThrow('found 2')
  })

  it('removes every retired pool target and approval argument', () => {
    const retiredAddresses = [OLD_POOL, CURRENT_PO_ETH, CURRENT_PO_USDC, WSPCXX_PO_USDC].map(
      (address) => address.toLowerCase(),
    )
    for (const definitions of STRATEGIST_DEFINITION_SETS) {
      for (const definition of definitions) {
        expect(retiredAddresses).not.toContain(definition.target.toLowerCase())
        for (const argument of definition.addressArguments) {
          expect(retiredAddresses).not.toContain(argument.toLowerCase())
        }
      }
    }
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
      [NEW_POOL, NEW_PO_WETH, NEW_PO_USDC, WETH, USDC].map((address) => address.toLowerCase()),
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
