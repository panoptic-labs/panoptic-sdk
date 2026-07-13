import { GraphQLClient } from 'graphql-request'
import type { Address } from 'viem'

import { chainToHypoVaultGraphQlAPI } from '../../graphqlClient'

type FirstDepositEvent = {
  blockTimestamp: string
  hypoVault: {
    id: string
  }
}

type FirstDepositEventsResponse = {
  depositExecuteds: FirstDepositEvent[]
  depositsFulfilleds: FirstDepositEvent[]
}

function parseTimestampSec(value: string): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

async function fetchFirstDepositTimestampForVault({
  graphClient,
  vaultAddress,
}: {
  graphClient: GraphQLClient
  vaultAddress: string
}): Promise<number | null> {
  const response = await graphClient.request<FirstDepositEventsResponse>(
    `
      query FirstVaultDepositTimestamp($hypoVault: String!) {
        depositExecuteds(
          where: {
            hypoVault: $hypoVault
            assets_gt: "0"
            shares_gt: "0"
          }
          orderBy: blockTimestamp
          orderDirection: asc
          first: 1
        ) {
          blockTimestamp
          hypoVault {
            id
          }
        }
        depositsFulfilleds(
          where: {
            hypoVault: $hypoVault
            assetsFulfilled_gt: "0"
            sharesReceived_gt: "0"
          }
          orderBy: blockTimestamp
          orderDirection: asc
          first: 1
        ) {
          blockTimestamp
          hypoVault {
            id
          }
        }
      }
    `,
    { hypoVault: vaultAddress.toLowerCase() },
  )

  const timestamps = [...response.depositExecuteds, ...response.depositsFulfilleds]
    .map((event) => parseTimestampSec(event.blockTimestamp))
    .filter((timestamp): timestamp is number => timestamp !== null)

  if (timestamps.length === 0) {
    return null
  }
  return Math.min(...timestamps)
}

export async function fetchFirstDepositTimestampByVaultId({
  chainId,
  vaultAddresses,
}: {
  chainId: number
  vaultAddresses: Address[] | string[]
}): Promise<Record<string, number>> {
  const endpoint = chainToHypoVaultGraphQlAPI[chainId as keyof typeof chainToHypoVaultGraphQlAPI]
  if (endpoint === undefined || vaultAddresses.length === 0) {
    return {}
  }

  const graphClient = new GraphQLClient(endpoint)
  const entries = await Promise.all(
    vaultAddresses.map(async (vaultAddress) => {
      const vaultAddressLower = vaultAddress.toLowerCase()
      const timestamp = await fetchFirstDepositTimestampForVault({
        graphClient,
        vaultAddress: vaultAddressLower,
      }).catch((error) => {
        console.warn(
          `[vault-apy] Failed first deposit timestamp lookup for vault ${vaultAddressLower}`,
          error,
        )
        return null
      })
      return [vaultAddressLower, timestamp] as const
    }),
  )

  return Object.fromEntries(
    entries.filter((entry): entry is readonly [string, number] => entry[1] !== null),
  )
}
