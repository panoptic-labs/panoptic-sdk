import { hashDomain, hashTypedData, keccak256, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { COW_ORDER_TYPES, cowDomain } from './eip712'
import { signAndSubmitCowOrder } from './order'
import type { CowQuote } from './types'

/** Known GPv2Settlement domain separator on Ethereum mainnet (from the deployed contract). */
const MAINNET_DOMAIN_SEPARATOR =
  '0xc078f884a2676e1345748b1feace7b0abee5d00ecadb6e574dcdd109a63e8943'

/** keccak256 of the canonical GPv2 Order type string (ORDER_TYPE_HASH in GPv2Order.sol). */
const GPV2_ORDER_TYPE_HASH = '0xd5a25ba2e97094ad7d83dc28a6572da797d6b3e7fc6663bd93efb789fc17e489'

const EIP712_DOMAIN_TYPES = {
  EIP712Domain: [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' },
  ],
} as const

const QUOTE: CowQuote = {
  kind: 'sell',
  sellToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  buyToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  sellAmount: 1000000n,
  buyAmount: 500000000000000000n,
  feeAmount: 5000n,
  sellAmountTotal: 1005000n,
  orderSellAmount: 1005000n,
  orderBuyAmount: 497500000000000000n,
  validTo: 1750000000n,
  quoteId: 42,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('CoW EIP-712 definitions', () => {
  it('domain matches the deployed mainnet GPv2Settlement domain separator', () => {
    expect(
      hashDomain({ domain: { ...cowDomain(1), chainId: 1n }, types: EIP712_DOMAIN_TYPES }),
    ).toBe(MAINNET_DOMAIN_SEPARATOR)
  })

  it('Order type string matches GPv2Order.sol ORDER_TYPE_HASH', () => {
    const typeString =
      'Order(' + COW_ORDER_TYPES.Order.map((f) => `${f.type} ${f.name}`).join(',') + ')'
    expect(keccak256(toHex(typeString))).toBe(GPV2_ORDER_TYPE_HASH)
  })
})

describe('signAndSubmitCowOrder', () => {
  it('signs the order and posts it with feeAmount 0 and the appData document', async () => {
    const account = privateKeyToAccount(
      '0x0000000000000000000000000000000000000000000000000000000000000001',
    )
    const signTypedData = vi.fn(
      (args: Parameters<typeof account.signTypedData>[0] & { account: unknown }) =>
        account.signTypedData(args),
    )
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify('0xabcdef'), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await signAndSubmitCowOrder({
      walletClient: { signTypedData } as never,
      account: account.address,
      chainId: 1n,
      quote: QUOTE,
    })

    expect(result.orderUid).toBe('0xabcdef')

    // The signed payload hashes consistently under the GPv2 domain.
    const signArgs = signTypedData.mock.calls[0][0]
    expect(() =>
      hashTypedData({
        domain: signArgs.domain,
        types: signArgs.types,
        primaryType: signArgs.primaryType,
        message: signArgs.message,
      }),
    ).not.toThrow()
    const signedDomain = signArgs.domain as ReturnType<typeof cowDomain>
    expect(
      hashDomain({
        domain: { ...signedDomain, chainId: BigInt(signedDomain.chainId) },
        types: EIP712_DOMAIN_TYPES,
      }),
    ).toBe(MAINNET_DOMAIN_SEPARATOR)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.cow.fi/mainnet/api/v1/orders')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.feeAmount).toBe('0')
    expect(body.sellAmount).toBe('1005000')
    expect(body.buyAmount).toBe('497500000000000000')
    expect(body.kind).toBe('sell')
    expect(body.receiver).toBe(account.address)
    expect(body.from).toBe(account.address)
    expect(body.signingScheme).toBe('eip712')
    expect(body.quoteId).toBe(42)
    expect(JSON.parse(body.appData).appCode).toBe('panoptic')
    expect(body.appDataHash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(body.signature).toMatch(/^0x[0-9a-f]+$/)
  })
})
