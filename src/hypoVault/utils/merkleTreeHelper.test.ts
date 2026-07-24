import { type Address, type Hex, encodePacked, keccak256 } from 'viem'
import { describe, expect, test } from 'vitest'

import { BaseUSDCPLPStrategistLeaves } from '../hypoVaultManagerArtifacts/BaseUSDCPLPStrategistLeaves'
import { BaseWETHPLPStrategistLeaves } from '../hypoVaultManagerArtifacts/BaseWETHPLPStrategistLeaves'
import { MainnetLegacyUSDCPLPStrategistLeaves } from '../hypoVaultManagerArtifacts/MainnetLegacyUSDCPLPStrategistLeaves'
import { MainnetLegacyWETHPLPStrategistLeaves } from '../hypoVaultManagerArtifacts/MainnetLegacyWETHPLPStrategistLeaves'
import { MainnetUSDCPLPStrategistLeaves } from '../hypoVaultManagerArtifacts/MainnetUSDCPLPStrategistLeaves'
import { MainnetWETHPLPStrategistLeaves } from '../hypoVaultManagerArtifacts/MainnetWETHPLPStrategistLeaves'
import { SepoliaUSDCPLPStrategistLeaves } from '../hypoVaultManagerArtifacts/SepoliaUSDCPLPStrategistLeaves'
import { SepoliaWETHPLPStrategistLeaves } from '../hypoVaultManagerArtifacts/SepoliaWETHPLPStrategistLeaves'
import { TestPanopticPLPStrategistLeaves } from '../hypoVaultManagerArtifacts/TestPanopticPLPStrategistLeaves'
import {
  type ManageLeaf,
  convertJsonTreeToArray,
  getProofsFromDigests,
  getProofsUsingTree,
} from './merkleTreeHelper'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

type StrategistLeaf = {
  AddressArguments: readonly Address[]
  CanSendValue: boolean
  DecoderAndSanitizerAddress: Address
  FunctionSelector: Hex
  FunctionSignature: string
  LeafDigest: Hex
  PackedArgumentAddresses: Hex
  TargetAddress: Address
}

type StrategistLeavesArtifact = {
  metadata: {
    DecoderAndSanitizerAddress: Address
    LeafCount: number
    ManageRoot: Hex
    TreeCapacity: number
  }
  leafs: readonly StrategistLeaf[]
  MerkleTree: Record<string, readonly Hex[]>
}

const STRATEGIST_LEAF_ARTIFACTS: Array<[string, StrategistLeavesArtifact]> = [
  ['test', TestPanopticPLPStrategistLeaves],
  ['base USDC PLP', BaseUSDCPLPStrategistLeaves],
  ['base WETH PLP', BaseWETHPLPStrategistLeaves],
  ['sepolia USDC PLP', SepoliaUSDCPLPStrategistLeaves],
  ['sepolia WETH PLP', SepoliaWETHPLPStrategistLeaves],
  ['mainnet USDC PLP', MainnetUSDCPLPStrategistLeaves],
  ['mainnet WETH PLP', MainnetWETHPLPStrategistLeaves],
  ['mainnet legacy USDC PLP', MainnetLegacyUSDCPLPStrategistLeaves],
  ['mainnet legacy WETH PLP', MainnetLegacyWETHPLPStrategistLeaves],
]

function hashPair(a: Hex, b: Hex): Hex {
  return a < b
    ? keccak256(encodePacked(['bytes32', 'bytes32'], [a, b]))
    : keccak256(encodePacked(['bytes32', 'bytes32'], [b, a]))
}

function functionSelector(signature: string): Hex {
  return keccak256(encodePacked(['string'], [signature])).slice(0, 10) as Hex
}

function packedAddressArguments(addresses: readonly Address[]): Hex {
  let packed = '0x' as Hex
  for (const address of addresses) {
    packed = encodePacked(['bytes', 'address'], [packed, address])
  }
  return packed
}

function leafDigest(leaf: StrategistLeaf): Hex {
  let rawDigest = encodePacked(
    ['address', 'address', 'bool', 'bytes4'],
    [
      leaf.DecoderAndSanitizerAddress,
      leaf.TargetAddress,
      leaf.CanSendValue,
      functionSelector(leaf.FunctionSignature),
    ],
  )

  for (const address of leaf.AddressArguments) {
    rawDigest = encodePacked(['bytes', 'address'], [rawDigest, address])
  }

  return keccak256(rawDigest)
}

function verifyProof(leaf: Hex, proof: readonly Hex[], root: Hex): boolean {
  const computedRoot = proof.reduce(
    (current, proofElement) => hashPair(current, proofElement),
    leaf,
  )
  return computedRoot === root
}

function toManageLeaf(leaf: StrategistLeaf): ManageLeaf {
  return {
    target: leaf.TargetAddress,
    canSendValue: leaf.CanSendValue,
    signature: leaf.FunctionSignature,
    argumentAddresses: [...leaf.AddressArguments],
    description: '',
    decoderAndSanitizer: leaf.DecoderAndSanitizerAddress,
  }
}

