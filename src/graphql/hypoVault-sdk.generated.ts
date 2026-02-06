import * as Types from './hypoVault-types.generated';

import { GraphQLClient, RequestOptions } from 'graphql-request';
import gql from 'graphql-tag';
type GraphQLClientRequestHeaders = RequestOptions['requestHeaders'];
export const DepositEpochStateFragmentDoc = gql`
    fragment DepositEpochState on DepositEpochState {
  id
  epoch
  assetsDeposited
  assetsFulfilled
  sharesReceived
  hypoVault {
    id
  }
}
    `;
export const HypoVaultFragmentDoc = gql`
    fragment HypoVault on HypoVault {
  id
  symbol
  name
  underlyingToken {
    id
    symbol
    decimals
    name
    derivedETH
  }
  performanceFeeBps
  owner
  feeWallet
  manager
  accountant
  withdrawalEpoch
  depositEpoch
  reservedWithdrawalAssets
  depositEpochStates {
    id
  }
  withdrawalEpochStates {
    id
  }
  userBalances {
    id
  }
  totalAssetsDeposited
  totalAssetsWithdrawn
  totalPerformanceFeesCollected
  createdAt
  updatedAt
  createdAtBlock
  updatedAtBlock
}
    `;
export const WithdrawalEpochStateFragmentDoc = gql`
    fragment WithdrawalEpochState on WithdrawalEpochState {
  id
  epoch
  sharesWithdrawn
  assetsReceived
  sharesFulfilled
  hypoVault {
    id
  }
}
    `;
export const GetDepositOverviewDocument = gql`
    query GetDepositOverview($account: String!, $hypoVault: String!, $hypoVaultId: ID!, $historyLimit: Int = 5) {
  hypoVault(id: $hypoVaultId) {
    id
    underlyingToken {
      symbol
      decimals
    }
  }
  queuedDeposits(
    where: {account: $account, hypoVault: $hypoVault, amount_gt: "0"}
    orderBy: epoch
    orderDirection: desc
  ) {
    amount
    epoch
  }
  queuedWithdrawals(
    where: {account: $account, hypoVault: $hypoVault, amount_gt: "0"}
    orderBy: epoch
    orderDirection: desc
  ) {
    amount
    epoch
  }
  depositExecuteds(
    first: $historyLimit
    orderBy: blockTimestamp
    orderDirection: desc
    where: {user: $account, hypoVault: $hypoVault}
  ) {
    assets
    blockTimestamp
  }
  withdrawalExecuteds(
    first: $historyLimit
    orderBy: blockTimestamp
    orderDirection: desc
    where: {user: $account, hypoVault: $hypoVault}
  ) {
    assets
    blockTimestamp
  }
}
    `;
export const GetLatestDepositAndWithdrawEpochDocument = gql`
    query GetLatestDepositAndWithdrawEpoch($hypoVault: String!) {
  depositEpochStates(
    where: {hypoVault: $hypoVault}
    orderBy: epoch
    orderDirection: desc
    first: 1
  ) {
    ...DepositEpochState
  }
  withdrawalEpochStates(
    where: {hypoVault: $hypoVault}
    orderBy: epoch
    orderDirection: desc
    first: 1
  ) {
    ...WithdrawalEpochState
  }
}
    ${DepositEpochStateFragmentDoc}
${WithdrawalEpochStateFragmentDoc}`;
export const GetLatestEpochDocument = gql`
    query GetLatestEpoch($hypoVault: String!) {
  depositEpochStates(
    where: {hypoVault: $hypoVault}
    orderBy: epoch
    orderDirection: desc
    first: 1
  ) {
    ...DepositEpochState
  }
  withdrawalEpochStates(
    where: {hypoVault: $hypoVault}
    orderBy: epoch
    orderDirection: desc
    first: 1
  ) {
    ...WithdrawalEpochState
  }
}
    ${DepositEpochStateFragmentDoc}
${WithdrawalEpochStateFragmentDoc}`;
export const GetFilteredHypoVaultsDocument = gql`
    query GetFilteredHypoVaults($hypoVaultWhitelist: [Bytes!]!) {
  bundle(id: "1") {
    ethPriceUSD
  }
  hypoVaults(where: {id_in: $hypoVaultWhitelist}) {
    ...HypoVault
  }
}
    ${HypoVaultFragmentDoc}`;
export const GetQueuedWithdrawalsForExecutionDocument = gql`
    query GetQueuedWithdrawalsForExecution($account: String!, $hypoVault: String!, $hypoVaultId: ID!) {
  hypoVault(id: $hypoVaultId) {
    id
    withdrawalEpoch
  }
  queuedWithdrawals(
    where: {account: $account, hypoVault: $hypoVault, amount_gt: "0"}
    orderBy: epoch
    orderDirection: asc
  ) {
    amount
    epoch
  }
}
    `;
export const GetWithdrawalEpochStatesForExecutionDocument = gql`
    query GetWithdrawalEpochStatesForExecution($hypoVault: String!, $epochs: [BigInt!]!) {
  withdrawalEpochStates(where: {hypoVault: $hypoVault, epoch_in: $epochs}) {
    ...WithdrawalEpochState
  }
}
    ${WithdrawalEpochStateFragmentDoc}`;
