/**
 * Resolve token symbols to addresses using the token lists CoW Swap trades
 * from. Lets a UI route any listed token (e.g. xStocks like NVDAx) to the
 * order book without maintaining a static registry.
 *
 * Sources, in priority order:
 * 1. CoW's curated list (canonical entries for blue-chip symbols like UNI)
 * 2. CoinGecko's full per-chain list (carries the long tail, incl. xStocks)
 *
 * Lists are fetched lazily and cached in-module for an hour.
 *
 * @module cow/tokens
 */

import { type Address, getAddress } from 'viem'

/** Resolved token-list entry. */
export interface CowTokenInfo {
  chainId: number
  address: Address
  symbol: string
  name: string
  decimals: number
  logoURI?: string
}

/** Parameters for {@link findCowToken}. */
export interface FindCowTokenParams {
  /** Chain to resolve on. */
  chainId: bigint
  /** Token symbol, case-insensitive (e.g. 'nvdax'). */
  symbol: string
  /** Override the token-list URLs (e.g. tests). */
  listUrls?: string[]
}

/** CoinGecko per-chain list slugs for the chains CoW supports here. */
const COINGECKO_CHAIN_SLUGS: Partial<Record<number, string>> = {
  1: 'ethereum',
}

function tokenListUrls(chainId: number): string[] {
  const urls = ['https://files.cow.fi/tokens/CowSwap.json']
  const slug = COINGECKO_CHAIN_SLUGS[chainId]
  if (slug) urls.push(`https://tokens.coingecko.com/${slug}/all.json`)
  return urls
}

interface RawTokenList {
  tokens: {
    chainId?: number
    address: string
    symbol: string
    name: string
    decimals: number
    logoURI?: string
  }[]
}

const LIST_CACHE_TTL_MS = 3_600_000
const listCache = new Map<string, { fetchedAt: number; list: Promise<RawTokenList | null> }>()

/** Fetch a token list with an in-module 1h cache; resolves null on any failure. */
function fetchTokenList(url: string): Promise<RawTokenList | null> {
  const cached = listCache.get(url)
  if (cached && Date.now() - cached.fetchedAt < LIST_CACHE_TTL_MS) return cached.list

  const list = fetch(url)
    .then((res) => (res.ok ? (res.json() as Promise<RawTokenList>) : null))
    .catch(() => null)
    .then((parsed) => {
      // Drop failures from the cache so the next call retries.
      if (parsed === null || !Array.isArray(parsed.tokens)) {
        listCache.delete(url)
        return null
      }
      return parsed
    })
  listCache.set(url, { fetchedAt: Date.now(), list })
  return list
}

/**
 * Find a token by symbol on the given chain across CoW's token lists. The
 * first list containing a (case-insensitive) symbol match wins; within a
 * list the first match wins, which favors canonical entries on collisions.
 * Returns null when no list resolves the symbol (or all fetches fail).
 *
 * Resolution only proves the token is listed — whether solvers can actually
 * fill a given pair/size is answered by `quoteCowSwap`.
 */
export async function findCowToken(params: FindCowTokenParams): Promise<CowTokenInfo | null> {
  const { chainId, symbol, listUrls } = params
  const chain = Number(chainId)
  const wanted = symbol.toUpperCase()

  for (const url of listUrls ?? tokenListUrls(chain)) {
    const list = await fetchTokenList(url)
    if (!list) continue
    const match = list.tokens.find(
      // CoW's own list omits chainId on some entries (single-chain lists).
      (t) => (t.chainId === undefined || t.chainId === chain) && t.symbol.toUpperCase() === wanted,
    )
    if (match) {
      // Validate/checksum the external address; skip a malformed entry rather
      // than leak a non-Address string to callers.
      let address: Address
      try {
        address = getAddress(match.address)
      } catch {
        continue
      }
      return {
        chainId: chain,
        address,
        symbol: match.symbol,
        name: match.name,
        decimals: match.decimals,
        logoURI: match.logoURI,
      }
    }
  }
  return null
}
