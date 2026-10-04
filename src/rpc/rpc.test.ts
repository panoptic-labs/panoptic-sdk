import { describe, expect, it } from 'vitest'

import {
  getAlchemyRpcUrl,
  ponderRpc,
  redactRpcSecrets,
  resolveRpcEndpoints,
  rpcForkArgs,
  rpcTransport,
} from '.'

const ALCHEMY_ONLY = { ALCHEMY_API_KEY: 'alchemy-key' }

describe('resolveRpcEndpoints', () => {
  describe('provider keys (no URL configured)', () => {
    it('resolves Alchemy exactly as getAlchemyRpcUrl does', () => {
      for (const chainId of [1, 10, 130, 137, 4663, 8453, 42161, 11155111] as const) {
        expect(resolveRpcEndpoints(chainId, ALCHEMY_ONLY)).toEqual([
          { source: 'alchemy', url: getAlchemyRpcUrl(chainId, 'alchemy-key'), headers: {} },
        ])
      }
    })

    it('returns only the first configured preset, never adding failover implicitly', () => {
      expect(
        resolveRpcEndpoints(1, { ...ALCHEMY_ONLY, UNIBLOCK_API_KEY: 'uniblock-key' }),
      ).toHaveLength(1)
    })

    it('falls back to Uniblock with the key in a header', () => {
      expect(resolveRpcEndpoints(4663, { UNIBLOCK_API_KEY: 'uniblock-key' })).toEqual([
        {
          source: 'uniblock',
          url: 'https://api.uniblock.dev/uni/v1/json-rpc?chainId=4663',
          headers: { 'x-api-key': 'uniblock-key' },
        },
      ])
    })

    it('skips presets that do not serve the chain', () => {
      const env = { ...ALCHEMY_ONLY, INFURA_API_KEY: 'infura-key' }
      expect(
        resolveRpcEndpoints(43114, env, { defaultProviders: ['alchemy', 'infura'] })[0].url,
      ).toBe('https://avalanche-mainnet.infura.io/v3/infura-key')
    })

    it('treats blank keys as unset', () => {
      expect(
        resolveRpcEndpoints(1, { ALCHEMY_API_KEY: '  ', UNIBLOCK_API_KEY: 'uniblock-key' })[0]
          .source,
      ).toBe('uniblock')
    })

    it('lets RPC_PROVIDERS reorder presets', () => {
      expect(
        resolveRpcEndpoints(1, {
          ...ALCHEMY_ONLY,
          UNIBLOCK_API_KEY: 'uniblock-key',
          RPC_PROVIDERS: 'uniblock,alchemy',
        })[0].source,
      ).toBe('uniblock')
      expect(() => resolveRpcEndpoints(1, { ...ALCHEMY_ONLY, RPC_PROVIDERS: 'nope' })).toThrow(
        'RPC_PROVIDERS entry "nope" is not a known provider',
      )
    })

    it('throws naming every accepted variable when nothing is configured', () => {
      expect(() => resolveRpcEndpoints(1, {}, { legacyUrlEnv: ['RPC_URL'] })).toThrow(
        'No RPC configured for chain 1: set RPC_URL_1, RPC_URL, ALCHEMY_API_KEY, UNIBLOCK_API_KEY',
      )
    })
  })

  describe('legacy URL variables', () => {
    it('keeps a service-specific primary and fallback in order', () => {
      expect(
        resolveRpcEndpoints(
          1,
          { RPC_URL: 'https://a.example', RPC_URL_FALLBACK: 'https://b.example', ...ALCHEMY_ONLY },
          { legacyUrlEnv: ['RPC_URL', 'RPC_URL_FALLBACK'] },
        ).map((endpoint) => endpoint.url),
      ).toEqual(['https://a.example', 'https://b.example'])
    })

    it('splits comma-separated lists and drops duplicates', () => {
      expect(
        resolveRpcEndpoints(
          1,
          { PONDER_RPC_URL_1: 'https://a.example, https://b.example,https://a.example' },
          { legacyUrlEnv: ['PONDER_RPC_URL_1'] },
        ).map((endpoint) => endpoint.url),
      ).toEqual(['https://a.example', 'https://b.example'])
    })
  })

  describe('RPC_URL_<chainId>', () => {
    it('takes precedence over legacy variables and keys', () => {
      expect(
        resolveRpcEndpoints(
          1,
          {
            RPC_URL_1: 'https://internal.example',
            RPC_URL: 'https://legacy.example',
            ...ALCHEMY_ONLY,
          },
          { legacyUrlEnv: ['RPC_URL'] },
        ).map((endpoint) => endpoint.url),
      ).toEqual(['https://internal.example'])
    })

    it('mixes URLs and presets, binding headers to their own entry', () => {
      expect(
        resolveRpcEndpoints(1, {
          RPC_URL_1: 'https://internal.example/eth, uniblock, alchemy',
          RPC_HEADERS_1_0: 'x-api-key: internal-key; x-team: panoptic',
          UNIBLOCK_API_KEY: 'uniblock-key',
          ...ALCHEMY_ONLY,
        }),
      ).toEqual([
        {
          source: 'url',
          url: 'https://internal.example/eth',
          headers: { 'x-api-key': 'internal-key', 'x-team': 'panoptic' },
        },
        {
          source: 'uniblock',
          url: 'https://api.uniblock.dev/uni/v1/json-rpc?chainId=1',
          headers: { 'x-api-key': 'uniblock-key' },
        },
        {
          source: 'alchemy',
          url: 'https://eth-mainnet.g.alchemy.com/v2/alchemy-key',
          headers: {},
        },
      ])
    })

    it('rejects entries it cannot honour', () => {
      expect(() => resolveRpcEndpoints(1, { RPC_URL_1: 'uniblock' })).toThrow(
        'RPC_URL_1 lists "uniblock", which needs UNIBLOCK_API_KEY',
      )
      expect(() => resolveRpcEndpoints(1, { RPC_URL_1: 'ftp://x' })).toThrow(
        'neither an http(s) URL nor a known provider',
      )
      expect(() =>
        resolveRpcEndpoints(1, { RPC_URL_1: 'https://a.example', RPC_HEADERS_1_0: 'nocolon' }),
      ).toThrow('RPC_HEADERS_1_0 must be "Name: value" pairs')
    })
  })
})

