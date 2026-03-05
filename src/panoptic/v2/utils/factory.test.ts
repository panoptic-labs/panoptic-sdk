import { describe, expect, it } from 'vitest'

import { decodePanopticTokenURI } from './factory'

describe('decodePanopticTokenURI', () => {
  it('should decode a valid base64-encoded token URI', () => {
    const metadata = {
      name: 'Test Pool',
      description: 'A test pool',
      attributes: [
        { trait_type: 'Rarity', value: '42' },
        { trait_type: 'Strategy', value: 'Covered Call' },
        { trait_type: 'ChainId', value: '1' },
      ],
      image: 'data:image/svg+xml;base64,abc',
    }
    const encoded = btoa(JSON.stringify(metadata))
    const tokenURI = `data:application/json;base64,${encoded}`

    const result = decodePanopticTokenURI(tokenURI)

    expect(result).toEqual(metadata)
    expect(result?.name).toBe('Test Pool')
    expect(result?.attributes[0].value).toBe('42')
  })

  it('should return undefined for empty string', () => {
    expect(decodePanopticTokenURI('')).toBeUndefined()
  })

  it('should return undefined for invalid URI without base64 prefix', () => {
    expect(decodePanopticTokenURI('not-a-data-uri')).toBeUndefined()
  })

  it('should return undefined for malformed base64 payload', () => {
    expect(decodePanopticTokenURI('data:application/json;base64,@@@')).toBeUndefined()
  })

  it('should return undefined for base64 that decodes to invalid JSON', () => {
    const tokenURI = `data:application/json;base64,${btoa('not-json')}`
    expect(decodePanopticTokenURI(tokenURI)).toBeUndefined()
  })
})