export const GetQueuedDepositsForWithdrawalDocument = gql`
    query GetQueuedDepositsForWithdrawal($account: String!, $hypoVault: String!, $hypoVaultId: ID!) {
  hypoVault(id: $hypoVaultId) {
    id
    depositEpoch
  }
  userBalances(where: {account: $account, hypoVault: $hypoVault}) {
    shares
  }
  queuedDeposits(
    where: {account: $account, hypoVault: $hypoVault, amount_gt: "0"}
    orderBy: epoch
    orderDirection: asc
  ) {
    amount
    epoch
  }
}
    `;
export const GetDepositEpochStatesForWithdrawalDocument = gql`
    query GetDepositEpochStatesForWithdrawal($hypoVault: String!, $minEpoch: BigInt!, $maxEpoch: BigInt!) {
  depositEpochStates(
    where: {hypoVault: $hypoVault, epoch_gte: $minEpoch, epoch_lt: $maxEpoch}
    orderBy: epoch
    orderDirection: asc
  ) {
    ...DepositEpochState
  }
}
    ${DepositEpochStateFragmentDoc}`;

export type SdkFunctionWrapper = <T>(action: (requestHeaders?:Record<string, string>) => Promise<T>, operationName: string, operationType?: string, variables?: any) => Promise<T>;


const defaultWrapper: SdkFunctionWrapper = (action, _operationName, _operationType, _variables) => action();

export function getSdk(client: GraphQLClient, withWrapper: SdkFunctionWrapper = defaultWrapper) {
  return {
    GetDepositOverview(variables: Types.GetDepositOverviewQueryVariables, requestHeaders?: GraphQLClientRequestHeaders): Promise<Types.GetDepositOverviewQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<Types.GetDepositOverviewQuery>(GetDepositOverviewDocument, variables, {...requestHeaders, ...wrappedRequestHeaders}), 'GetDepositOverview', 'query', variables);
    },
    GetLatestDepositAndWithdrawEpoch(variables: Types.GetLatestDepositAndWithdrawEpochQueryVariables, requestHeaders?: GraphQLClientRequestHeaders): Promise<Types.GetLatestDepositAndWithdrawEpochQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<Types.GetLatestDepositAndWithdrawEpochQuery>(GetLatestDepositAndWithdrawEpochDocument, variables, {...requestHeaders, ...wrappedRequestHeaders}), 'GetLatestDepositAndWithdrawEpoch', 'query', variables);
    },
    GetLatestEpoch(variables: Types.GetLatestEpochQueryVariables, requestHeaders?: GraphQLClientRequestHeaders): Promise<Types.GetLatestEpochQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<Types.GetLatestEpochQuery>(GetLatestEpochDocument, variables, {...requestHeaders, ...wrappedRequestHeaders}), 'GetLatestEpoch', 'query', variables);
    },
    GetFilteredHypoVaults(variables: Types.GetFilteredHypoVaultsQueryVariables, requestHeaders?: GraphQLClientRequestHeaders): Promise<Types.GetFilteredHypoVaultsQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<Types.GetFilteredHypoVaultsQuery>(GetFilteredHypoVaultsDocument, variables, {...requestHeaders, ...wrappedRequestHeaders}), 'GetFilteredHypoVaults', 'query', variables);
    },
    GetQueuedWithdrawalsForExecution(variables: Types.GetQueuedWithdrawalsForExecutionQueryVariables, requestHeaders?: GraphQLClientRequestHeaders): Promise<Types.GetQueuedWithdrawalsForExecutionQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<Types.GetQueuedWithdrawalsForExecutionQuery>(GetQueuedWithdrawalsForExecutionDocument, variables, {...requestHeaders, ...wrappedRequestHeaders}), 'GetQueuedWithdrawalsForExecution', 'query', variables);
    },
    GetWithdrawalEpochStatesForExecution(variables: Types.GetWithdrawalEpochStatesForExecutionQueryVariables, requestHeaders?: GraphQLClientRequestHeaders): Promise<Types.GetWithdrawalEpochStatesForExecutionQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<Types.GetWithdrawalEpochStatesForExecutionQuery>(GetWithdrawalEpochStatesForExecutionDocument, variables, {...requestHeaders, ...wrappedRequestHeaders}), 'GetWithdrawalEpochStatesForExecution', 'query', variables);
    },
    GetQueuedDepositsForWithdrawal(variables: Types.GetQueuedDepositsForWithdrawalQueryVariables, requestHeaders?: GraphQLClientRequestHeaders): Promise<Types.GetQueuedDepositsForWithdrawalQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<Types.GetQueuedDepositsForWithdrawalQuery>(GetQueuedDepositsForWithdrawalDocument, variables, {...requestHeaders, ...wrappedRequestHeaders}), 'GetQueuedDepositsForWithdrawal', 'query', variables);
    },
    GetDepositEpochStatesForWithdrawal(variables: Types.GetDepositEpochStatesForWithdrawalQueryVariables, requestHeaders?: GraphQLClientRequestHeaders): Promise<Types.GetDepositEpochStatesForWithdrawalQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<Types.GetDepositEpochStatesForWithdrawalQuery>(GetDepositEpochStatesForWithdrawalDocument, variables, {...requestHeaders, ...wrappedRequestHeaders}), 'GetDepositEpochStatesForWithdrawal', 'query', variables);
    }
  };
}
export type Sdk = ReturnType<typeof getSdk>;