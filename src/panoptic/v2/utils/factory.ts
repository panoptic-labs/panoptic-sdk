/**
 * Factory utility functions for the Panoptic v2 SDK.
 * @module v2/utils/factory
 */

/**
 * Decoded Panoptic NFT metadata from a base64-encoded token URI.
 */
export type PanopticNFTMetadata = {
  name: string
  description: string
  attributes: [
    {
      trait_type: 'Rarity'
      value: string
    },
    {
      trait_type: 'Strategy'
      value: string
    },
    {
      trait_type: 'ChainId'
      value: string
    },
  ]
  image: string
}

/**
 * Decode a base64-encoded Panoptic NFT token URI into metadata.
 *
 * @param tokenURI - The base64-encoded data URI string
 * @returns Parsed NFT metadata object, or undefined if input is invalid
 */
export function decodePanopticTokenURI(tokenURI: string): PanopticNFTMetadata | undefined {
  if (tokenURI === undefined || tokenURI === '') {
    return undefined
  }
  const parts = tokenURI.split('data:application/json;base64,')
  if (parts.length < 2 || parts[1] === '') {
    return undefined
  }
  try {
    const decoded = atob(parts[1])
    return JSON.parse(decoded) as PanopticNFTMetadata
  } catch {
    return undefined
  }
}
