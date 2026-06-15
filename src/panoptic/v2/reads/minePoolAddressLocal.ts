/**
 * Client-side (off-chain) implementation of minePoolAddress.
 *
 * Replicates the on-chain PanopticFactory mining loop entirely in TypeScript,
 * eliminating RPC round-trips. The result is identical to the on-chain computation.
 *
 * Algorithm:
 *   For each candidate salt (uint96):
 *     1. Pack a bytes32 salt from deployer, pool identifier, riskEngine, and iteration salt
 *     2. Predict the CREATE3 deployed address (via proxy)
 *     3. Score by leading hex zeros ("rarity")
 *     4. Track the best salt; stop early if minTargetRarity is reached
 *
 * @module v2/reads/minePoolAddressLocal
 */

import type { Address, Hex } from 'viem'
import { encodeAbiParameters, keccak256 } from 'viem'

import { PanopticValidationError } from '../errors'
import type { PoolKey } from '../types'
import type {
  MinePoolAddressResult,
  MinePoolAddressV3Params,
  MinePoolAddressV4Params,
} from './factory'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Mining params for PanopticFactoryV3 — no RPC client needed. */
export type MinePoolAddressLocalV3Params = Omit<MinePoolAddressV3Params, 'client'>

/** Mining params for PanopticFactoryV4 — no RPC client needed. */
export type MinePoolAddressLocalV4Params = Omit<MinePoolAddressV4Params, 'client'>

export type MinePoolAddressLocalParams =
  | ({ version: 'v3' } & MinePoolAddressLocalV3Params)
  | ({ version: 'v4' } & MinePoolAddressLocalV4Params)

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * keccak256 of the CREATE3 proxy initcode used by ClonesWithImmutableArgs.
 * Source: packages/panoptic-v2-core/lib/clones-with-immutable-args/src/ClonesWithImmutableArgs.sol
 */
const CREATE3_PROXY_BYTECODE_HASH =
  '0x21c35dbe1b344a2488cf3321d6ce542f8e9f305544ff09e4993a62319a497c1f' as Hex

const MASK_80 = (1n << 80n) - 1n
const MASK_40 = (1n << 40n) - 1n
const MASK_96 = (1n << 96n) - 1n

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** Encode a BigInt as a big-endian fixed-length byte array. */
function bigintToBytes(value: bigint, byteLength: number): Uint8Array {
  const bytes = new Uint8Array(byteLength)
  let v = value
  for (let i = byteLength - 1; i >= 0; i--) {
    bytes[i] = Number(v & 0xffn)
    v >>= 8n
  }
  return bytes
}

