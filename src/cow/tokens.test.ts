import { afterEach, describe, expect, it, vi } from 'vitest'

import { findCowToken } from './tokens'

const CURATED = 'https://lists.test/curated.json'
const FALLBACK = 'https://lists.test/fallback.json'

const CURATED_LIST = {
  tokens: [
    {
      chainId: 1,
      address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
      symbol: 'UNI',
      name: 'Uniswap',
      decimals: 18,
    },
  ],
}

const FALLBACK_LIST = {
  tokens: [
    {
      chainId: 1,
      address: '0xC845b2894Dbddd03858Fd2D643b4ef725Fe0849D',
      symbol: 'NVDAX',
      name: 'NVIDIA xStock',
      decimals: 18,
    },
    {
      chainId: 1,
      address: '0x2730d6FdC86C95a74253BefFaA8306B40feDecbb',
      symbol: 'UNI',
      name: 'UNICORN',
      decimals: 8,
    },
  ],
}

function stubLists(lists: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const body = lists[url]
      return Promise.resolve(
        body
          ? new Response(JSON.stringify(body), { status: 200 })
          : new Response('not found', { status: 404 }),
      )
    }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('findCowToken', () => {
  it('resolves case-insensitively from the fallback list', async () => {
    stubLists({ [CURATED]: CURATED_LIST, [FALLBACK]: FALLBACK_LIST })
    const token = await findCowToken({
      chainId: 1n,
      symbol: 'nvdax',
      listUrls: [CURATED, FALLBACK],
    })
    expect(token).toMatchObject({ symbol: 'NVDAX', decimals: 18 })
  })

  it('prefers the earlier (curated) list on symbol collisions', async () => {
    stubLists({ [CURATED]: CURATED_LIST, [FALLBACK]: FALLBACK_LIST })
    const token = await findCowToken({ chainId: 1n, symbol: 'uni', listUrls: [CURATED, FALLBACK] })
    expect(token).toMatchObject({ name: 'Uniswap', decimals: 18 })
  })

  it('returns null for unknown symbols and skips failed list fetches', async () => {
    // Fresh URLs so neither is served from the in-module success cache warmed by
    // earlier cases; the curated URL is left unstubbed so it genuinely 404s and
    // the fallback path is exercised.
    const curated = 'https://lists.test/curated-404.json'
    const fallback = 'https://lists.test/fallback-404.json'
    stubLists({ [fallback]: FALLBACK_LIST })
    expect(
      await findCowToken({ chainId: 1n, symbol: 'nosuchtoken', listUrls: [curated, fallback] }),
    ).toBeNull()
    // Curated URL 404s — resolution still succeeds via the fallback.
    expect(
      await findCowToken({ chainId: 1n, symbol: 'NVDAX', listUrls: [curated, fallback] }),
    ).toMatchObject({ name: 'NVIDIA xStock' })
  })

  it('filters by chainId', async () => {
    // Fresh URL: successful list fetches are cached in-module across calls.
    const url = 'https://lists.test/other-chain.json'
    stubLists({ [url]: { tokens: [{ ...FALLBACK_LIST.tokens[0], chainId: 8453 }] } })
    expect(await findCowToken({ chainId: 1n, symbol: 'NVDAX', listUrls: [url] })).toBeNull()
  })
})
