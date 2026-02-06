import type { Address, Hex } from 'viem'

import { convertJsonTreeToArray, getProofsFromDigests } from './merkleTreeHelper'

/**
 * Represents a strategist leaf from the pre-generated artifacts.
 * This type matches the structure of leaves in ProductionWETHPLPStrategistLeaves,
 * ProductionUSDCPLPStrategistLeaves, etc.
 */
export type StrategistLeaf = {
  readonly LeafDigest: string
  readonly DecoderAndSanitizerAddress: string
  readonly TargetAddress: string
  readonly Description: string
  readonly FunctionSignature: string
  readonly FunctionSelector: string
  readonly AddressArguments: readonly string[]
  readonly CanSendValue: boolean
  readonly PackedArgumentAddresses: string
}

/**
 * Represents the structure of a strategist leaves artifact (e.g., ProductionWETHPLPStrategistLeaves).
 * Generic over the leaf type to preserve literal types for autocomplete.
 */
export type StrategistLeavesArtifact<TLeaf extends StrategistLeaf = StrategistLeaf> = {
  readonly metadata: {
    readonly AccountantAddress: string
    readonly BoringVaultAddress: string
    readonly DecoderAndSanitizerAddress: string
    readonly DigestComposition: readonly string[]
    readonly LeafCount: number
    readonly ManageRoot: string
    readonly ManagerAddress: string
    readonly TreeCapacity: number
  }
  readonly leafs: readonly TLeaf[]
  readonly MerkleTree: Record<string, readonly Hex[]>
}

/**
 * Extracts the leaf type from a strategist leaves artifact.
 * Useful for typing variables that hold leaves from a specific artifact.
 *
 * @example
 * type WETHLeaf = InferLeaf<typeof ProductionWETHPLPStrategistLeaves>
 */
export type InferLeaf<T extends StrategistLeavesArtifact> = T['leafs'][number]

/**
 * Extracts the valid description strings from a strategist leaves artifact.
 * Used internally for autocomplete in findLeaf.
 */
export type LeafDescription<T extends StrategistLeavesArtifact> = T['leafs'][number]['Description']

/**
 * Finds a leaf by its description with full type safety and autocomplete.
 * Throws if the leaf is not found.
 *
 * @param artifact - The strategist leaves artifact (e.g., ProductionWETHPLPStrategistLeaves)
 * @param description - The description of the leaf to find (autocomplete enabled)
 * @returns The matching leaf
 * @throws Error if no leaf matches the description
 *
 * @example
 * ```ts
 * // Autocomplete shows all valid descriptions for this artifact
 * const approveLeaf = findLeaf(ProductionWETHPLPStrategistLeaves, 'Approve poWETH to spend WETH')
 * const depositLeaf = findLeaf(ProductionUSDCPLPStrategistLeaves, 'Deposit USDC for poUSDC')
 * ```
 */
export function findLeaf<T extends StrategistLeavesArtifact>(
  artifact: T,
  description: LeafDescription<T>,
): Extract<T['leafs'][number], { Description: typeof description }> {
  const leaf = artifact.leafs.find((l) => l.Description === description)
  if (!leaf) {
    throw new Error(`Leaf not found: "${description}"`)
  }
  return leaf as Extract<T['leafs'][number], { Description: typeof description }>
}

/**
 * Represents a single action to execute via manageVaultWithMerkleVerification.
 * Pairs a strategist leaf with the encoded call data for that action.
 */
export type ManageAction = {
  /** The strategist leaf authorizing this action */
  leaf: StrategistLeaf
  /** The encoded function call data (use viem's encodeFunctionData) */
  data: Hex
  /** Native value to send with the call (defaults to 0n) */
  value?: bigint
}

/**
 * The tuple of arguments for manageVaultWithMerkleVerification
 */
export type ManageVaultArgs = [
  proofs: Hex[][],
  decodersAndSanitizers: Address[],
  targets: Address[],
  targetData: Hex[],
  values: bigint[],
]

/**
 * Transforms an array of ManageActions into the argument tuple required by
 * manageVaultWithMerkleVerification.
 *
 * @param actions - Array of manage actions to execute
 * @param artifact - The strategist leaves artifact (e.g., ProductionWETHPLPStrategistLeaves)
 * @returns Tuple of [proofs, decodersAndSanitizers, targets, targetData, values]
 *
 * @example
 * ```ts
 * const actions: ManageAction[] = [
 *   {
 *     leaf: findLeaf(ProductionWETHPLPStrategistLeaves, 'Approve poWETH to spend WETH'),
 *     data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, amount] }),
 *   },
 *   {
 *     leaf: findLeaf(ProductionWETHPLPStrategistLeaves, 'Deposit WETH for poWETH'),
 *     data: encodeFunctionData({ abi: CollateralTrackerAbi, functionName: 'deposit', args: [assets, receiver] }),
 *   },
 * ]
 *
 * const [proofs, decodersAndSanitizers, targets, targetData, values] = buildManageArgs(
 *   actions,
 *   ProductionWETHPLPStrategistLeaves
 * )
 * ```
 */
export function buildManageArgs(
  actions: ManageAction[],
  artifact: StrategistLeavesArtifact,
): ManageVaultArgs {
  const leafDigests = actions.map((a) => a.leaf.LeafDigest as Hex)
  const tree = convertJsonTreeToArray(artifact.MerkleTree)

  const proofs = getProofsFromDigests(leafDigests, tree)
  const decodersAndSanitizers = actions.map((a) => a.leaf.DecoderAndSanitizerAddress as Address)
  const targets = actions.map((a) => a.leaf.TargetAddress as Address)
  const targetData = actions.map((a) => a.data)
  const values = actions.map((a) => a.value ?? 0n)

  return [proofs, decodersAndSanitizers, targets, targetData, values]
}
