import { describe, expect, it } from 'vitest'

import {
  assertSafeOwnerSignature,
  hashSafeTx,
  isSafeOwnerSignature,
  recoverSafeTxSigner,
  resolveSignedSafeTx,
  safeTxForCall,
  SignedSafeTxError,
} from './signedSafeTx'

// Captured from Rabby (Safe account, mainnet): eth_sendTransaction returned this
// signature for a collateral swap later executed at Safe nonce 95.
const SAFE = '0x000DfeA7bC8F8219A726eAE62150851Dd5Bd9886'
const OWNER = '0xfa1dFEC1e8ED966c61C45797a3D58666Cf2AE708'
const CALL = {
  to: '0x00000000000E98f6c5aE16835bAdF2f7cC0d49D7',
  value: 0n,
  data: '0xc25813aa00000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000120000000000000000000000000000000000000000000000000000000000000024000000000000000000000000000000000000000000000000000000000000002a000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000992731ca7dbd0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000030732303000a0888e6a0c2dd000000000000000000000000000000000000000030732303000a0888e6a0c2dd00000000000000000000000000000000000000000000000000000000000000080000000000000000000000001e002fea42031e00309da403000a0888e6a0c2dd0000000000000000000000000f003020a2030f00305c0403000a0888e6a0c2dd0000000000000000000000000000000000000f00305c0202000a0888e6a0c2dd0000000000000000000000000f00306884020000082c1103000a0888e6a0c2dd0000000000000000000000000000000000000f0030688202000a0888e6a0c2dd00000000000000000000000000000000000004803082c003000a0888e6a0c2dd00000000000000000000000000000000000004803075a003000a0888e6a0c2dd0000000000000000000000000000000000001e00305c0202000a0888e6a0c2dd0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000002386f26fc10000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000030708000000000000000000000000000000000000000000000000000000000003076c0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003076c00000000000000000000000000000000000000000000000000000000000307080000000000000000000000000000000000000000000000000000000000000000',
} as const
const SIGNATURE =
  '0x516dcc49ca39becf9b7cde8cfb97a7a01dc2b14f4695b54a1e3b3c35d1c0cc2e7e579922e7d903477517592aadfc5eb2237928b2d8197c95d746ad33cc4e669f1b'

describe('signed SafeTx', () => {
  it('recognises a 65-byte owner signature but not a tx hash', () => {
    expect(isSafeOwnerSignature(SIGNATURE)).toBe(true)
    expect(isSafeOwnerSignature(`0x${'ab'.repeat(32)}`)).toBe(false)
    expect(isSafeOwnerSignature(undefined)).toBe(false)
  })

  it('recovers the owner from the captured Rabby signature at nonce 95', async () => {
    const hash = hashSafeTx({ chainId: 1, safe: SAFE, tx: safeTxForCall(CALL, 95n) })
    const { signer, signature } = await recoverSafeTxSigner(hash, SIGNATURE)
    expect(signer).toBe(OWNER)
    expect(signature).toBe(SIGNATURE)
  })

  it('normalises v=0/1 signatures to 27/28', async () => {
    const hash = hashSafeTx({ chainId: 1, safe: SAFE, tx: safeTxForCall(CALL, 95n) })
    const lowV = `0x${SIGNATURE.slice(2, -2)}00` as const
    const { signer, signature } = await recoverSafeTxSigner(hash, lowV)
    expect(signer).toBe(OWNER)
    expect(signature).toBe(SIGNATURE)
  })

  it('finds the signed nonce ahead of the on-chain nonce', async () => {
    const signed = await resolveSignedSafeTx({
      state: { nonce: 93n, threshold: 1n, owners: [OWNER] },
      chainId: 1,
      safe: SAFE,
      call: CALL,
      signature: SIGNATURE,
    })
    expect(signed.tx.nonce).toBe(95n)
    expect(signed.signer).toBe(OWNER)
    expect(signed.signatures).toBe(SIGNATURE)
  })

  it('rejects when no nonce in the window recovers to an owner', async () => {
    const attempt = resolveSignedSafeTx({
      state: { nonce: 96n, threshold: 1n, owners: [OWNER] },
      chainId: 1,
      safe: SAFE,
      call: CALL,
      signature: SIGNATURE,
    })
    await expect(attempt).rejects.toMatchObject({ code: 'SIGNATURE_MISMATCH' })
  })

  it('rejects Safes that need more than one signature', async () => {
    const attempt = resolveSignedSafeTx({
      state: { nonce: 95n, threshold: 2n, owners: [OWNER] },
      chainId: 1,
      safe: SAFE,
      call: CALL,
      signature: SIGNATURE,
    })
    await expect(attempt).rejects.toBeInstanceOf(SignedSafeTxError)
    await expect(attempt).rejects.toMatchObject({ code: 'THRESHOLD_NOT_MET' })
  })

  it('rejects malformed 65-byte signatures as INVALID_SIGNATURE without throwing raw errors', async () => {
    const hash = hashSafeTx({ chainId: 1, safe: SAFE, tx: safeTxForCall(CALL, 95n) })
    const zeroR = `0x${'00'.repeat(32)}${SIGNATURE.slice(66)}` as const
    const highS = `0x${SIGNATURE.slice(2, 66)}${'ff'.repeat(32)}1b` as const
    const badV = `0x${SIGNATURE.slice(2, -2)}05` as const
    for (const signature of [zeroR, highS, badV]) {
      expect(() => assertSafeOwnerSignature(signature)).toThrow(SignedSafeTxError)
      await expect(recoverSafeTxSigner(hash, signature)).rejects.toMatchObject({
        code: 'INVALID_SIGNATURE',
      })
    }
    expect(() => assertSafeOwnerSignature(SIGNATURE)).not.toThrow()
  })
})