describe('merkleTreeHelper', () => {
  test.each(STRATEGIST_LEAF_ARTIFACTS)(
    '%s fixture leaf digests match Solidity output',
    (_name: string, artifact: StrategistLeavesArtifact) => {
      expect(artifact.leafs).toHaveLength(artifact.metadata.TreeCapacity)

      const usedLeafCount = artifact.leafs.filter(
        (leaf) => leaf.TargetAddress !== ZERO_ADDRESS,
      ).length
      expect(usedLeafCount).toBe(artifact.metadata.LeafCount)

      for (const leaf of artifact.leafs) {
        expect(functionSelector(leaf.FunctionSignature)).toBe(leaf.FunctionSelector)
        expect(packedAddressArguments(leaf.AddressArguments)).toBe(leaf.PackedArgumentAddresses)
        expect(leafDigest(leaf)).toBe(leaf.LeafDigest)
      }
    },
  )

  test.each(STRATEGIST_LEAF_ARTIFACTS)(
    '%s fixture tree conversion preserves Solidity layers',
    (_name: string, artifact: StrategistLeavesArtifact) => {
      const tree = convertJsonTreeToArray(artifact.MerkleTree)
      const jsonLayerCount = Object.keys(artifact.MerkleTree).length

      expect(tree).toHaveLength(jsonLayerCount)
      expect(tree[0]).toEqual(artifact.MerkleTree[(jsonLayerCount - 1).toString()])
      expect(tree[tree.length - 1]).toEqual([artifact.metadata.ManageRoot])

      for (let i = 0; i < tree.length; i += 1) {
        expect(tree[i]).toEqual(artifact.MerkleTree[(jsonLayerCount - 1 - i).toString()])
      }
    },
  )

  test.each(STRATEGIST_LEAF_ARTIFACTS)(
    '%s proofs rebuild the Solidity-generated manage root',
    (_name: string, artifact: StrategistLeavesArtifact) => {
      const tree = convertJsonTreeToArray(artifact.MerkleTree)
      const leafDigests = artifact.leafs.map((leaf) => leaf.LeafDigest)
      const proofs = getProofsFromDigests(leafDigests, tree)

      expect(proofs).toHaveLength(artifact.leafs.length)
      for (let i = 0; i < leafDigests.length; i += 1) {
        expect(verifyProof(leafDigests[i], proofs[i], artifact.metadata.ManageRoot)).toBe(true)
      }
    },
  )

  test.each(STRATEGIST_LEAF_ARTIFACTS)(
    '%s getProofsUsingTree matches precomputed digest proofs for used leaves',
    (_name: string, artifact: StrategistLeavesArtifact) => {
      const tree = convertJsonTreeToArray(artifact.MerkleTree)
      const usedLeafs = artifact.leafs.filter((leaf) => leaf.TargetAddress !== ZERO_ADDRESS)
      const manageLeafs = usedLeafs.map(toManageLeaf)
      const leafDigests = usedLeafs.map((leaf) => leaf.LeafDigest)

      expect(
        getProofsUsingTree(manageLeafs, tree, artifact.metadata.DecoderAndSanitizerAddress),
      ).toEqual(getProofsFromDigests(leafDigests, tree))
    },
  )

  test.each(STRATEGIST_LEAF_ARTIFACTS)(
    '%s rejects proofs for leaves outside the Solidity-generated tree',
    (_name: string, artifact: StrategistLeavesArtifact) => {
      const tree = convertJsonTreeToArray(artifact.MerkleTree)
      const outsideLeaf = keccak256(
        encodePacked(['string'], [`outside-${artifact.metadata.ManageRoot}`]),
      )

      expect(() => getProofsFromDigests([outsideLeaf], tree)).toThrow('Leaf not found in tree')
    },
  )

  test('getProofsFromDigests preserves known Solidity proof output for the test fixture', () => {
    const leafDigests = TestPanopticPLPStrategistLeaves.leafs
      .slice(0, 2)
      .map((leaf) => leaf.LeafDigest as Hex)
    const tree = convertJsonTreeToArray(TestPanopticPLPStrategistLeaves.MerkleTree)

    expect(getProofsFromDigests(leafDigests, tree)).toEqual([
      [
        '0xbcc405d8b504c68cf5c5b0b5eb4a6553f01ae2ea46fb197ad87760300cf9d6cc',
        '0x667e70365c05c02a8231e0166be22a85b6b4bff6e38f082525ea1f1896072296',
        '0x2d15e80ce426ffcfaf56def27bdb0e7b3660051b65a512f29b8b470fbe6b039b',
      ],
      [
        '0x65a91a455fdafef7c4f1603d808bbb98a134d21f457910eb58d4232637d13355',
        '0x667e70365c05c02a8231e0166be22a85b6b4bff6e38f082525ea1f1896072296',
        '0x2d15e80ce426ffcfaf56def27bdb0e7b3660051b65a512f29b8b470fbe6b039b',
      ],
    ])
  })

  test('tree conversion from JSON format preserves the test fixture root', () => {
    const tree = convertJsonTreeToArray(TestPanopticPLPStrategistLeaves.MerkleTree)

    expect(tree).toHaveLength(4)
    expect(tree[0]).toHaveLength(8)
    expect(tree[1]).toHaveLength(4)
    expect(tree[2]).toHaveLength(2)
    expect(tree[3]).toHaveLength(1)
    expect(tree[3][0]).toBe(TestPanopticPLPStrategistLeaves.metadata.ManageRoot)
  })
})