type Recorded = { url: string; method: string; headers: Headers }

function recordingFetch(failingUrls: ReadonlySet<string> = new Set()) {
  const requests: Recorded[] = []
  const fetchFn = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const body = JSON.parse(String(init?.body)) as { id: number; method: string }
    requests.push({ url, method: body.method, headers: new Headers(init?.headers) })
    if (failingUrls.has(url)) return new Response('unavailable', { status: 503 })
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: '0x1' }), {
      headers: { 'content-type': 'application/json' },
    })
  }
  return { requests, fetchFn }
}

const TWO_ENDPOINTS = resolveRpcEndpoints(1, {
  RPC_URL_1: 'https://primary.example,https://secondary.example',
  RPC_HEADERS_1_0: 'x-api-key: primary-key',
})

describe('rpcTransport', () => {
  it('fails over in order and sends each endpoint only its own headers', async () => {
    const { requests, fetchFn } = recordingFetch(new Set(['https://primary.example']))
    const transport = rpcTransport(TWO_ENDPOINTS, { fetchFn, retryCount: 0 })({})

    await expect(transport.request({ method: 'eth_chainId' })).resolves.toBe('0x1')

    expect(requests.map((request) => request.url)).toEqual([
      'https://primary.example',
      'https://secondary.example',
    ])
    expect(requests[0].headers.get('x-api-key')).toBe('primary-key')
    expect(requests[1].headers.get('x-api-key')).toBeNull()
  })

  it('never sends a raw transaction to a second endpoint when failover is off', async () => {
    const { requests, fetchFn } = recordingFetch(new Set(['https://primary.example']))
    const transport = rpcTransport(TWO_ENDPOINTS, { fetchFn, retryCount: 0, failover: false })({})

    await expect(
      transport.request({ method: 'eth_sendRawTransaction', params: ['0x00'] }),
    ).rejects.toThrow()

    expect(requests.map((request) => request.url)).toEqual(['https://primary.example'])
  })
})

