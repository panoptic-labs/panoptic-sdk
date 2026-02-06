import { type Hex } from 'viem'
import { describe, expect, test } from 'vitest'

import { TestPanopticPLPStrategistLeaves } from '../hypoVaultManagerArtifacts/TestPanopticPLPStrategistLeaves'
import { convertJsonTreeToArray, getProofsFromDigests } from './merkleTreeHelper'

describe('merkleTreeHelper', () => {
  test('getProofsFromDigests matches Solidity output for first 2 leaves', () => {
    // Get the first 2 real leaves (indices 0 and 1)
    const leafs = TestPanopticPLPStrategistLeaves.leafs.slice(0, 2)

    // Extract pre-computed leaf digests from JSON
    const leafDigests = leafs.map((leaf) => leaf.LeafDigest as Hex)

    // console.log('Leaf digests:', leafDigests);

    // Convert JSON tree structure to expected format (leaves → root)
    const tree = convertJsonTreeToArray(TestPanopticPLPStrategistLeaves.MerkleTree)

    // console.log('Tree structure (layers from leaves to root):');
    // tree.forEach((layer, i) => {
    //   console.log(`Layer ${i}:`, layer);
    // });

    // Generate proofs using pre-computed digests
    const proofs = getProofsFromDigests(leafDigests, tree)

    // console.log('Generated proofs:');
    // proofs.forEach((proof, i) => {
    //   console.log(`Proof ${i}:`, proof);
    // });

    // Expected proofs from Solidity logs
    const expectedProof0: Hex[] = [
      '0xbcc405d8b504c68cf5c5b0b5eb4a6553f01ae2ea46fb197ad87760300cf9d6cc',
      '0x667e70365c05c02a8231e0166be22a85b6b4bff6e38f082525ea1f1896072296',
      '0x2d15e80ce426ffcfaf56def27bdb0e7b3660051b65a512f29b8b470fbe6b039b',
    ]

    const expectedProof1: Hex[] = [
      '0x65a91a455fdafef7c4f1603d808bbb98a134d21f457910eb58d4232637d13355',
      '0x667e70365c05c02a8231e0166be22a85b6b4bff6e38f082525ea1f1896072296',
      '0x2d15e80ce426ffcfaf56def27bdb0e7b3660051b65a512f29b8b470fbe6b039b',
    ]

    // Verify proof for leaf 0
    expect(proofs[0]).toHaveLength(3)
    expect(proofs[0][0]).toBe(expectedProof0[0])
    expect(proofs[0][1]).toBe(expectedProof0[1])
    expect(proofs[0][2]).toBe(expectedProof0[2])

    // Verify proof for leaf 1
    expect(proofs[1]).toHaveLength(3)
    expect(proofs[1][0]).toBe(expectedProof1[0])
    expect(proofs[1][1]).toBe(expectedProof1[1])
    expect(proofs[1][2]).toBe(expectedProof1[2])
  })

  test('tree conversion from JSON format', () => {
    const tree = convertJsonTreeToArray(TestPanopticPLPStrategistLeaves.MerkleTree)

    // Tree should have 4 layers
    expect(tree).toHaveLength(4)

    // Layer 0 should be leaves (8 elements)
    expect(tree[0]).toHaveLength(8)

    // Layer 1 should have 4 elements
    expect(tree[1]).toHaveLength(4)

    // Layer 2 should have 2 elements
    expect(tree[2]).toHaveLength(2)

    // Layer 3 should be root (1 element)
    expect(tree[3]).toHaveLength(1)
    expect(tree[3][0]).toBe(TestPanopticPLPStrategistLeaves.metadata.ManageRoot)
  })
})
