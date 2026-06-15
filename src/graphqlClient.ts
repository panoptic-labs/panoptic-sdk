import { GraphQLClient } from 'graphql-request'

import { getSdk as getHypoVaultSdk } from './graphql/hypoVault-sdk.generated'
import { CHAIN_DEPLOYMENTS } from './hypoVault/chainDeployments'

// const chainToPanopticGraphQlAPI: Record<number, string> = {
//   // mainnet
//   1: 'https://api.goldsky.com/api/public/project_cl9gc21q105380hxuh8ks53k3/subgraphs/panoptic-subgraph-mainnet/dev/gn',
//   // anvil
//   31337:
//     'https://api.goldsky.com/api/public/project_cl9gc21q105380hxuh8ks53k3/subgraphs/panoptic-subgraph-mainnet/dev/gn',
//   // unichain
//   130: 'https://api.goldsky.com/api/public/project_cl9gc21q105380hxuh8ks53k3/subgraphs/panoptic-subgraph-unichain/dev/gn',
//   // polygon
//   137: 'https://api.goldsky.com/api/public/project_cl9gc21q105380hxuh8ks53k3/subgraphs/panoptic-subgraph-sepolia/beta7-dev/gn',
//   // arbitrum
//   42161:
//     'https://api.goldsky.com/api/public/project_cl9gc21q105380hxuh8ks53k3/subgraphs/panoptic-subgraph-sepolia/beta7-dev/gn',
//   // base
//   8453: 'https://api.goldsky.com/api/public/project_cl9gc21q105380hxuh8ks53k3/subgraphs/panoptic-subgraph-base/dev/gn',
//   // sepolia
//   11155111:
//     'https://api.goldsky.com/api/public/project_cl9gc21q105380hxuh8ks53k3/subgraphs/panoptic-subgraph-sepolia/dev/gn',
//   // avalanche
//   43114:
//     'https://api.goldsky.com/api/public/project_cl9gc21q105380hxuh8ks53k3/subgraphs/panoptic-subgraph-sepolia/beta7-dev/gn',
//   // op
//   10: 'https://api.goldsky.com/api/public/project_cl9gc21q105380hxuh8ks53k3/subgraphs/panoptic-subgraph-sepolia/beta7-dev/gn',
// }

export const chainToHypoVaultGraphQlAPI: Record<number, string> = {}

for (const deployment of Object.values(CHAIN_DEPLOYMENTS)) {
  chainToHypoVaultGraphQlAPI[deployment.chainId] = deployment.subgraphs.hypovault
}

// TODO: move Panoptic subgraph queries and sdk construction into SDK here
// export const getPanopticGraphQLClient = (chainId: number) => {
//   const apiUrl = chainToPanopticGraphQlAPI[chainId];
//   const client = new GraphQLClient(apiUrl);
//   return getPanopticSdk(client);
// };

export function getHypoVaultGraphQLClient(chainId: number): ReturnType<typeof getHypoVaultSdk> {
  const apiUrl = chainToHypoVaultGraphQlAPI[chainId]
  if (apiUrl === undefined) {
    throw new Error(`Unsupported HypoVault subgraph chainId: ${chainId}`)
  }
  const client = new GraphQLClient(apiUrl)
  return getHypoVaultSdk(client)
}

export type HypoVaultGraphQLClient = ReturnType<typeof getHypoVaultGraphQLClient>