describe('rpcForkArgs', () => {
  it('adds --fork-header only for header-authenticated endpoints', () => {
    expect(rpcForkArgs(resolveRpcEndpoints(1, ALCHEMY_ONLY))).toEqual({
      forkUrl: 'https://eth-mainnet.g.alchemy.com/v2/alchemy-key',
    })
    expect(rpcForkArgs(TWO_ENDPOINTS)).toEqual({
      forkUrl: 'https://primary.example',
      forkHeader: 'x-api-key: primary-key',
    })
  })
})

describe('ponderRpc', () => {
  it('keeps header-free endpoints as plain URLs for Ponder load balancing', () => {
    const single = resolveRpcEndpoints(1, ALCHEMY_ONLY)
    expect(ponderRpc(single)).toBe('https://eth-mainnet.g.alchemy.com/v2/alchemy-key')
    expect(
      ponderRpc(resolveRpcEndpoints(1, { RPC_URL_1: 'https://a.example,https://b.example' })),
    ).toEqual(['https://a.example', 'https://b.example'])
  })

  it('switches to a transport when an endpoint needs headers', () => {
    expect(typeof ponderRpc(TWO_ENDPOINTS)).toBe('function')
  })
})

describe('redactRpcSecrets', () => {
  it.each(['x-api-key', 'authorization', 'proxy-authorization'])(
    'masks quoted and unquoted %s headers',
    (name) => {
      for (const quote of ['', '"', "'"]) {
        for (const separator of [':', '=']) {
          const prefix = `${quote}${name}${quote} ${separator} ${quote}`
          expect(redactRpcSecrets(`${prefix}Bearer secret${quote}`)).toBe(
            `${prefix}<redacted>${quote}`,
          )
        }
      }
      expect(redactRpcSecrets(JSON.stringify({ [name]: 'secret', safe: 'visible' }))).toBe(
        JSON.stringify({ [name]: '<redacted>', safe: 'visible' }),
      )
    },
  )

  it.each(['Authorization', 'Proxy-Authorization'])(
    'redacts all Digest parameters in raw and serialized %s values',
    (name) => {
      const value = 'Digest username="alice", realm="private", response="secret-hash"'
      const diagnostics = [
        `${name}: ${value}\nrequest failed`,
        `${name}: '${value}'`,
        JSON.stringify({ [name]: value, status: 401 }),
      ]
      for (const diagnostic of diagnostics) {
        const redacted = redactRpcSecrets(diagnostic)
        expect(redacted).toContain('<redacted>')
        expect(redacted).not.toMatch(/Digest|username|alice|realm|private|response|secret-hash/)
      }
      expect(redactRpcSecrets(diagnostics[0])).toBe(`${name}: <redacted>\nrequest failed`)
      expect(redactRpcSecrets(diagnostics[2])).toBe(
        JSON.stringify({ [name]: '<redacted>', status: 401 }),
      )
    },
  )

  it('keeps only the origin of every URL and masks credential headers', () => {
    const out = redactRpcSecrets(
      'failed https://eth-mainnet.g.alchemy.com/v2/secret-1 and https://mainnet.infura.io/v3/secret-2 ' +
        'and https://api.uniblock.dev/uni/v1/json-rpc?chainId=1 with x-api-key: secret-3',
    )
    expect(out).not.toMatch(/secret-\d/)
    expect(out).toContain('https://eth-mainnet.g.alchemy.com/<redacted>')
    expect(out).toContain('https://mainnet.infura.io/<redacted>')
    expect(out).toContain('x-api-key: <redacted>')
  })
})