/** Parse a 0x-prefixed address into 20 bytes. */
function addressToBytes(addr: Address): Uint8Array {
  const hex = addr.slice(2).padStart(40, '0')
  const bytes = new Uint8Array(20)
  for (let i = 0; i < 20; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/** Parse a 0x-prefixed 32-byte hex string into bytes. */
function hex32ToBytes(hex: Hex): Uint8Array {
  const h = hex.slice(2).padStart(64, '0')
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/**
 * Compute the CREATE3 deployed address for a given factory and packed salt.
 *
 * Mirrors `ClonesWithImmutableArgs.addressOfClone3(salt)` (with `address(this)` = factory):
 *   proxy    = CREATE2(factory, salt, PROXY_BYTECODE_HASH)
 *   deployed = CREATE1(proxy, nonce=1)
 *
 * Returns the deployed address as a uint160 BigInt.
 */
function addressOfClone3(factory: Address, salt: bigint): bigint {
  const saltBytes = bigintToBytes(salt, 32)

  // CREATE2: keccak256(0xff ++ factory ++ salt ++ proxyBytecodeHash) — 85 bytes total
  const create2Input = new Uint8Array(85)
  create2Input[0] = 0xff
  create2Input.set(addressToBytes(factory), 1) // bytes 1–20
  create2Input.set(saltBytes, 21) // bytes 21–52
  create2Input.set(hex32ToBytes(CREATE3_PROXY_BYTECODE_HASH), 53) // bytes 53–84

  const proxyHash = keccak256(create2Input, 'bytes')
  const proxyAddress = proxyHash.slice(12) // rightmost 20 bytes

  // CREATE1 nonce=1: keccak256(0xd694 ++ proxy ++ 0x01) — 23 bytes total
  const create1Input = new Uint8Array(23)
  create1Input[0] = 0xd6
  create1Input[1] = 0x94
  create1Input.set(proxyAddress, 2) // bytes 2–21
  create1Input[22] = 0x01

  const deployedHash = keccak256(create1Input, 'bytes')

  // Convert rightmost 20 bytes to uint160 BigInt
  let addr = 0n
  for (let i = 12; i < 32; i++) {
    addr = (addr << 8n) | BigInt(deployedHash[i])
  }
  return addr
}

/**
 * Count leading hex-zero characters in a 160-bit address value.
 *
 * Mirrors `PanopticMath.numberOfLeadingHexZeros(addr)`.
 * Returns 40 for the zero address.
 */
export function numberOfLeadingHexZeros(addrInt: bigint): number {
  if (addrInt === 0n) return 40
  let x = addrInt
  let r = 0
  if (x >= 0x100000000000000000000000000000000n) {
    x >>= 128n
    r += 32
  }
  if (x >= 0x10000000000000000n) {
    x >>= 64n
    r += 16
  }
  if (x >= 0x100000000n) {
    x >>= 32n
    r += 8
  }
  if (x >= 0x10000n) {
    x >>= 16n
    r += 4
  }
  if (x >= 0x100n) {
    x >>= 8n
    r += 2
  }
  if (x >= 0x10n) {
    r += 1
  }
  return 39 - r
}

/**
 * Construct the bytes32 CREATE3 salt for PanopticFactoryV3.
 *
 * Mirrors:
 *   bytes32(abi.encodePacked(
 *     uint80(uint160(deployerAddress) >> 80),  // bits [159:80]  of deployer  → 10 bytes
 *     uint40(uint160(v3Pool) >> 120),           // bits [159:120] of v3Pool    →  5 bytes
 *     uint40(uint160(riskEngine) >> 120),       // bits [159:120] of riskEngine→  5 bytes
 *     salt                                      // uint96                      → 12 bytes
 *   ))
 */
function computeSaltPrefixV3(
  deployerAddress: Address,
  v3Pool: Address,
  riskEngine: Address,
): bigint {
  const deployer80 = (BigInt(deployerAddress) >> 80n) & MASK_80
  const pool40 = (BigInt(v3Pool) >> 120n) & MASK_40
  const risk40 = (BigInt(riskEngine) >> 120n) & MASK_40
  return (deployer80 << 176n) | (pool40 << 136n) | (risk40 << 96n)
}

/**
 * Compute the Uniswap V4 PoolId for a PoolKey.
 *
 * Mirrors `PoolId.toId(key)` = keccak256 of the ABI-encoded PoolKey struct
 * (5 fields × 32 bytes = 160 bytes).
 */
export function computePoolIdV4(poolKey: PoolKey): bigint {
  const fee = Number(poolKey.fee)
  if (!Number.isInteger(fee) || fee < 0 || fee >= 2 ** 24) {
    throw new PanopticValidationError(`fee out of uint24 range: ${fee}`)
  }
  const tickSpacing = Number(poolKey.tickSpacing)
  if (!Number.isInteger(tickSpacing) || tickSpacing < -(2 ** 23) || tickSpacing > 2 ** 23 - 1) {
    throw new PanopticValidationError(`tickSpacing out of int24 range: ${tickSpacing}`)
  }
  const encoded = encodeAbiParameters(
    [
      { type: 'address' },
      { type: 'address' },
      { type: 'uint24' },
      { type: 'int24' },
      { type: 'address' },
    ],
    [
      poolKey.currency0,
      poolKey.currency1,
      Number(poolKey.fee),
      Number(poolKey.tickSpacing),
      poolKey.hooks,
    ],
  )
  return BigInt(keccak256(encoded))
}

/**
 * Construct the bytes32 CREATE3 salt for PanopticFactoryV4.
 *
 * Mirrors:
 *   bytes32(abi.encodePacked(
 *     uint80(uint160(deployerAddress) >> 80),
 *     uint40(uint256(PoolId.unwrap(key.toId())) >> 120),  // bits [159:120] of poolId
 *     uint40(uint160(riskEngine) >> 120),
 *     salt
 *   ))
 */
function computeSaltPrefixV4(
  deployerAddress: Address,
  poolKey: PoolKey,
  riskEngine: Address,
): bigint {
  const deployer80 = (BigInt(deployerAddress) >> 80n) & MASK_80
  const poolId40 = (computePoolIdV4(poolKey) >> 120n) & MASK_40
  const risk40 = (BigInt(riskEngine) >> 120n) & MASK_40
  return (deployer80 << 176n) | (poolId40 << 136n) | (risk40 << 96n)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mine for an optimal Panoptic pool address salt, running entirely off-chain.
 *
 * Equivalent to calling `minePoolAddress` on the factory contract but with zero
 * RPC round-trips. The result is identical to the on-chain computation.
 *
 * Iterates `loops` times starting from `salt`, tracking the highest-rarity address
 * found. Stops early when `minTargetRarity` is reached.
 *
 * @param params - Mining parameters (versioned: 'v3' or 'v4'). No `client` required.
 * @returns The best salt found and its rarity (number of leading hex zeros).
 */
export function minePoolAddressLocal(params: MinePoolAddressLocalParams): MinePoolAddressResult {
  const { factoryAddress, deployerAddress, riskEngine, salt, loops, minTargetRarity } = params

  if (salt < 0n || loops < 0n || minTargetRarity < 0n) {
    throw new PanopticValidationError('salt, loops, and minTargetRarity must be non-negative')
  }
  if (salt + loops > (1n << 96n) - 1n) {
    throw new PanopticValidationError('salt + loops exceeds uint96 range')
  }

  let bestSalt = salt
  let highestRarity = 0n
  const maxSalt = salt + loops

  // Precompute the invariant high-bit prefix once outside the loop
  const saltPrefix =
    params.version === 'v3'
      ? computeSaltPrefixV3(deployerAddress, params.v3Pool, riskEngine)
      : computeSaltPrefixV4(deployerAddress, params.poolKey, riskEngine)

  for (let currentSalt = salt; currentSalt < maxSalt; currentSalt++) {
    const newSalt = saltPrefix | (currentSalt & MASK_96)

    const addrInt = addressOfClone3(factoryAddress, newSalt)
    const rarity = BigInt(numberOfLeadingHexZeros(addrInt))

    if (rarity > highestRarity) {
      highestRarity = rarity
      bestSalt = currentSalt
    }

    if (rarity >= minTargetRarity) {
      highestRarity = rarity
      bestSalt = currentSalt
      break
    }
  }

  return { bestSalt, highestRarity }
}

// ---------------------------------------------------------------------------
// Async variant (yields to the event loop between chunks)
// ---------------------------------------------------------------------------

/** Number of iterations per chunk before yielding back to the event loop. */
const CHUNK_SIZE = 5000n

/**
 * Async version of {@link minePoolAddressLocal} that yields to the event loop
 * between chunks of iterations, preventing the browser UI from freezing.
 *
 * @param params - Mining parameters (versioned: 'v3' or 'v4'). No `client` required.
 * @returns The best salt found and its rarity (number of leading hex zeros).
 */
export async function minePoolAddressLocalAsync(
  params: MinePoolAddressLocalParams,
): Promise<MinePoolAddressResult> {
  const { factoryAddress, deployerAddress, riskEngine, salt, loops, minTargetRarity } = params

  let bestSalt = salt
  let highestRarity = 0n
  const maxSalt = salt + loops

  const saltPrefix =
    params.version === 'v3'
      ? computeSaltPrefixV3(deployerAddress, params.v3Pool, riskEngine)
      : computeSaltPrefixV4(deployerAddress, params.poolKey, riskEngine)

  let currentSalt = salt
  while (currentSalt < maxSalt) {
    const chunkEnd = currentSalt + CHUNK_SIZE < maxSalt ? currentSalt + CHUNK_SIZE : maxSalt
    let done = false

    for (; currentSalt < chunkEnd; currentSalt++) {
      const newSalt = saltPrefix | (currentSalt & MASK_96)
      const addrInt = addressOfClone3(factoryAddress, newSalt)
      const rarity = BigInt(numberOfLeadingHexZeros(addrInt))

      if (rarity > highestRarity) {
        highestRarity = rarity
        bestSalt = currentSalt
      }

      if (rarity >= minTargetRarity) {
        highestRarity = rarity
        bestSalt = currentSalt
        done = true
        break
      }
    }

    if (done) break

    // Yield to the event loop so the UI stays responsive
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }

  return { bestSalt, highestRarity }
}
