/**
 * Zodiac Roles Modifier v2 enum ordinals.
 *
 * Verified against gnosisguild/zodiac-modifier-roles `contracts/Types.sol`
 * (commit c343958ab7317b31d8c4aec790606d950ea21eed) and the deployed v2.1
 * mastercopy 0x9646fDAD06d3e24444381f44362a3B0eB343D337. Keep in sync with the
 * modifier version the Safe actually runs.
 */

export const ParameterType = {
  None: 0,
  Static: 1,
  Dynamic: 2,
  Tuple: 3,
  Array: 4,
  Calldata: 5,
  AbiEncoded: 6,
} as const

export const Operator = {
  Pass: 0,
  And: 1,
  Or: 2,
  Nor: 3,
  Matches: 5,
  ArraySome: 6,
  ArrayEvery: 7,
  ArraySubset: 8,
  EqualToAvatar: 15,
  EqualTo: 16,
  GreaterThan: 17,
  LessThan: 18,
  SignedIntGreaterThan: 19,
  SignedIntLessThan: 20,
  Bitmask: 21,
  Custom: 22,
  WithinAllowance: 28,
  EtherWithinAllowance: 29,
  CallWithinAllowance: 30,
} as const

/**
 * Canonical adapter addresses — deterministic CREATE2 (factory
 * 0x4e59b44847b379578588920cA78FbF26c0B4956C, salt
 * keccak256("panoptic.zodiac-modules.v1")), so they depend only on the
 * bytecode: same on every chain, deployer-independent, verifiable with
 * `cast code` against a local `forge build`. The adapters are stateless and
 * immutable (no owner/storage/upgradability). Recompute via
 * `forge script scripts/DeployAdapters.s.sol` after any source change.
 */
export const CANONICAL_ADAPTERS = {
  RollerCondition: '0x7b2402F7Ff7fFe0970D383dE1C6AF8892B87523a',
  SizeAdjusterCondition: '0x72494B2A0C5a69Dd0154386c2F4Af0b38a24C400',
} as const

export const ExecutionOptions = {
  None: 0,
  Send: 1,
  DelegateCall: 2,
  Both: 3,
} as const
