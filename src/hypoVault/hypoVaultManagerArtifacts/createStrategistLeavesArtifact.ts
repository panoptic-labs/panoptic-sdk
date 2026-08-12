import {
  type Address,
  type Hex,
  concat,
  encodePacked,
  getAddress,
  keccak256,
  toBytes,
  zeroAddress,
} from 'viem'

import type { StrategistLeaf, StrategistLeavesArtifact } from '../utils/buildManageArgs'

export type StrategistLeafDefinition = {
  readonly description: string
  readonly target: Address
  readonly functionSignature: string
  readonly addressArguments: readonly Address[]
  readonly canSendValue: boolean
}

type StrategistArtifactMetadata = {
  readonly accountantAddress: Address
  readonly boringVaultAddress: Address
  readonly decoderAndSanitizerAddress: Address
  readonly managerAddress: Address
}

type GeneratedStrategistLeaf<TDefinition extends StrategistLeafDefinition> = StrategistLeaf & {
  readonly Description: TDefinition['description']
  readonly TargetAddress: TDefinition['target']
  readonly FunctionSignature: TDefinition['functionSignature']
  readonly AddressArguments: TDefinition['addressArguments']
  readonly CanSendValue: TDefinition['canSendValue']
}

type EmptyStrategistLeaf = StrategistLeaf & {
  readonly Description: ''
}

type GeneratedStrategistArtifact<TDefinitions extends readonly StrategistLeafDefinition[]> =
  StrategistLeavesArtifact<GeneratedStrategistLeaf<TDefinitions[number]> | EmptyStrategistLeaf>

const DIGEST_COMPOSITION = [
  'Bytes20(DECODER_AND_SANITIZER_ADDRESS)',
  'Bytes20(TARGET_ADDRESS)',
  'Bytes1(CAN_SEND_VALUE)',
  'Bytes4(TARGET_FUNCTION_SELECTOR)',
  'Bytes{N*20}(ADDRESS_ARGUMENT_0,...,ADDRESS_ARGUMENT_N)',
] as const

const EMPTY_DEFINITION = {
  description: '',
  target: zeroAddress,
  functionSignature: '',
  addressArguments: [],
  canSendValue: false,
} as const

function efficientHash(a: Hex, b: Hex): Hex {
  return keccak256(encodePacked(['bytes32', 'bytes32'], a < b ? [a, b] : [b, a]))
}

function nextPowerOfTwo(value: number): number {
  let capacity = 1
  while (capacity < value) {
    capacity *= 2
  }
  return capacity
}

function functionSelector(signature: string): Hex {
  return keccak256(toBytes(signature)).slice(0, 10) as Hex
}

function buildLeaf<const TDefinition extends StrategistLeafDefinition>(
  definition: TDefinition,
  decoderAndSanitizerAddress: Address,
): GeneratedStrategistLeaf<TDefinition> {
  const selector = functionSelector(definition.functionSignature)
  const packedArgumentAddresses =
    definition.addressArguments.length === 0
      ? '0x'
      : concat(definition.addressArguments.map((address) => getAddress(address)))
  const rawDigest = concat([
    encodePacked(
      ['address', 'address', 'bool', 'bytes4'],
      [
        getAddress(decoderAndSanitizerAddress),
        getAddress(definition.target),
        definition.canSendValue,
        selector,
      ],
    ),
    packedArgumentAddresses,
  ])

  return {
    AddressArguments: definition.addressArguments,
    CanSendValue: definition.canSendValue,
    DecoderAndSanitizerAddress: getAddress(decoderAndSanitizerAddress),
    Description: definition.description,
    FunctionSelector: selector,
    FunctionSignature: definition.functionSignature,
    LeafDigest: keccak256(rawDigest),
    PackedArgumentAddresses: packedArgumentAddresses,
    TargetAddress: getAddress(definition.target),
  }
}

function buildMerkleTree(leafDigests: readonly Hex[]): Record<string, readonly Hex[]> {
  if (leafDigests.length === 0) {
    throw new Error('Strategist Merkle tree requires at least one leaf digest')
  }

  const layersFromLeaves: Hex[][] = [[...leafDigests]]

  while (layersFromLeaves[layersFromLeaves.length - 1]?.length !== 1) {
    const currentLayer = layersFromLeaves[layersFromLeaves.length - 1]
    if (currentLayer === undefined || currentLayer.length === 0) {
      throw new Error('Strategist Merkle tree produced an empty layer')
    }
    if (currentLayer.length % 2 !== 0) {
      throw new Error('Strategist Merkle tree layers must contain an even number of nodes')
    }

    const parentLayer: Hex[] = []
    for (let index = 0; index < currentLayer.length; index += 2) {
      const left = currentLayer[index]
      const right = currentLayer[index + 1]
      if (left === undefined || right === undefined) {
        throw new Error('Strategist Merkle tree contains an incomplete pair')
      }
      parentLayer.push(efficientHash(left, right))
    }
    layersFromLeaves.push(parentLayer)
  }

  return Object.fromEntries(
    [...layersFromLeaves].reverse().map((layer, index) => [String(index), layer] as const),
  )
}

export function createStrategistLeavesArtifact<
  const TDefinitions extends readonly StrategistLeafDefinition[],
>(
  metadata: StrategistArtifactMetadata,
  definitions: TDefinitions,
): GeneratedStrategistArtifact<TDefinitions> {
  if (definitions.length === 0) {
    throw new Error('Strategist artifact requires at least one permission leaf')
  }

  const treeCapacity = nextPowerOfTwo(definitions.length)
  const leafs: (GeneratedStrategistLeaf<TDefinitions[number]> | EmptyStrategistLeaf)[] =
    definitions.map((definition) => buildLeaf(definition, metadata.decoderAndSanitizerAddress))
  const emptyLeaf = buildLeaf(EMPTY_DEFINITION, zeroAddress)

  while (leafs.length < treeCapacity) {
    leafs.push(emptyLeaf)
  }

  const merkleTree = buildMerkleTree(leafs.map((leaf) => leaf.LeafDigest as Hex))
  const root = merkleTree['0']?.[0]
  if (root === undefined) {
    throw new Error('Strategist Merkle tree root was not generated')
  }

  return {
    metadata: {
      AccountantAddress: getAddress(metadata.accountantAddress),
      BoringVaultAddress: getAddress(metadata.boringVaultAddress),
      DecoderAndSanitizerAddress: getAddress(metadata.decoderAndSanitizerAddress),
      DigestComposition: DIGEST_COMPOSITION,
      LeafCount: definitions.length,
      ManageRoot: root,
      ManagerAddress: getAddress(metadata.managerAddress),
      TreeCapacity: treeCapacity,
    },
    leafs,
    MerkleTree: merkleTree,
  }
}
