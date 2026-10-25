import {
  type Address,
  type Hex,
  concatHex,
  getAddress,
  hashMessage,
  hashTypedData,
  hexToBigInt,
  hexToNumber,
  isAddressEqual,
  numberToHex,
  recoverAddress,
  sliceHex,
  zeroAddress,
} from 'viem'

export const safeAbi = [
  {
    type: 'event',
    name: 'ExecutionSuccess',
    inputs: [
      { name: 'txHash', type: 'bytes32', indexed: true },
      { name: 'payment', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'function',
    name: 'execTransaction',
    stateMutability: 'payable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
      { name: 'operation', type: 'uint8' },
      { name: 'safeTxGas', type: 'uint256' },
      { name: 'baseGas', type: 'uint256' },
      { name: 'gasPrice', type: 'uint256' },
      { name: 'gasToken', type: 'address' },
      { name: 'refundReceiver', type: 'address' },
      { name: 'signatures', type: 'bytes' },
    ],
    outputs: [{ name: 'success', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'VERSION',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    type: 'function',
    name: 'nonce',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getThreshold',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getOwners',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address[]' }],
  },
] as const

/** A plain call the owner asked their wallet to send from the Safe. */
export interface SafeCall {
  to: Address
  value: bigint
  data: Hex
}

export interface SafeTx extends SafeCall {
  operation: 0 | 1
  safeTxGas: bigint
  baseGas: bigint
  gasPrice: bigint
  gasToken: Address
  refundReceiver: Address
  nonce: bigint
}

export interface SignedSafeTx {
  safe: Address
  chainId: number
  tx: SafeTx
  safeTxHash: Hex
  signer: Address
  /** Packed `signatures` argument for `execTransaction`. */
  signatures: Hex
}

export type SignedSafeTxErrorCode = 'INVALID_SIGNATURE' | 'THRESHOLD_NOT_MET' | 'SIGNATURE_MISMATCH'

export class SignedSafeTxError extends Error {
  constructor(
    readonly code: SignedSafeTxErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'SignedSafeTxError'
  }
}

const SAFE_TX_TYPES = {
  SafeTx: [
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
    { name: 'operation', type: 'uint8' },
    { name: 'safeTxGas', type: 'uint256' },
    { name: 'baseGas', type: 'uint256' },
    { name: 'gasPrice', type: 'uint256' },
    { name: 'gasToken', type: 'address' },
    { name: 'refundReceiver', type: 'address' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const

/** EIP-712 SafeTx hash (Safe ≥ 1.3 domain: chainId + verifyingContract). */
export function hashSafeTx(params: { chainId: number; safe: Address; tx: SafeTx }): Hex {
  return hashTypedData({
    domain: { chainId: params.chainId, verifyingContract: params.safe },
    types: SAFE_TX_TYPES,
    primaryType: 'SafeTx',
    message: params.tx,
  })
}

/**
 * A wallet signing a plain call for a Safe owner (Rabby, Safe{Wallet}) signs it
 * with no refund or gas fields; only the nonce varies.
 */
export function safeTxForCall(call: SafeCall, nonce: bigint): SafeTx {
  return {
    ...call,
    operation: 0,
    safeTxGas: 0n,
    baseGas: 0n,
    gasPrice: 0n,
    gasToken: zeroAddress,
    refundReceiver: zeroAddress,
    nonce,
  }
}

/** True for a 65-byte ECDSA signature — what a Safe-owner wallet returns instead of a tx hash. */
export function isSafeOwnerSignature(value: unknown): value is Hex {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{130}$/.test(value)
}

const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
const SUPPORTED_V = new Set([0, 1, 27, 28, 31, 32])

/**
 * Rejects anything that cannot be a Safe owner's ECDSA signature, without any
 * RPC: 65 bytes, supported v (raw 0/1/27/28 or `eth_sign` 31/32), and r, s in
 * the curve range.
 */
export function assertSafeOwnerSignature(signature: Hex): void {
  if (!isSafeOwnerSignature(signature)) {
    throw new SignedSafeTxError('INVALID_SIGNATURE', 'expected a 65-byte ECDSA signature')
  }
  const r = hexToBigInt(sliceHex(signature, 0, 32))
  const s = hexToBigInt(sliceHex(signature, 32, 64))
  const v = hexToNumber(sliceHex(signature, 64, 65))
  if (!SUPPORTED_V.has(v)) {
    throw new SignedSafeTxError('INVALID_SIGNATURE', `unsupported signature v=${v}`)
  }
  if (r === 0n || r >= SECP256K1_N || s === 0n || s >= SECP256K1_N) {
    throw new SignedSafeTxError('INVALID_SIGNATURE', 'signature r/s out of range')
  }
}

/**
 * Recovers the signer of `safeTxHash`, accepting raw ECDSA (v 27/28, or 0/1)
 * and `eth_sign` (v 31/32) signatures, and returns the signature in the form
 * the Safe verifies.
 */
export async function recoverSafeTxSigner(
  safeTxHash: Hex,
  signature: Hex,
): Promise<{ signer: Address; signature: Hex }> {
  assertSafeOwnerSignature(signature)
  const rs = sliceHex(signature, 0, 64)
  const v = hexToNumber(sliceHex(signature, 64, 65))
  const ethSign = v === 31 || v === 32
  const normalized = ethSign
    ? signature
    : concatHex([rs, numberToHex(v < 27 ? v + 27 : v, { size: 1 })])
  try {
    const signer = ethSign
      ? await recoverAddress({
          hash: hashMessage({ raw: safeTxHash }),
          signature: concatHex([rs, numberToHex(v - 4, { size: 1 })]),
        })
      : await recoverAddress({ hash: safeTxHash, signature: normalized })
    return { signer, signature: normalized }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new SignedSafeTxError('INVALID_SIGNATURE', `signature recovery failed: ${reason}`)
  }
}

/**
 * Resolves an owner's signature over a plain call into an executable SafeTx,
 * given the Safe's on-chain `nonce`, `owners` and `threshold`. The signed nonce
 * is not part of the call, so it is searched from the on-chain nonce forward
 * (wallets may sign ahead of queued transactions).
 */
export async function resolveSignedSafeTx(params: {
  chainId: number
  safe: Address
  call: SafeCall
  signature: Hex
  state: { nonce: bigint; threshold: bigint; owners: readonly Address[] }
  nonceWindow?: number
}): Promise<SignedSafeTx> {
  const safe = getAddress(params.safe)
  const nonceWindow = params.nonceWindow ?? 5
  const { nonce, threshold, owners } = params.state
  if (threshold !== 1n) {
    throw new SignedSafeTxError(
      'THRESHOLD_NOT_MET',
      `Safe threshold is ${threshold}; a single owner signature cannot execute`,
    )
  }

  for (let offset = 0n; offset < BigInt(nonceWindow); offset++) {
    const tx = safeTxForCall(params.call, nonce + offset)
    const safeTxHash = hashSafeTx({ chainId: params.chainId, safe, tx })
    const { signer, signature } = await recoverSafeTxSigner(safeTxHash, params.signature)
    if (owners.some((owner) => isAddressEqual(owner, signer))) {
      return { safe, chainId: params.chainId, tx, safeTxHash, signer, signatures: signature }
    }
  }
  throw new SignedSafeTxError(
    'SIGNATURE_MISMATCH',
    `signature does not recover to an owner of ${safe} for nonces ${nonce}..${nonce + BigInt(nonceWindow) - 1n}`,
  )
}

/** `execTransaction` arguments for a resolved signed SafeTx. */
export function execTransactionArgs(signed: SignedSafeTx) {
  const { tx } = signed
  return [
    tx.to,
    tx.value,
    tx.data,
    tx.operation,
    tx.safeTxGas,
    tx.baseGas,
    tx.gasPrice,
    tx.gasToken,
    tx.refundReceiver,
    signed.signatures,
  ] as const
}
