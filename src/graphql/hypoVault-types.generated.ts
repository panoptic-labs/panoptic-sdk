export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export interface Scalars {
  ID: { input: string | number; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  BigDecimal: { input: string; output: string; }
  BigInt: { input: string; output: string; }
  Bytes: { input: any; output: any; }
  Int8: { input: any; output: any; }
  Timestamp: { input: any; output: any; }
}

export interface Account {
  __typename?: 'Account';
  depositCancelleds: Array<DepositCancelled>;
  depositExecuteds: Array<DepositExecuted>;
  depositRequesteds: Array<DepositRequested>;
  id: Scalars['Bytes']['output'];
  queuedDeposits: Array<QueuedDeposit>;
  queuedWithdrawals: Array<QueuedWithdrawal>;
  redepositStatusChangeds: Array<RedepositStatusChanged>;
  transfers: Array<Transfer>;
  userBalances: Array<UserBalance>;
  userBases: Array<UserBasis>;
  withdrawalCancelleds: Array<WithdrawalCancelled>;
  withdrawalExecuteds: Array<WithdrawalExecuted>;
  withdrawalRequesteds: Array<WithdrawalRequested>;
}


export interface AccountDepositCancelledsArgs {
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<DepositCancelled_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  where?: InputMaybe<DepositCancelled_Filter>;
}


export interface AccountDepositExecutedsArgs {
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<DepositExecuted_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  where?: InputMaybe<DepositExecuted_Filter>;
}


export interface AccountDepositRequestedsArgs {
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<DepositRequested_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  where?: InputMaybe<DepositRequested_Filter>;
}


export interface AccountQueuedDepositsArgs {
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<QueuedDeposit_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  where?: InputMaybe<QueuedDeposit_Filter>;
}


export interface AccountQueuedWithdrawalsArgs {
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<QueuedWithdrawal_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  where?: InputMaybe<QueuedWithdrawal_Filter>;
}


export interface AccountRedepositStatusChangedsArgs {
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<RedepositStatusChanged_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  where?: InputMaybe<RedepositStatusChanged_Filter>;
}


export interface AccountTransfersArgs {
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<Transfer_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  where?: InputMaybe<Transfer_Filter>;
}


export interface AccountUserBalancesArgs {
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<UserBalance_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  where?: InputMaybe<UserBalance_Filter>;
}


export interface AccountUserBasesArgs {
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<UserBasis_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  where?: InputMaybe<UserBasis_Filter>;
}


export interface AccountWithdrawalCancelledsArgs {
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<WithdrawalCancelled_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  where?: InputMaybe<WithdrawalCancelled_Filter>;
}


export interface AccountWithdrawalExecutedsArgs {
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<WithdrawalExecuted_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  where?: InputMaybe<WithdrawalExecuted_Filter>;
}


export interface AccountWithdrawalRequestedsArgs {
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<WithdrawalRequested_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  where?: InputMaybe<WithdrawalRequested_Filter>;
}

export interface Account_Filter {
  /** Filter for the block changed event. */
  _change_block?: InputMaybe<BlockChangedFilter>;
  and?: InputMaybe<Array<InputMaybe<Account_Filter>>>;
  depositCancelleds_?: InputMaybe<DepositCancelled_Filter>;
  depositExecuteds_?: InputMaybe<DepositExecuted_Filter>;
  depositRequesteds_?: InputMaybe<DepositRequested_Filter>;
  id?: InputMaybe<Scalars['Bytes']['input']>;
  id_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_gt?: InputMaybe<Scalars['Bytes']['input']>;
  id_gte?: InputMaybe<Scalars['Bytes']['input']>;
  id_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  id_lt?: InputMaybe<Scalars['Bytes']['input']>;
  id_lte?: InputMaybe<Scalars['Bytes']['input']>;
  id_not?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  or?: InputMaybe<Array<InputMaybe<Account_Filter>>>;
  queuedDeposits_?: InputMaybe<QueuedDeposit_Filter>;
  queuedWithdrawals_?: InputMaybe<QueuedWithdrawal_Filter>;
  redepositStatusChangeds_?: InputMaybe<RedepositStatusChanged_Filter>;
  transfers_?: InputMaybe<Transfer_Filter>;
  userBalances_?: InputMaybe<UserBalance_Filter>;
  userBases_?: InputMaybe<UserBasis_Filter>;
  withdrawalCancelleds_?: InputMaybe<WithdrawalCancelled_Filter>;
  withdrawalExecuteds_?: InputMaybe<WithdrawalExecuted_Filter>;
  withdrawalRequesteds_?: InputMaybe<WithdrawalRequested_Filter>;
}

export enum Account_OrderBy {
  DepositCancelleds = 'depositCancelleds',
  DepositExecuteds = 'depositExecuteds',
  DepositRequesteds = 'depositRequesteds',
  Id = 'id',
  QueuedDeposits = 'queuedDeposits',
  QueuedWithdrawals = 'queuedWithdrawals',
  RedepositStatusChangeds = 'redepositStatusChangeds',
  Transfers = 'transfers',
  UserBalances = 'userBalances',
  UserBases = 'userBases',
  WithdrawalCancelleds = 'withdrawalCancelleds',
  WithdrawalExecuteds = 'withdrawalExecuteds',
  WithdrawalRequesteds = 'withdrawalRequesteds'
}

/**
 * ███████╗██╗   ██╗███████╗███╗   ██╗████████╗    ███████╗███╗   ██╗████████╗██╗████████╗██╗███████╗███████╗
 * ██╔════╝██║   ██║██╔════╝████╗  ██║╚══██╔══╝    ██╔════╝████╗  ██║╚══██╔══╝██║╚══██╔══╝██║██╔════╝██╔════╝
 * █████╗  ██║   ██║█████╗  ██╔██╗ ██║   ██║       █████╗  ██╔██╗ ██║   ██║   ██║   ██║   ██║█████╗  ███████╗
 * ██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║╚██╗██║   ██║       ██╔══╝  ██║╚██╗██║   ██║   ██║   ██║   ██║██╔══╝  ╚════██║
 * ███████╗ ╚████╔╝ ███████╗██║ ╚████║   ██║       ███████╗██║ ╚████║   ██║   ██║   ██║   ██║███████╗███████║
 * ╚══════╝  ╚═══╝  ╚══════╝╚═╝  ╚═══╝   ╚═╝       ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝   ╚═╝   ╚═╝╚══════╝╚══════╝
 *
 * Event Entities
 */
export interface AccountantUpdated {
  __typename?: 'AccountantUpdated';
  blockNumber: Scalars['BigInt']['output'];
  blockTimestamp: Scalars['BigInt']['output'];
  hypoVault: HypoVault;
  id: Scalars['Bytes']['output'];
  newAccountant: Scalars['Bytes']['output'];
  oldAccountant: Scalars['Bytes']['output'];
  transactionHash: Scalars['Bytes']['output'];
}

export interface AccountantUpdated_Filter {
  /** Filter for the block changed event. */
  _change_block?: InputMaybe<BlockChangedFilter>;
  and?: InputMaybe<Array<InputMaybe<AccountantUpdated_Filter>>>;
  blockNumber?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_gt?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_gte?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockNumber_lt?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_lte?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_not?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockTimestamp?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_gt?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_gte?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockTimestamp_lt?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_lte?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_not?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  hypoVault?: InputMaybe<Scalars['String']['input']>;
  hypoVault_?: InputMaybe<HypoVault_Filter>;
  hypoVault_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_lt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_lte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['Bytes']['input']>;
  id_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_gt?: InputMaybe<Scalars['Bytes']['input']>;
  id_gte?: InputMaybe<Scalars['Bytes']['input']>;
  id_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  id_lt?: InputMaybe<Scalars['Bytes']['input']>;
  id_lte?: InputMaybe<Scalars['Bytes']['input']>;
  id_not?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  newAccountant?: InputMaybe<Scalars['Bytes']['input']>;
  newAccountant_contains?: InputMaybe<Scalars['Bytes']['input']>;
  newAccountant_gt?: InputMaybe<Scalars['Bytes']['input']>;
  newAccountant_gte?: InputMaybe<Scalars['Bytes']['input']>;
  newAccountant_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  newAccountant_lt?: InputMaybe<Scalars['Bytes']['input']>;
  newAccountant_lte?: InputMaybe<Scalars['Bytes']['input']>;
  newAccountant_not?: InputMaybe<Scalars['Bytes']['input']>;
  newAccountant_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  newAccountant_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  oldAccountant?: InputMaybe<Scalars['Bytes']['input']>;
  oldAccountant_contains?: InputMaybe<Scalars['Bytes']['input']>;
  oldAccountant_gt?: InputMaybe<Scalars['Bytes']['input']>;
  oldAccountant_gte?: InputMaybe<Scalars['Bytes']['input']>;
  oldAccountant_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  oldAccountant_lt?: InputMaybe<Scalars['Bytes']['input']>;
  oldAccountant_lte?: InputMaybe<Scalars['Bytes']['input']>;
  oldAccountant_not?: InputMaybe<Scalars['Bytes']['input']>;
  oldAccountant_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  oldAccountant_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  or?: InputMaybe<Array<InputMaybe<AccountantUpdated_Filter>>>;
  transactionHash?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_contains?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_gt?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_gte?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  transactionHash_lt?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_lte?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
}

export enum AccountantUpdated_OrderBy {
  BlockNumber = 'blockNumber',
  BlockTimestamp = 'blockTimestamp',
  HypoVault = 'hypoVault',
  HypoVaultAccountant = 'hypoVault__accountant',
  HypoVaultCreatedAt = 'hypoVault__createdAt',
  HypoVaultCreatedAtBlock = 'hypoVault__createdAtBlock',
  HypoVaultDepositEpoch = 'hypoVault__depositEpoch',
  HypoVaultFeeWallet = 'hypoVault__feeWallet',
  HypoVaultId = 'hypoVault__id',
  HypoVaultManager = 'hypoVault__manager',
  HypoVaultName = 'hypoVault__name',
  HypoVaultOwner = 'hypoVault__owner',
  HypoVaultPerformanceFeeBps = 'hypoVault__performanceFeeBps',
  HypoVaultReservedWithdrawalAssets = 'hypoVault__reservedWithdrawalAssets',
  HypoVaultShares = 'hypoVault__shares',
  HypoVaultSymbol = 'hypoVault__symbol',
  HypoVaultTotalAssetsDeposited = 'hypoVault__totalAssetsDeposited',
  HypoVaultTotalAssetsWithdrawn = 'hypoVault__totalAssetsWithdrawn',
  HypoVaultTotalPerformanceFeesCollected = 'hypoVault__totalPerformanceFeesCollected',
  HypoVaultUpdatedAt = 'hypoVault__updatedAt',
  HypoVaultUpdatedAtBlock = 'hypoVault__updatedAtBlock',
  HypoVaultWithdrawalEpoch = 'hypoVault__withdrawalEpoch',
  Id = 'id',
  NewAccountant = 'newAccountant',
  OldAccountant = 'oldAccountant',
  TransactionHash = 'transactionHash'
}

export enum Aggregation_Interval {
  Day = 'day',
  Hour = 'hour'
}

export interface BlockChangedFilter {
  number_gte: Scalars['Int']['input'];
}

export interface Block_Height {
  hash?: InputMaybe<Scalars['Bytes']['input']>;
  number?: InputMaybe<Scalars['Int']['input']>;
  number_gte?: InputMaybe<Scalars['Int']['input']>;
}

/**  Keeps track of ETH/USD price using a configured Uniswap pool.  */
export interface Bundle {
  __typename?: 'Bundle';
  /**  Price of ETH in USD.  */
  ethPriceUSD: Scalars['BigDecimal']['output'];
  /**  The ID of the Bundle singleton is always 1.  */
  id: Scalars['ID']['output'];
}

export interface Bundle_Filter {
  /** Filter for the block changed event. */
  _change_block?: InputMaybe<BlockChangedFilter>;
  and?: InputMaybe<Array<InputMaybe<Bundle_Filter>>>;
  ethPriceUSD?: InputMaybe<Scalars['BigDecimal']['input']>;
  ethPriceUSD_gt?: InputMaybe<Scalars['BigDecimal']['input']>;
  ethPriceUSD_gte?: InputMaybe<Scalars['BigDecimal']['input']>;
  ethPriceUSD_in?: InputMaybe<Array<Scalars['BigDecimal']['input']>>;
  ethPriceUSD_lt?: InputMaybe<Scalars['BigDecimal']['input']>;
  ethPriceUSD_lte?: InputMaybe<Scalars['BigDecimal']['input']>;
  ethPriceUSD_not?: InputMaybe<Scalars['BigDecimal']['input']>;
  ethPriceUSD_not_in?: InputMaybe<Array<Scalars['BigDecimal']['input']>>;
  id?: InputMaybe<Scalars['ID']['input']>;
  id_gt?: InputMaybe<Scalars['ID']['input']>;
  id_gte?: InputMaybe<Scalars['ID']['input']>;
  id_in?: InputMaybe<Array<Scalars['ID']['input']>>;
  id_lt?: InputMaybe<Scalars['ID']['input']>;
  id_lte?: InputMaybe<Scalars['ID']['input']>;
  id_not?: InputMaybe<Scalars['ID']['input']>;
  id_not_in?: InputMaybe<Array<Scalars['ID']['input']>>;
  or?: InputMaybe<Array<InputMaybe<Bundle_Filter>>>;
}

export enum Bundle_OrderBy {
  EthPriceUsd = 'ethPriceUSD',
  Id = 'id'
}

export interface DepositCancelled {
  __typename?: 'DepositCancelled';
  assets: Scalars['BigInt']['output'];
  blockNumber: Scalars['BigInt']['output'];
  blockTimestamp: Scalars['BigInt']['output'];
  hypoVault: HypoVault;
  id: Scalars['Bytes']['output'];
  transactionHash: Scalars['Bytes']['output'];
  user: Account;
}

export interface DepositCancelled_Filter {
  /** Filter for the block changed event. */
  _change_block?: InputMaybe<BlockChangedFilter>;
  and?: InputMaybe<Array<InputMaybe<DepositCancelled_Filter>>>;
  assets?: InputMaybe<Scalars['BigInt']['input']>;
  assets_gt?: InputMaybe<Scalars['BigInt']['input']>;
  assets_gte?: InputMaybe<Scalars['BigInt']['input']>;
  assets_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  assets_lt?: InputMaybe<Scalars['BigInt']['input']>;
  assets_lte?: InputMaybe<Scalars['BigInt']['input']>;
  assets_not?: InputMaybe<Scalars['BigInt']['input']>;
  assets_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockNumber?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_gt?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_gte?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockNumber_lt?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_lte?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_not?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockTimestamp?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_gt?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_gte?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockTimestamp_lt?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_lte?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_not?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  hypoVault?: InputMaybe<Scalars['String']['input']>;
  hypoVault_?: InputMaybe<HypoVault_Filter>;
  hypoVault_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_lt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_lte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['Bytes']['input']>;
  id_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_gt?: InputMaybe<Scalars['Bytes']['input']>;
  id_gte?: InputMaybe<Scalars['Bytes']['input']>;
  id_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  id_lt?: InputMaybe<Scalars['Bytes']['input']>;
  id_lte?: InputMaybe<Scalars['Bytes']['input']>;
  id_not?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  or?: InputMaybe<Array<InputMaybe<DepositCancelled_Filter>>>;
  transactionHash?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_contains?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_gt?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_gte?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  transactionHash_lt?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_lte?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  user?: InputMaybe<Scalars['String']['input']>;
  user_?: InputMaybe<Account_Filter>;
  user_contains?: InputMaybe<Scalars['String']['input']>;
  user_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  user_ends_with?: InputMaybe<Scalars['String']['input']>;
  user_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  user_gt?: InputMaybe<Scalars['String']['input']>;
  user_gte?: InputMaybe<Scalars['String']['input']>;
  user_in?: InputMaybe<Array<Scalars['String']['input']>>;
  user_lt?: InputMaybe<Scalars['String']['input']>;
  user_lte?: InputMaybe<Scalars['String']['input']>;
  user_not?: InputMaybe<Scalars['String']['input']>;
  user_not_contains?: InputMaybe<Scalars['String']['input']>;
  user_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  user_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  user_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  user_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  user_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  user_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  user_starts_with?: InputMaybe<Scalars['String']['input']>;
  user_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
}

export enum DepositCancelled_OrderBy {
  Assets = 'assets',
  BlockNumber = 'blockNumber',
  BlockTimestamp = 'blockTimestamp',
  HypoVault = 'hypoVault',
  HypoVaultAccountant = 'hypoVault__accountant',
  HypoVaultCreatedAt = 'hypoVault__createdAt',
  HypoVaultCreatedAtBlock = 'hypoVault__createdAtBlock',
  HypoVaultDepositEpoch = 'hypoVault__depositEpoch',
  HypoVaultFeeWallet = 'hypoVault__feeWallet',
  HypoVaultId = 'hypoVault__id',
  HypoVaultManager = 'hypoVault__manager',
  HypoVaultName = 'hypoVault__name',
  HypoVaultOwner = 'hypoVault__owner',
  HypoVaultPerformanceFeeBps = 'hypoVault__performanceFeeBps',
  HypoVaultReservedWithdrawalAssets = 'hypoVault__reservedWithdrawalAssets',
  HypoVaultShares = 'hypoVault__shares',
  HypoVaultSymbol = 'hypoVault__symbol',
  HypoVaultTotalAssetsDeposited = 'hypoVault__totalAssetsDeposited',
  HypoVaultTotalAssetsWithdrawn = 'hypoVault__totalAssetsWithdrawn',
  HypoVaultTotalPerformanceFeesCollected = 'hypoVault__totalPerformanceFeesCollected',
  HypoVaultUpdatedAt = 'hypoVault__updatedAt',
  HypoVaultUpdatedAtBlock = 'hypoVault__updatedAtBlock',
  HypoVaultWithdrawalEpoch = 'hypoVault__withdrawalEpoch',
  Id = 'id',
  TransactionHash = 'transactionHash',
  User = 'user',
  UserId = 'user__id'
}

export interface DepositEpochState {
  __typename?: 'DepositEpochState';
  assetsDeposited: Scalars['BigInt']['output'];
  assetsFulfilled: Scalars['BigInt']['output'];
  epoch: Scalars['BigInt']['output'];
  hypoVault: HypoVault;
  /**  Byte concatenation of hypoVault + deposit epoch  */
  id: Scalars['Bytes']['output'];
  sharesReceived: Scalars['BigInt']['output'];
}

export interface DepositEpochState_Filter {
  /** Filter for the block changed event. */
  _change_block?: InputMaybe<BlockChangedFilter>;
  and?: InputMaybe<Array<InputMaybe<DepositEpochState_Filter>>>;
  assetsDeposited?: InputMaybe<Scalars['BigInt']['input']>;
  assetsDeposited_gt?: InputMaybe<Scalars['BigInt']['input']>;
  assetsDeposited_gte?: InputMaybe<Scalars['BigInt']['input']>;
  assetsDeposited_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  assetsDeposited_lt?: InputMaybe<Scalars['BigInt']['input']>;
  assetsDeposited_lte?: InputMaybe<Scalars['BigInt']['input']>;
  assetsDeposited_not?: InputMaybe<Scalars['BigInt']['input']>;
  assetsDeposited_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  assetsFulfilled?: InputMaybe<Scalars['BigInt']['input']>;
  assetsFulfilled_gt?: InputMaybe<Scalars['BigInt']['input']>;
  assetsFulfilled_gte?: InputMaybe<Scalars['BigInt']['input']>;
  assetsFulfilled_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  assetsFulfilled_lt?: InputMaybe<Scalars['BigInt']['input']>;
  assetsFulfilled_lte?: InputMaybe<Scalars['BigInt']['input']>;
  assetsFulfilled_not?: InputMaybe<Scalars['BigInt']['input']>;
  assetsFulfilled_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  epoch?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_gt?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_gte?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  epoch_lt?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_lte?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_not?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  hypoVault?: InputMaybe<Scalars['String']['input']>;
  hypoVault_?: InputMaybe<HypoVault_Filter>;
  hypoVault_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_lt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_lte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['Bytes']['input']>;
  id_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_gt?: InputMaybe<Scalars['Bytes']['input']>;
  id_gte?: InputMaybe<Scalars['Bytes']['input']>;
  id_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  id_lt?: InputMaybe<Scalars['Bytes']['input']>;
  id_lte?: InputMaybe<Scalars['Bytes']['input']>;
  id_not?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  or?: InputMaybe<Array<InputMaybe<DepositEpochState_Filter>>>;
  sharesReceived?: InputMaybe<Scalars['BigInt']['input']>;
  sharesReceived_gt?: InputMaybe<Scalars['BigInt']['input']>;
  sharesReceived_gte?: InputMaybe<Scalars['BigInt']['input']>;
  sharesReceived_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  sharesReceived_lt?: InputMaybe<Scalars['BigInt']['input']>;
  sharesReceived_lte?: InputMaybe<Scalars['BigInt']['input']>;
  sharesReceived_not?: InputMaybe<Scalars['BigInt']['input']>;
  sharesReceived_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
}

export enum DepositEpochState_OrderBy {
  AssetsDeposited = 'assetsDeposited',
  AssetsFulfilled = 'assetsFulfilled',
  Epoch = 'epoch',
  HypoVault = 'hypoVault',
  HypoVaultAccountant = 'hypoVault__accountant',
  HypoVaultCreatedAt = 'hypoVault__createdAt',
  HypoVaultCreatedAtBlock = 'hypoVault__createdAtBlock',
  HypoVaultDepositEpoch = 'hypoVault__depositEpoch',
  HypoVaultFeeWallet = 'hypoVault__feeWallet',
  HypoVaultId = 'hypoVault__id',
  HypoVaultManager = 'hypoVault__manager',
  HypoVaultName = 'hypoVault__name',
  HypoVaultOwner = 'hypoVault__owner',
  HypoVaultPerformanceFeeBps = 'hypoVault__performanceFeeBps',
  HypoVaultReservedWithdrawalAssets = 'hypoVault__reservedWithdrawalAssets',
  HypoVaultShares = 'hypoVault__shares',
  HypoVaultSymbol = 'hypoVault__symbol',
  HypoVaultTotalAssetsDeposited = 'hypoVault__totalAssetsDeposited',
  HypoVaultTotalAssetsWithdrawn = 'hypoVault__totalAssetsWithdrawn',
  HypoVaultTotalPerformanceFeesCollected = 'hypoVault__totalPerformanceFeesCollected',
  HypoVaultUpdatedAt = 'hypoVault__updatedAt',
  HypoVaultUpdatedAtBlock = 'hypoVault__updatedAtBlock',
  HypoVaultWithdrawalEpoch = 'hypoVault__withdrawalEpoch',
  Id = 'id',
  SharesReceived = 'sharesReceived'
}

export interface DepositExecuted {
  __typename?: 'DepositExecuted';
  assets: Scalars['BigInt']['output'];
  blockNumber: Scalars['BigInt']['output'];
  blockTimestamp: Scalars['BigInt']['output'];
  epoch: Scalars['BigInt']['output'];
  hypoVault: HypoVault;
  id: Scalars['Bytes']['output'];
  shares: Scalars['BigInt']['output'];
  transactionHash: Scalars['Bytes']['output'];
  user: Account;
}

export interface DepositExecuted_Filter {
  /** Filter for the block changed event. */
  _change_block?: InputMaybe<BlockChangedFilter>;
  and?: InputMaybe<Array<InputMaybe<DepositExecuted_Filter>>>;
  assets?: InputMaybe<Scalars['BigInt']['input']>;
  assets_gt?: InputMaybe<Scalars['BigInt']['input']>;
  assets_gte?: InputMaybe<Scalars['BigInt']['input']>;
  assets_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  assets_lt?: InputMaybe<Scalars['BigInt']['input']>;
  assets_lte?: InputMaybe<Scalars['BigInt']['input']>;
  assets_not?: InputMaybe<Scalars['BigInt']['input']>;
  assets_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockNumber?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_gt?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_gte?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockNumber_lt?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_lte?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_not?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockTimestamp?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_gt?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_gte?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockTimestamp_lt?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_lte?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_not?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  epoch?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_gt?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_gte?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  epoch_lt?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_lte?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_not?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  hypoVault?: InputMaybe<Scalars['String']['input']>;
  hypoVault_?: InputMaybe<HypoVault_Filter>;
  hypoVault_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_lt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_lte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['Bytes']['input']>;
  id_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_gt?: InputMaybe<Scalars['Bytes']['input']>;
  id_gte?: InputMaybe<Scalars['Bytes']['input']>;
  id_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  id_lt?: InputMaybe<Scalars['Bytes']['input']>;
  id_lte?: InputMaybe<Scalars['Bytes']['input']>;
  id_not?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  or?: InputMaybe<Array<InputMaybe<DepositExecuted_Filter>>>;
  shares?: InputMaybe<Scalars['BigInt']['input']>;
  shares_gt?: InputMaybe<Scalars['BigInt']['input']>;
  shares_gte?: InputMaybe<Scalars['BigInt']['input']>;
  shares_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  shares_lt?: InputMaybe<Scalars['BigInt']['input']>;
  shares_lte?: InputMaybe<Scalars['BigInt']['input']>;
  shares_not?: InputMaybe<Scalars['BigInt']['input']>;
  shares_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  transactionHash?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_contains?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_gt?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_gte?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  transactionHash_lt?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_lte?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  user?: InputMaybe<Scalars['String']['input']>;
  user_?: InputMaybe<Account_Filter>;
  user_contains?: InputMaybe<Scalars['String']['input']>;
  user_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  user_ends_with?: InputMaybe<Scalars['String']['input']>;
  user_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  user_gt?: InputMaybe<Scalars['String']['input']>;
  user_gte?: InputMaybe<Scalars['String']['input']>;
  user_in?: InputMaybe<Array<Scalars['String']['input']>>;
  user_lt?: InputMaybe<Scalars['String']['input']>;
  user_lte?: InputMaybe<Scalars['String']['input']>;
  user_not?: InputMaybe<Scalars['String']['input']>;
  user_not_contains?: InputMaybe<Scalars['String']['input']>;
  user_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  user_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  user_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  user_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  user_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  user_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  user_starts_with?: InputMaybe<Scalars['String']['input']>;
  user_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
}

export enum DepositExecuted_OrderBy {
  Assets = 'assets',
  BlockNumber = 'blockNumber',
  BlockTimestamp = 'blockTimestamp',
  Epoch = 'epoch',
  HypoVault = 'hypoVault',
  HypoVaultAccountant = 'hypoVault__accountant',
  HypoVaultCreatedAt = 'hypoVault__createdAt',
  HypoVaultCreatedAtBlock = 'hypoVault__createdAtBlock',
  HypoVaultDepositEpoch = 'hypoVault__depositEpoch',
  HypoVaultFeeWallet = 'hypoVault__feeWallet',
  HypoVaultId = 'hypoVault__id',
  HypoVaultManager = 'hypoVault__manager',
  HypoVaultName = 'hypoVault__name',
  HypoVaultOwner = 'hypoVault__owner',
  HypoVaultPerformanceFeeBps = 'hypoVault__performanceFeeBps',
  HypoVaultReservedWithdrawalAssets = 'hypoVault__reservedWithdrawalAssets',
  HypoVaultShares = 'hypoVault__shares',
  HypoVaultSymbol = 'hypoVault__symbol',
  HypoVaultTotalAssetsDeposited = 'hypoVault__totalAssetsDeposited',
  HypoVaultTotalAssetsWithdrawn = 'hypoVault__totalAssetsWithdrawn',
  HypoVaultTotalPerformanceFeesCollected = 'hypoVault__totalPerformanceFeesCollected',
  HypoVaultUpdatedAt = 'hypoVault__updatedAt',
  HypoVaultUpdatedAtBlock = 'hypoVault__updatedAtBlock',
  HypoVaultWithdrawalEpoch = 'hypoVault__withdrawalEpoch',
  Id = 'id',
  Shares = 'shares',
  TransactionHash = 'transactionHash',
  User = 'user',
  UserId = 'user__id'
}

export interface DepositRequested {
  __typename?: 'DepositRequested';
  assets: Scalars['BigInt']['output'];
  blockNumber: Scalars['BigInt']['output'];
  blockTimestamp: Scalars['BigInt']['output'];
  hypoVault: HypoVault;
  id: Scalars['Bytes']['output'];
  transactionHash: Scalars['Bytes']['output'];
  user: Account;
}

export interface DepositRequested_Filter {
  /** Filter for the block changed event. */
  _change_block?: InputMaybe<BlockChangedFilter>;
  and?: InputMaybe<Array<InputMaybe<DepositRequested_Filter>>>;
  assets?: InputMaybe<Scalars['BigInt']['input']>;
  assets_gt?: InputMaybe<Scalars['BigInt']['input']>;
  assets_gte?: InputMaybe<Scalars['BigInt']['input']>;
  assets_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  assets_lt?: InputMaybe<Scalars['BigInt']['input']>;
  assets_lte?: InputMaybe<Scalars['BigInt']['input']>;
  assets_not?: InputMaybe<Scalars['BigInt']['input']>;
  assets_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockNumber?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_gt?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_gte?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockNumber_lt?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_lte?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_not?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockTimestamp?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_gt?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_gte?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockTimestamp_lt?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_lte?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_not?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  hypoVault?: InputMaybe<Scalars['String']['input']>;
  hypoVault_?: InputMaybe<HypoVault_Filter>;
  hypoVault_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_lt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_lte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['Bytes']['input']>;
  id_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_gt?: InputMaybe<Scalars['Bytes']['input']>;
  id_gte?: InputMaybe<Scalars['Bytes']['input']>;
  id_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  id_lt?: InputMaybe<Scalars['Bytes']['input']>;
  id_lte?: InputMaybe<Scalars['Bytes']['input']>;
  id_not?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  or?: InputMaybe<Array<InputMaybe<DepositRequested_Filter>>>;
  transactionHash?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_contains?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_gt?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_gte?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  transactionHash_lt?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_lte?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  user?: InputMaybe<Scalars['String']['input']>;
  user_?: InputMaybe<Account_Filter>;
  user_contains?: InputMaybe<Scalars['String']['input']>;
  user_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  user_ends_with?: InputMaybe<Scalars['String']['input']>;
  user_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  user_gt?: InputMaybe<Scalars['String']['input']>;
  user_gte?: InputMaybe<Scalars['String']['input']>;
  user_in?: InputMaybe<Array<Scalars['String']['input']>>;
  user_lt?: InputMaybe<Scalars['String']['input']>;
  user_lte?: InputMaybe<Scalars['String']['input']>;
  user_not?: InputMaybe<Scalars['String']['input']>;
  user_not_contains?: InputMaybe<Scalars['String']['input']>;
  user_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  user_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  user_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  user_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  user_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  user_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  user_starts_with?: InputMaybe<Scalars['String']['input']>;
  user_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
}

export enum DepositRequested_OrderBy {
  Assets = 'assets',
  BlockNumber = 'blockNumber',
  BlockTimestamp = 'blockTimestamp',
  HypoVault = 'hypoVault',
  HypoVaultAccountant = 'hypoVault__accountant',
  HypoVaultCreatedAt = 'hypoVault__createdAt',
  HypoVaultCreatedAtBlock = 'hypoVault__createdAtBlock',
  HypoVaultDepositEpoch = 'hypoVault__depositEpoch',
  HypoVaultFeeWallet = 'hypoVault__feeWallet',
  HypoVaultId = 'hypoVault__id',
  HypoVaultManager = 'hypoVault__manager',
  HypoVaultName = 'hypoVault__name',
  HypoVaultOwner = 'hypoVault__owner',
  HypoVaultPerformanceFeeBps = 'hypoVault__performanceFeeBps',
  HypoVaultReservedWithdrawalAssets = 'hypoVault__reservedWithdrawalAssets',
  HypoVaultShares = 'hypoVault__shares',
  HypoVaultSymbol = 'hypoVault__symbol',
  HypoVaultTotalAssetsDeposited = 'hypoVault__totalAssetsDeposited',
  HypoVaultTotalAssetsWithdrawn = 'hypoVault__totalAssetsWithdrawn',
  HypoVaultTotalPerformanceFeesCollected = 'hypoVault__totalPerformanceFeesCollected',
  HypoVaultUpdatedAt = 'hypoVault__updatedAt',
  HypoVaultUpdatedAtBlock = 'hypoVault__updatedAtBlock',
  HypoVaultWithdrawalEpoch = 'hypoVault__withdrawalEpoch',
  Id = 'id',
  TransactionHash = 'transactionHash',
  User = 'user',
  UserId = 'user__id'
}

export interface DepositsFulfilled {
  __typename?: 'DepositsFulfilled';
  assetsFulfilled: Scalars['BigInt']['output'];
  blockNumber: Scalars['BigInt']['output'];
  blockTimestamp: Scalars['BigInt']['output'];
  hypoVault: HypoVault;
  id: Scalars['Bytes']['output'];
  nextEpoch: Scalars['BigInt']['output'];
  sharesReceived: Scalars['BigInt']['output'];
  transactionHash: Scalars['Bytes']['output'];
}

export interface DepositsFulfilled_Filter {
  /** Filter for the block changed event. */
  _change_block?: InputMaybe<BlockChangedFilter>;
  and?: InputMaybe<Array<InputMaybe<DepositsFulfilled_Filter>>>;
  assetsFulfilled?: InputMaybe<Scalars['BigInt']['input']>;
  assetsFulfilled_gt?: InputMaybe<Scalars['BigInt']['input']>;
  assetsFulfilled_gte?: InputMaybe<Scalars['BigInt']['input']>;
  assetsFulfilled_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  assetsFulfilled_lt?: InputMaybe<Scalars['BigInt']['input']>;
  assetsFulfilled_lte?: InputMaybe<Scalars['BigInt']['input']>;
  assetsFulfilled_not?: InputMaybe<Scalars['BigInt']['input']>;
  assetsFulfilled_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockNumber?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_gt?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_gte?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockNumber_lt?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_lte?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_not?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockTimestamp?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_gt?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_gte?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockTimestamp_lt?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_lte?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_not?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  hypoVault?: InputMaybe<Scalars['String']['input']>;
  hypoVault_?: InputMaybe<HypoVault_Filter>;
  hypoVault_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_lt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_lte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['Bytes']['input']>;
  id_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_gt?: InputMaybe<Scalars['Bytes']['input']>;
  id_gte?: InputMaybe<Scalars['Bytes']['input']>;
  id_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  id_lt?: InputMaybe<Scalars['Bytes']['input']>;
  id_lte?: InputMaybe<Scalars['Bytes']['input']>;
  id_not?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  nextEpoch?: InputMaybe<Scalars['BigInt']['input']>;
  nextEpoch_gt?: InputMaybe<Scalars['BigInt']['input']>;
  nextEpoch_gte?: InputMaybe<Scalars['BigInt']['input']>;
  nextEpoch_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  nextEpoch_lt?: InputMaybe<Scalars['BigInt']['input']>;
  nextEpoch_lte?: InputMaybe<Scalars['BigInt']['input']>;
  nextEpoch_not?: InputMaybe<Scalars['BigInt']['input']>;
  nextEpoch_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  or?: InputMaybe<Array<InputMaybe<DepositsFulfilled_Filter>>>;
  sharesReceived?: InputMaybe<Scalars['BigInt']['input']>;
  sharesReceived_gt?: InputMaybe<Scalars['BigInt']['input']>;
  sharesReceived_gte?: InputMaybe<Scalars['BigInt']['input']>;
  sharesReceived_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  sharesReceived_lt?: InputMaybe<Scalars['BigInt']['input']>;
  sharesReceived_lte?: InputMaybe<Scalars['BigInt']['input']>;
  sharesReceived_not?: InputMaybe<Scalars['BigInt']['input']>;
  sharesReceived_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  transactionHash?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_contains?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_gt?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_gte?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  transactionHash_lt?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_lte?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
}

export enum DepositsFulfilled_OrderBy {
  AssetsFulfilled = 'assetsFulfilled',
  BlockNumber = 'blockNumber',
  BlockTimestamp = 'blockTimestamp',
  HypoVault = 'hypoVault',
  HypoVaultAccountant = 'hypoVault__accountant',
  HypoVaultCreatedAt = 'hypoVault__createdAt',
  HypoVaultCreatedAtBlock = 'hypoVault__createdAtBlock',
  HypoVaultDepositEpoch = 'hypoVault__depositEpoch',
  HypoVaultFeeWallet = 'hypoVault__feeWallet',
  HypoVaultId = 'hypoVault__id',
  HypoVaultManager = 'hypoVault__manager',
  HypoVaultName = 'hypoVault__name',
  HypoVaultOwner = 'hypoVault__owner',
  HypoVaultPerformanceFeeBps = 'hypoVault__performanceFeeBps',
  HypoVaultReservedWithdrawalAssets = 'hypoVault__reservedWithdrawalAssets',
  HypoVaultShares = 'hypoVault__shares',
  HypoVaultSymbol = 'hypoVault__symbol',
  HypoVaultTotalAssetsDeposited = 'hypoVault__totalAssetsDeposited',
  HypoVaultTotalAssetsWithdrawn = 'hypoVault__totalAssetsWithdrawn',
  HypoVaultTotalPerformanceFeesCollected = 'hypoVault__totalPerformanceFeesCollected',
  HypoVaultUpdatedAt = 'hypoVault__updatedAt',
  HypoVaultUpdatedAtBlock = 'hypoVault__updatedAtBlock',
  HypoVaultWithdrawalEpoch = 'hypoVault__withdrawalEpoch',
  Id = 'id',
  NextEpoch = 'nextEpoch',
  SharesReceived = 'sharesReceived',
  TransactionHash = 'transactionHash'
}

export interface FeeWalletUpdated {
  __typename?: 'FeeWalletUpdated';
  blockNumber: Scalars['BigInt']['output'];
  blockTimestamp: Scalars['BigInt']['output'];
  hypoVault: HypoVault;
  id: Scalars['Bytes']['output'];
  newFeeWallet: Scalars['Bytes']['output'];
  oldFeeWallet: Scalars['Bytes']['output'];
  transactionHash: Scalars['Bytes']['output'];
}

export interface FeeWalletUpdated_Filter {
  /** Filter for the block changed event. */
  _change_block?: InputMaybe<BlockChangedFilter>;
  and?: InputMaybe<Array<InputMaybe<FeeWalletUpdated_Filter>>>;
  blockNumber?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_gt?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_gte?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockNumber_lt?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_lte?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_not?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockTimestamp?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_gt?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_gte?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockTimestamp_lt?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_lte?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_not?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  hypoVault?: InputMaybe<Scalars['String']['input']>;
  hypoVault_?: InputMaybe<HypoVault_Filter>;
  hypoVault_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_lt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_lte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['Bytes']['input']>;
  id_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_gt?: InputMaybe<Scalars['Bytes']['input']>;
  id_gte?: InputMaybe<Scalars['Bytes']['input']>;
  id_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  id_lt?: InputMaybe<Scalars['Bytes']['input']>;
  id_lte?: InputMaybe<Scalars['Bytes']['input']>;
  id_not?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  newFeeWallet?: InputMaybe<Scalars['Bytes']['input']>;
  newFeeWallet_contains?: InputMaybe<Scalars['Bytes']['input']>;
  newFeeWallet_gt?: InputMaybe<Scalars['Bytes']['input']>;
  newFeeWallet_gte?: InputMaybe<Scalars['Bytes']['input']>;
  newFeeWallet_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  newFeeWallet_lt?: InputMaybe<Scalars['Bytes']['input']>;
  newFeeWallet_lte?: InputMaybe<Scalars['Bytes']['input']>;
  newFeeWallet_not?: InputMaybe<Scalars['Bytes']['input']>;
  newFeeWallet_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  newFeeWallet_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  oldFeeWallet?: InputMaybe<Scalars['Bytes']['input']>;
  oldFeeWallet_contains?: InputMaybe<Scalars['Bytes']['input']>;
  oldFeeWallet_gt?: InputMaybe<Scalars['Bytes']['input']>;
  oldFeeWallet_gte?: InputMaybe<Scalars['Bytes']['input']>;
  oldFeeWallet_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  oldFeeWallet_lt?: InputMaybe<Scalars['Bytes']['input']>;
  oldFeeWallet_lte?: InputMaybe<Scalars['Bytes']['input']>;
  oldFeeWallet_not?: InputMaybe<Scalars['Bytes']['input']>;
  oldFeeWallet_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  oldFeeWallet_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  or?: InputMaybe<Array<InputMaybe<FeeWalletUpdated_Filter>>>;
  transactionHash?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_contains?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_gt?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_gte?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  transactionHash_lt?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_lte?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
}

export enum FeeWalletUpdated_OrderBy {
  BlockNumber = 'blockNumber',
  BlockTimestamp = 'blockTimestamp',
  HypoVault = 'hypoVault',
  HypoVaultAccountant = 'hypoVault__accountant',
  HypoVaultCreatedAt = 'hypoVault__createdAt',
  HypoVaultCreatedAtBlock = 'hypoVault__createdAtBlock',
  HypoVaultDepositEpoch = 'hypoVault__depositEpoch',
  HypoVaultFeeWallet = 'hypoVault__feeWallet',
  HypoVaultId = 'hypoVault__id',
  HypoVaultManager = 'hypoVault__manager',
  HypoVaultName = 'hypoVault__name',
  HypoVaultOwner = 'hypoVault__owner',
  HypoVaultPerformanceFeeBps = 'hypoVault__performanceFeeBps',
  HypoVaultReservedWithdrawalAssets = 'hypoVault__reservedWithdrawalAssets',
  HypoVaultShares = 'hypoVault__shares',
  HypoVaultSymbol = 'hypoVault__symbol',
  HypoVaultTotalAssetsDeposited = 'hypoVault__totalAssetsDeposited',
  HypoVaultTotalAssetsWithdrawn = 'hypoVault__totalAssetsWithdrawn',
  HypoVaultTotalPerformanceFeesCollected = 'hypoVault__totalPerformanceFeesCollected',
  HypoVaultUpdatedAt = 'hypoVault__updatedAt',
  HypoVaultUpdatedAtBlock = 'hypoVault__updatedAtBlock',
  HypoVaultWithdrawalEpoch = 'hypoVault__withdrawalEpoch',
  Id = 'id',
  NewFeeWallet = 'newFeeWallet',
  OldFeeWallet = 'oldFeeWallet',
  TransactionHash = 'transactionHash'
}

/**  A vault in which a manager allocates assets deposited by users and distributes profits asynchronously.  */
export interface HypoVault {
  __typename?: 'HypoVault';
  /**  Contract that reports the net asset value of the vault.  */
  accountant: Scalars['Bytes']['output'];
  createdAt: Scalars['BigInt']['output'];
  createdAtBlock: Scalars['BigInt']['output'];
  /**  Epoch number for which deposits are currently being executed.  */
  depositEpoch: Scalars['BigInt']['output'];
  /**  Contains information about the quantity of assets requested and fulfilled for deposits in each epoch.  */
  depositEpochStates: Array<DepositEpochState>;
  /**  Wallet that receives the performance fee.  */
  feeWallet: Scalars['Bytes']['output'];
  /**  Address of vault  */
  id: Scalars['Bytes']['output'];
  /**  Account authorized to execute deposits, withdrawals, and make arbitrary function calls from the vault.  */
  manager: Scalars['Bytes']['output'];
  /**  Name of the vault's ERC20 share token  */
  name: Scalars['String']['output'];
  /**  Owner of the HypoVault  */
  owner: Scalars['Bytes']['output'];
  /**  Performance fee, in basis points, taken on each profitable withdrawal.  */
  performanceFeeBps: Scalars['BigInt']['output'];
  /**  Records the states of deposit requests for a user in a given epoch.  */
  queuedDeposits: Array<QueuedDeposit>;
  /**  Records the states of deposit requests for a user in a given epoch.  */
  queuedWithdrawals: Array<QueuedWithdrawal>;
  /**  Assets in the vault reserved for fulfilled withdrawal requests.  */
  reservedWithdrawalAssets: Scalars['BigInt']['output'];
  /**  Total supply of this HypoVault's ERC20 share token  */
  shares: Scalars['BigInt']['output'];
  /**  Symbol of the vault's ERC20 share token  */
  symbol: Scalars['String']['output'];
  /**  Running count of all underlying tokens deposited in the vault. Increased on every DepositRequested, decreased on every DepositCancelled.  */
  totalAssetsDeposited: Scalars['BigInt']['output'];
  /**  Running count of all underlying tokens withdrawn from the vault. Increased on every WithdrawalExecuted.  */
  totalAssetsWithdrawn: Scalars['BigInt']['output'];
  /**  All performance fees collected from withdrawal executions.  */
  totalPerformanceFeesCollected: Scalars['BigInt']['output'];
  /**  Token used to denominate deposits and withdrawals.  */
  underlyingToken: Token;
  updatedAt: Scalars['BigInt']['output'];
  updatedAtBlock: Scalars['BigInt']['output'];
  /**  All user share balances for this hypovault.  */
  userBalances: Array<UserBalance>;
  /**  All user bases within the HypoVault  */
  userBases: Array<UserBasis>;
  /**  Epoch number for which withdrawals are currently being executed.  */
  withdrawalEpoch: Scalars['BigInt']['output'];
  /**  Contains information about the quantity of shares requested and fulfilled for withdrawals in each epoch.  */
  withdrawalEpochStates: Array<WithdrawalEpochState>;
}


/**  A vault in which a manager allocates assets deposited by users and distributes profits asynchronously.  */
export interface HypoVaultDepositEpochStatesArgs {
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<DepositEpochState_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  where?: InputMaybe<DepositEpochState_Filter>;
}


/**  A vault in which a manager allocates assets deposited by users and distributes profits asynchronously.  */
export interface HypoVaultQueuedDepositsArgs {
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<QueuedDeposit_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  where?: InputMaybe<QueuedDeposit_Filter>;
}


/**  A vault in which a manager allocates assets deposited by users and distributes profits asynchronously.  */
export interface HypoVaultQueuedWithdrawalsArgs {
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<QueuedWithdrawal_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  where?: InputMaybe<QueuedWithdrawal_Filter>;
}


/**  A vault in which a manager allocates assets deposited by users and distributes profits asynchronously.  */
export interface HypoVaultUserBalancesArgs {
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<UserBalance_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  where?: InputMaybe<UserBalance_Filter>;
}


/**  A vault in which a manager allocates assets deposited by users and distributes profits asynchronously.  */
export interface HypoVaultUserBasesArgs {
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<UserBasis_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  where?: InputMaybe<UserBasis_Filter>;
}


/**  A vault in which a manager allocates assets deposited by users and distributes profits asynchronously.  */
export interface HypoVaultWithdrawalEpochStatesArgs {
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<WithdrawalEpochState_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  where?: InputMaybe<WithdrawalEpochState_Filter>;
}

export interface HypoVaultFactory {
  __typename?: 'HypoVaultFactory';
  createdAtBlock: Scalars['BigInt']['output'];
  createdAtTimestamp: Scalars['BigInt']['output'];
  id: Scalars['Bytes']['output'];
  poolUniverseInitialized: Scalars['Boolean']['output'];
  vaultCount: Scalars['BigInt']['output'];
}

export interface HypoVaultFactory_Filter {
  /** Filter for the block changed event. */
  _change_block?: InputMaybe<BlockChangedFilter>;
  and?: InputMaybe<Array<InputMaybe<HypoVaultFactory_Filter>>>;
  createdAtBlock?: InputMaybe<Scalars['BigInt']['input']>;
  createdAtBlock_gt?: InputMaybe<Scalars['BigInt']['input']>;
  createdAtBlock_gte?: InputMaybe<Scalars['BigInt']['input']>;
  createdAtBlock_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  createdAtBlock_lt?: InputMaybe<Scalars['BigInt']['input']>;
  createdAtBlock_lte?: InputMaybe<Scalars['BigInt']['input']>;
  createdAtBlock_not?: InputMaybe<Scalars['BigInt']['input']>;
  createdAtBlock_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  createdAtTimestamp?: InputMaybe<Scalars['BigInt']['input']>;
  createdAtTimestamp_gt?: InputMaybe<Scalars['BigInt']['input']>;
  createdAtTimestamp_gte?: InputMaybe<Scalars['BigInt']['input']>;
  createdAtTimestamp_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  createdAtTimestamp_lt?: InputMaybe<Scalars['BigInt']['input']>;
  createdAtTimestamp_lte?: InputMaybe<Scalars['BigInt']['input']>;
  createdAtTimestamp_not?: InputMaybe<Scalars['BigInt']['input']>;
  createdAtTimestamp_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  id?: InputMaybe<Scalars['Bytes']['input']>;
  id_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_gt?: InputMaybe<Scalars['Bytes']['input']>;
  id_gte?: InputMaybe<Scalars['Bytes']['input']>;
  id_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  id_lt?: InputMaybe<Scalars['Bytes']['input']>;
  id_lte?: InputMaybe<Scalars['Bytes']['input']>;
  id_not?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  or?: InputMaybe<Array<InputMaybe<HypoVaultFactory_Filter>>>;
  poolUniverseInitialized?: InputMaybe<Scalars['Boolean']['input']>;
  poolUniverseInitialized_in?: InputMaybe<Array<Scalars['Boolean']['input']>>;
  poolUniverseInitialized_not?: InputMaybe<Scalars['Boolean']['input']>;
  poolUniverseInitialized_not_in?: InputMaybe<Array<Scalars['Boolean']['input']>>;
  vaultCount?: InputMaybe<Scalars['BigInt']['input']>;
  vaultCount_gt?: InputMaybe<Scalars['BigInt']['input']>;
  vaultCount_gte?: InputMaybe<Scalars['BigInt']['input']>;
  vaultCount_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  vaultCount_lt?: InputMaybe<Scalars['BigInt']['input']>;
  vaultCount_lte?: InputMaybe<Scalars['BigInt']['input']>;
  vaultCount_not?: InputMaybe<Scalars['BigInt']['input']>;
  vaultCount_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
}

export enum HypoVaultFactory_OrderBy {
  CreatedAtBlock = 'createdAtBlock',
  CreatedAtTimestamp = 'createdAtTimestamp',
  Id = 'id',
  PoolUniverseInitialized = 'poolUniverseInitialized',
  VaultCount = 'vaultCount'
}

export interface HypoVault_Filter {
  /** Filter for the block changed event. */
  _change_block?: InputMaybe<BlockChangedFilter>;
  accountant?: InputMaybe<Scalars['Bytes']['input']>;
  accountant_contains?: InputMaybe<Scalars['Bytes']['input']>;
  accountant_gt?: InputMaybe<Scalars['Bytes']['input']>;
  accountant_gte?: InputMaybe<Scalars['Bytes']['input']>;
  accountant_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  accountant_lt?: InputMaybe<Scalars['Bytes']['input']>;
  accountant_lte?: InputMaybe<Scalars['Bytes']['input']>;
  accountant_not?: InputMaybe<Scalars['Bytes']['input']>;
  accountant_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  accountant_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  and?: InputMaybe<Array<InputMaybe<HypoVault_Filter>>>;
  createdAt?: InputMaybe<Scalars['BigInt']['input']>;
  createdAtBlock?: InputMaybe<Scalars['BigInt']['input']>;
  createdAtBlock_gt?: InputMaybe<Scalars['BigInt']['input']>;
  createdAtBlock_gte?: InputMaybe<Scalars['BigInt']['input']>;
  createdAtBlock_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  createdAtBlock_lt?: InputMaybe<Scalars['BigInt']['input']>;
  createdAtBlock_lte?: InputMaybe<Scalars['BigInt']['input']>;
  createdAtBlock_not?: InputMaybe<Scalars['BigInt']['input']>;
  createdAtBlock_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  createdAt_gt?: InputMaybe<Scalars['BigInt']['input']>;
  createdAt_gte?: InputMaybe<Scalars['BigInt']['input']>;
  createdAt_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  createdAt_lt?: InputMaybe<Scalars['BigInt']['input']>;
  createdAt_lte?: InputMaybe<Scalars['BigInt']['input']>;
  createdAt_not?: InputMaybe<Scalars['BigInt']['input']>;
  createdAt_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  depositEpoch?: InputMaybe<Scalars['BigInt']['input']>;
  depositEpochStates_?: InputMaybe<DepositEpochState_Filter>;
  depositEpoch_gt?: InputMaybe<Scalars['BigInt']['input']>;
  depositEpoch_gte?: InputMaybe<Scalars['BigInt']['input']>;
  depositEpoch_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  depositEpoch_lt?: InputMaybe<Scalars['BigInt']['input']>;
  depositEpoch_lte?: InputMaybe<Scalars['BigInt']['input']>;
  depositEpoch_not?: InputMaybe<Scalars['BigInt']['input']>;
  depositEpoch_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  feeWallet?: InputMaybe<Scalars['Bytes']['input']>;
  feeWallet_contains?: InputMaybe<Scalars['Bytes']['input']>;
  feeWallet_gt?: InputMaybe<Scalars['Bytes']['input']>;
  feeWallet_gte?: InputMaybe<Scalars['Bytes']['input']>;
  feeWallet_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  feeWallet_lt?: InputMaybe<Scalars['Bytes']['input']>;
  feeWallet_lte?: InputMaybe<Scalars['Bytes']['input']>;
  feeWallet_not?: InputMaybe<Scalars['Bytes']['input']>;
  feeWallet_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  feeWallet_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  id?: InputMaybe<Scalars['Bytes']['input']>;
  id_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_gt?: InputMaybe<Scalars['Bytes']['input']>;
  id_gte?: InputMaybe<Scalars['Bytes']['input']>;
  id_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  id_lt?: InputMaybe<Scalars['Bytes']['input']>;
  id_lte?: InputMaybe<Scalars['Bytes']['input']>;
  id_not?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  manager?: InputMaybe<Scalars['Bytes']['input']>;
  manager_contains?: InputMaybe<Scalars['Bytes']['input']>;
  manager_gt?: InputMaybe<Scalars['Bytes']['input']>;
  manager_gte?: InputMaybe<Scalars['Bytes']['input']>;
  manager_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  manager_lt?: InputMaybe<Scalars['Bytes']['input']>;
  manager_lte?: InputMaybe<Scalars['Bytes']['input']>;
  manager_not?: InputMaybe<Scalars['Bytes']['input']>;
  manager_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  manager_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  name?: InputMaybe<Scalars['String']['input']>;
  name_contains?: InputMaybe<Scalars['String']['input']>;
  name_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  name_ends_with?: InputMaybe<Scalars['String']['input']>;
  name_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  name_gt?: InputMaybe<Scalars['String']['input']>;
  name_gte?: InputMaybe<Scalars['String']['input']>;
  name_in?: InputMaybe<Array<Scalars['String']['input']>>;
  name_lt?: InputMaybe<Scalars['String']['input']>;
  name_lte?: InputMaybe<Scalars['String']['input']>;
  name_not?: InputMaybe<Scalars['String']['input']>;
  name_not_contains?: InputMaybe<Scalars['String']['input']>;
  name_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  name_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  name_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  name_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  name_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  name_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  name_starts_with?: InputMaybe<Scalars['String']['input']>;
  name_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  or?: InputMaybe<Array<InputMaybe<HypoVault_Filter>>>;
  owner?: InputMaybe<Scalars['Bytes']['input']>;
  owner_contains?: InputMaybe<Scalars['Bytes']['input']>;
  owner_gt?: InputMaybe<Scalars['Bytes']['input']>;
  owner_gte?: InputMaybe<Scalars['Bytes']['input']>;
  owner_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  owner_lt?: InputMaybe<Scalars['Bytes']['input']>;
  owner_lte?: InputMaybe<Scalars['Bytes']['input']>;
  owner_not?: InputMaybe<Scalars['Bytes']['input']>;
  owner_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  owner_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  performanceFeeBps?: InputMaybe<Scalars['BigInt']['input']>;
  performanceFeeBps_gt?: InputMaybe<Scalars['BigInt']['input']>;
  performanceFeeBps_gte?: InputMaybe<Scalars['BigInt']['input']>;
  performanceFeeBps_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  performanceFeeBps_lt?: InputMaybe<Scalars['BigInt']['input']>;
  performanceFeeBps_lte?: InputMaybe<Scalars['BigInt']['input']>;
  performanceFeeBps_not?: InputMaybe<Scalars['BigInt']['input']>;
  performanceFeeBps_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  queuedDeposits_?: InputMaybe<QueuedDeposit_Filter>;
  queuedWithdrawals_?: InputMaybe<QueuedWithdrawal_Filter>;
  reservedWithdrawalAssets?: InputMaybe<Scalars['BigInt']['input']>;
  reservedWithdrawalAssets_gt?: InputMaybe<Scalars['BigInt']['input']>;
  reservedWithdrawalAssets_gte?: InputMaybe<Scalars['BigInt']['input']>;
  reservedWithdrawalAssets_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  reservedWithdrawalAssets_lt?: InputMaybe<Scalars['BigInt']['input']>;
  reservedWithdrawalAssets_lte?: InputMaybe<Scalars['BigInt']['input']>;
  reservedWithdrawalAssets_not?: InputMaybe<Scalars['BigInt']['input']>;
  reservedWithdrawalAssets_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  shares?: InputMaybe<Scalars['BigInt']['input']>;
  shares_gt?: InputMaybe<Scalars['BigInt']['input']>;
  shares_gte?: InputMaybe<Scalars['BigInt']['input']>;
  shares_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  shares_lt?: InputMaybe<Scalars['BigInt']['input']>;
  shares_lte?: InputMaybe<Scalars['BigInt']['input']>;
  shares_not?: InputMaybe<Scalars['BigInt']['input']>;
  shares_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  symbol?: InputMaybe<Scalars['String']['input']>;
  symbol_contains?: InputMaybe<Scalars['String']['input']>;
  symbol_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  symbol_ends_with?: InputMaybe<Scalars['String']['input']>;
  symbol_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  symbol_gt?: InputMaybe<Scalars['String']['input']>;
  symbol_gte?: InputMaybe<Scalars['String']['input']>;
  symbol_in?: InputMaybe<Array<Scalars['String']['input']>>;
  symbol_lt?: InputMaybe<Scalars['String']['input']>;
  symbol_lte?: InputMaybe<Scalars['String']['input']>;
  symbol_not?: InputMaybe<Scalars['String']['input']>;
  symbol_not_contains?: InputMaybe<Scalars['String']['input']>;
  symbol_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  symbol_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  symbol_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  symbol_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  symbol_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  symbol_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  symbol_starts_with?: InputMaybe<Scalars['String']['input']>;
  symbol_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  totalAssetsDeposited?: InputMaybe<Scalars['BigInt']['input']>;
  totalAssetsDeposited_gt?: InputMaybe<Scalars['BigInt']['input']>;
  totalAssetsDeposited_gte?: InputMaybe<Scalars['BigInt']['input']>;
  totalAssetsDeposited_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  totalAssetsDeposited_lt?: InputMaybe<Scalars['BigInt']['input']>;
  totalAssetsDeposited_lte?: InputMaybe<Scalars['BigInt']['input']>;
  totalAssetsDeposited_not?: InputMaybe<Scalars['BigInt']['input']>;
  totalAssetsDeposited_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  totalAssetsWithdrawn?: InputMaybe<Scalars['BigInt']['input']>;
  totalAssetsWithdrawn_gt?: InputMaybe<Scalars['BigInt']['input']>;
  totalAssetsWithdrawn_gte?: InputMaybe<Scalars['BigInt']['input']>;
  totalAssetsWithdrawn_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  totalAssetsWithdrawn_lt?: InputMaybe<Scalars['BigInt']['input']>;
  totalAssetsWithdrawn_lte?: InputMaybe<Scalars['BigInt']['input']>;
  totalAssetsWithdrawn_not?: InputMaybe<Scalars['BigInt']['input']>;
  totalAssetsWithdrawn_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  totalPerformanceFeesCollected?: InputMaybe<Scalars['BigInt']['input']>;
  totalPerformanceFeesCollected_gt?: InputMaybe<Scalars['BigInt']['input']>;
  totalPerformanceFeesCollected_gte?: InputMaybe<Scalars['BigInt']['input']>;
  totalPerformanceFeesCollected_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  totalPerformanceFeesCollected_lt?: InputMaybe<Scalars['BigInt']['input']>;
  totalPerformanceFeesCollected_lte?: InputMaybe<Scalars['BigInt']['input']>;
  totalPerformanceFeesCollected_not?: InputMaybe<Scalars['BigInt']['input']>;
  totalPerformanceFeesCollected_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  underlyingToken?: InputMaybe<Scalars['String']['input']>;
  underlyingToken_?: InputMaybe<Token_Filter>;
  underlyingToken_contains?: InputMaybe<Scalars['String']['input']>;
  underlyingToken_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  underlyingToken_ends_with?: InputMaybe<Scalars['String']['input']>;
  underlyingToken_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  underlyingToken_gt?: InputMaybe<Scalars['String']['input']>;
  underlyingToken_gte?: InputMaybe<Scalars['String']['input']>;
  underlyingToken_in?: InputMaybe<Array<Scalars['String']['input']>>;
  underlyingToken_lt?: InputMaybe<Scalars['String']['input']>;
  underlyingToken_lte?: InputMaybe<Scalars['String']['input']>;
  underlyingToken_not?: InputMaybe<Scalars['String']['input']>;
  underlyingToken_not_contains?: InputMaybe<Scalars['String']['input']>;
  underlyingToken_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  underlyingToken_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  underlyingToken_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  underlyingToken_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  underlyingToken_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  underlyingToken_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  underlyingToken_starts_with?: InputMaybe<Scalars['String']['input']>;
  underlyingToken_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  updatedAt?: InputMaybe<Scalars['BigInt']['input']>;
  updatedAtBlock?: InputMaybe<Scalars['BigInt']['input']>;
  updatedAtBlock_gt?: InputMaybe<Scalars['BigInt']['input']>;
  updatedAtBlock_gte?: InputMaybe<Scalars['BigInt']['input']>;
  updatedAtBlock_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  updatedAtBlock_lt?: InputMaybe<Scalars['BigInt']['input']>;
  updatedAtBlock_lte?: InputMaybe<Scalars['BigInt']['input']>;
  updatedAtBlock_not?: InputMaybe<Scalars['BigInt']['input']>;
  updatedAtBlock_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  updatedAt_gt?: InputMaybe<Scalars['BigInt']['input']>;
  updatedAt_gte?: InputMaybe<Scalars['BigInt']['input']>;
  updatedAt_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  updatedAt_lt?: InputMaybe<Scalars['BigInt']['input']>;
  updatedAt_lte?: InputMaybe<Scalars['BigInt']['input']>;
  updatedAt_not?: InputMaybe<Scalars['BigInt']['input']>;
  updatedAt_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  userBalances_?: InputMaybe<UserBalance_Filter>;
  userBases_?: InputMaybe<UserBasis_Filter>;
  withdrawalEpoch?: InputMaybe<Scalars['BigInt']['input']>;
  withdrawalEpochStates_?: InputMaybe<WithdrawalEpochState_Filter>;
  withdrawalEpoch_gt?: InputMaybe<Scalars['BigInt']['input']>;
  withdrawalEpoch_gte?: InputMaybe<Scalars['BigInt']['input']>;
  withdrawalEpoch_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  withdrawalEpoch_lt?: InputMaybe<Scalars['BigInt']['input']>;
  withdrawalEpoch_lte?: InputMaybe<Scalars['BigInt']['input']>;
  withdrawalEpoch_not?: InputMaybe<Scalars['BigInt']['input']>;
  withdrawalEpoch_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
}

export enum HypoVault_OrderBy {
  Accountant = 'accountant',
  CreatedAt = 'createdAt',
  CreatedAtBlock = 'createdAtBlock',
  DepositEpoch = 'depositEpoch',
  DepositEpochStates = 'depositEpochStates',
  FeeWallet = 'feeWallet',
  Id = 'id',
  Manager = 'manager',
  Name = 'name',
  Owner = 'owner',
  PerformanceFeeBps = 'performanceFeeBps',
  QueuedDeposits = 'queuedDeposits',
  QueuedWithdrawals = 'queuedWithdrawals',
  ReservedWithdrawalAssets = 'reservedWithdrawalAssets',
  Shares = 'shares',
  Symbol = 'symbol',
  TotalAssetsDeposited = 'totalAssetsDeposited',
  TotalAssetsWithdrawn = 'totalAssetsWithdrawn',
  TotalPerformanceFeesCollected = 'totalPerformanceFeesCollected',
  UnderlyingToken = 'underlyingToken',
  UnderlyingTokenDecimals = 'underlyingToken__decimals',
  UnderlyingTokenDerivedEth = 'underlyingToken__derivedETH',
  UnderlyingTokenId = 'underlyingToken__id',
  UnderlyingTokenName = 'underlyingToken__name',
  UnderlyingTokenSymbol = 'underlyingToken__symbol',
  UnderlyingTokenTotalSupply = 'underlyingToken__totalSupply',
  UpdatedAt = 'updatedAt',
  UpdatedAtBlock = 'updatedAtBlock',
  UserBalances = 'userBalances',
  UserBases = 'userBases',
  WithdrawalEpoch = 'withdrawalEpoch',
  WithdrawalEpochStates = 'withdrawalEpochStates'
}

export interface ManagerUpdated {
  __typename?: 'ManagerUpdated';
  blockNumber: Scalars['BigInt']['output'];
  blockTimestamp: Scalars['BigInt']['output'];
  hypoVault: HypoVault;
  id: Scalars['Bytes']['output'];
  newManager: Scalars['Bytes']['output'];
  oldManager: Scalars['Bytes']['output'];
  transactionHash: Scalars['Bytes']['output'];
}

export interface ManagerUpdated_Filter {
  /** Filter for the block changed event. */
  _change_block?: InputMaybe<BlockChangedFilter>;
  and?: InputMaybe<Array<InputMaybe<ManagerUpdated_Filter>>>;
  blockNumber?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_gt?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_gte?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockNumber_lt?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_lte?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_not?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockTimestamp?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_gt?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_gte?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockTimestamp_lt?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_lte?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_not?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  hypoVault?: InputMaybe<Scalars['String']['input']>;
  hypoVault_?: InputMaybe<HypoVault_Filter>;
  hypoVault_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_lt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_lte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['Bytes']['input']>;
  id_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_gt?: InputMaybe<Scalars['Bytes']['input']>;
  id_gte?: InputMaybe<Scalars['Bytes']['input']>;
  id_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  id_lt?: InputMaybe<Scalars['Bytes']['input']>;
  id_lte?: InputMaybe<Scalars['Bytes']['input']>;
  id_not?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  newManager?: InputMaybe<Scalars['Bytes']['input']>;
  newManager_contains?: InputMaybe<Scalars['Bytes']['input']>;
  newManager_gt?: InputMaybe<Scalars['Bytes']['input']>;
  newManager_gte?: InputMaybe<Scalars['Bytes']['input']>;
  newManager_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  newManager_lt?: InputMaybe<Scalars['Bytes']['input']>;
  newManager_lte?: InputMaybe<Scalars['Bytes']['input']>;
  newManager_not?: InputMaybe<Scalars['Bytes']['input']>;
  newManager_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  newManager_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  oldManager?: InputMaybe<Scalars['Bytes']['input']>;
  oldManager_contains?: InputMaybe<Scalars['Bytes']['input']>;
  oldManager_gt?: InputMaybe<Scalars['Bytes']['input']>;
  oldManager_gte?: InputMaybe<Scalars['Bytes']['input']>;
  oldManager_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  oldManager_lt?: InputMaybe<Scalars['Bytes']['input']>;
  oldManager_lte?: InputMaybe<Scalars['Bytes']['input']>;
  oldManager_not?: InputMaybe<Scalars['Bytes']['input']>;
  oldManager_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  oldManager_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  or?: InputMaybe<Array<InputMaybe<ManagerUpdated_Filter>>>;
  transactionHash?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_contains?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_gt?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_gte?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  transactionHash_lt?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_lte?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
}

export enum ManagerUpdated_OrderBy {
  BlockNumber = 'blockNumber',
  BlockTimestamp = 'blockTimestamp',
  HypoVault = 'hypoVault',
  HypoVaultAccountant = 'hypoVault__accountant',
  HypoVaultCreatedAt = 'hypoVault__createdAt',
  HypoVaultCreatedAtBlock = 'hypoVault__createdAtBlock',
  HypoVaultDepositEpoch = 'hypoVault__depositEpoch',
  HypoVaultFeeWallet = 'hypoVault__feeWallet',
  HypoVaultId = 'hypoVault__id',
  HypoVaultManager = 'hypoVault__manager',
  HypoVaultName = 'hypoVault__name',
  HypoVaultOwner = 'hypoVault__owner',
  HypoVaultPerformanceFeeBps = 'hypoVault__performanceFeeBps',
  HypoVaultReservedWithdrawalAssets = 'hypoVault__reservedWithdrawalAssets',
  HypoVaultShares = 'hypoVault__shares',
  HypoVaultSymbol = 'hypoVault__symbol',
  HypoVaultTotalAssetsDeposited = 'hypoVault__totalAssetsDeposited',
  HypoVaultTotalAssetsWithdrawn = 'hypoVault__totalAssetsWithdrawn',
  HypoVaultTotalPerformanceFeesCollected = 'hypoVault__totalPerformanceFeesCollected',
  HypoVaultUpdatedAt = 'hypoVault__updatedAt',
  HypoVaultUpdatedAtBlock = 'hypoVault__updatedAtBlock',
  HypoVaultWithdrawalEpoch = 'hypoVault__withdrawalEpoch',
  Id = 'id',
  NewManager = 'newManager',
  OldManager = 'oldManager',
  TransactionHash = 'transactionHash'
}

/** Defines the order direction, either ascending or descending */
export enum OrderDirection {
  Asc = 'asc',
  Desc = 'desc'
}

export interface OwnershipTransferred {
  __typename?: 'OwnershipTransferred';
  blockNumber: Scalars['BigInt']['output'];
  blockTimestamp: Scalars['BigInt']['output'];
  hypoVault: HypoVault;
  id: Scalars['Bytes']['output'];
  newOwner: Scalars['Bytes']['output'];
  previousOwner: Scalars['Bytes']['output'];
  transactionHash: Scalars['Bytes']['output'];
}

export interface OwnershipTransferred_Filter {
  /** Filter for the block changed event. */
  _change_block?: InputMaybe<BlockChangedFilter>;
  and?: InputMaybe<Array<InputMaybe<OwnershipTransferred_Filter>>>;
  blockNumber?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_gt?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_gte?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockNumber_lt?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_lte?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_not?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockTimestamp?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_gt?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_gte?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockTimestamp_lt?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_lte?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_not?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  hypoVault?: InputMaybe<Scalars['String']['input']>;
  hypoVault_?: InputMaybe<HypoVault_Filter>;
  hypoVault_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_lt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_lte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['Bytes']['input']>;
  id_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_gt?: InputMaybe<Scalars['Bytes']['input']>;
  id_gte?: InputMaybe<Scalars['Bytes']['input']>;
  id_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  id_lt?: InputMaybe<Scalars['Bytes']['input']>;
  id_lte?: InputMaybe<Scalars['Bytes']['input']>;
  id_not?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  newOwner?: InputMaybe<Scalars['Bytes']['input']>;
  newOwner_contains?: InputMaybe<Scalars['Bytes']['input']>;
  newOwner_gt?: InputMaybe<Scalars['Bytes']['input']>;
  newOwner_gte?: InputMaybe<Scalars['Bytes']['input']>;
  newOwner_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  newOwner_lt?: InputMaybe<Scalars['Bytes']['input']>;
  newOwner_lte?: InputMaybe<Scalars['Bytes']['input']>;
  newOwner_not?: InputMaybe<Scalars['Bytes']['input']>;
  newOwner_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  newOwner_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  or?: InputMaybe<Array<InputMaybe<OwnershipTransferred_Filter>>>;
  previousOwner?: InputMaybe<Scalars['Bytes']['input']>;
  previousOwner_contains?: InputMaybe<Scalars['Bytes']['input']>;
  previousOwner_gt?: InputMaybe<Scalars['Bytes']['input']>;
  previousOwner_gte?: InputMaybe<Scalars['Bytes']['input']>;
  previousOwner_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  previousOwner_lt?: InputMaybe<Scalars['Bytes']['input']>;
  previousOwner_lte?: InputMaybe<Scalars['Bytes']['input']>;
  previousOwner_not?: InputMaybe<Scalars['Bytes']['input']>;
  previousOwner_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  previousOwner_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  transactionHash?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_contains?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_gt?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_gte?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  transactionHash_lt?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_lte?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
}

export enum OwnershipTransferred_OrderBy {
  BlockNumber = 'blockNumber',
  BlockTimestamp = 'blockTimestamp',
  HypoVault = 'hypoVault',
  HypoVaultAccountant = 'hypoVault__accountant',
  HypoVaultCreatedAt = 'hypoVault__createdAt',
  HypoVaultCreatedAtBlock = 'hypoVault__createdAtBlock',
  HypoVaultDepositEpoch = 'hypoVault__depositEpoch',
  HypoVaultFeeWallet = 'hypoVault__feeWallet',
  HypoVaultId = 'hypoVault__id',
  HypoVaultManager = 'hypoVault__manager',
  HypoVaultName = 'hypoVault__name',
  HypoVaultOwner = 'hypoVault__owner',
  HypoVaultPerformanceFeeBps = 'hypoVault__performanceFeeBps',
  HypoVaultReservedWithdrawalAssets = 'hypoVault__reservedWithdrawalAssets',
  HypoVaultShares = 'hypoVault__shares',
  HypoVaultSymbol = 'hypoVault__symbol',
  HypoVaultTotalAssetsDeposited = 'hypoVault__totalAssetsDeposited',
  HypoVaultTotalAssetsWithdrawn = 'hypoVault__totalAssetsWithdrawn',
  HypoVaultTotalPerformanceFeesCollected = 'hypoVault__totalPerformanceFeesCollected',
  HypoVaultUpdatedAt = 'hypoVault__updatedAt',
  HypoVaultUpdatedAtBlock = 'hypoVault__updatedAtBlock',
  HypoVaultWithdrawalEpoch = 'hypoVault__withdrawalEpoch',
  Id = 'id',
  NewOwner = 'newOwner',
  PreviousOwner = 'previousOwner',
  TransactionHash = 'transactionHash'
}

/**  Underlying pool (e.g. Uniswap V3 Pool)  */
export interface Pool {
  __typename?: 'Pool';
  /**  Fee amount  */
  feeTier: Scalars['BigInt']['output'];
  /**  Hook contract address  */
  hooks?: Maybe<Scalars['Bytes']['output']>;
  /**  Pool address for V3 pool, or for V4 pools, abi encoded hash of the pool key struct for the new pool.  */
  id: Scalars['Bytes']['output'];
  /**  If this is a V4Pool, will be true. If it's a V3Pool, will be false  */
  isV4Pool?: Maybe<Scalars['Boolean']['output']>;
  /**  In range liquidity  */
  liquidity: Scalars['BigInt']['output'];
  /**  Current price tracker  */
  sqrtPrice: Scalars['BigInt']['output'];
  /**  Current tick. May be null if pool has not been initialized.  */
  tick?: Maybe<Scalars['BigInt']['output']>;
  /**  Token0  */
  token0: Token;
  /**  Token0 per token1  */
  token0Price: Scalars['BigDecimal']['output'];
  /**  Token1  */
  token1: Token;
  /**  Token1 per token0  */
  token1Price: Scalars['BigDecimal']['output'];
  /**  Total token 0 across all ticks  */
  totalValueLockedToken0: Scalars['BigDecimal']['output'];
  /**  Total token 1 across all ticks  */
  totalValueLockedToken1: Scalars['BigDecimal']['output'];
}

export interface Pool_Filter {
  /** Filter for the block changed event. */
  _change_block?: InputMaybe<BlockChangedFilter>;
  and?: InputMaybe<Array<InputMaybe<Pool_Filter>>>;
  feeTier?: InputMaybe<Scalars['BigInt']['input']>;
  feeTier_gt?: InputMaybe<Scalars['BigInt']['input']>;
  feeTier_gte?: InputMaybe<Scalars['BigInt']['input']>;
  feeTier_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  feeTier_lt?: InputMaybe<Scalars['BigInt']['input']>;
  feeTier_lte?: InputMaybe<Scalars['BigInt']['input']>;
  feeTier_not?: InputMaybe<Scalars['BigInt']['input']>;
  feeTier_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  hooks?: InputMaybe<Scalars['Bytes']['input']>;
  hooks_contains?: InputMaybe<Scalars['Bytes']['input']>;
  hooks_gt?: InputMaybe<Scalars['Bytes']['input']>;
  hooks_gte?: InputMaybe<Scalars['Bytes']['input']>;
  hooks_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  hooks_lt?: InputMaybe<Scalars['Bytes']['input']>;
  hooks_lte?: InputMaybe<Scalars['Bytes']['input']>;
  hooks_not?: InputMaybe<Scalars['Bytes']['input']>;
  hooks_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  hooks_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  id?: InputMaybe<Scalars['Bytes']['input']>;
  id_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_gt?: InputMaybe<Scalars['Bytes']['input']>;
  id_gte?: InputMaybe<Scalars['Bytes']['input']>;
  id_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  id_lt?: InputMaybe<Scalars['Bytes']['input']>;
  id_lte?: InputMaybe<Scalars['Bytes']['input']>;
  id_not?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  isV4Pool?: InputMaybe<Scalars['Boolean']['input']>;
  isV4Pool_in?: InputMaybe<Array<Scalars['Boolean']['input']>>;
  isV4Pool_not?: InputMaybe<Scalars['Boolean']['input']>;
  isV4Pool_not_in?: InputMaybe<Array<Scalars['Boolean']['input']>>;
  liquidity?: InputMaybe<Scalars['BigInt']['input']>;
  liquidity_gt?: InputMaybe<Scalars['BigInt']['input']>;
  liquidity_gte?: InputMaybe<Scalars['BigInt']['input']>;
  liquidity_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  liquidity_lt?: InputMaybe<Scalars['BigInt']['input']>;
  liquidity_lte?: InputMaybe<Scalars['BigInt']['input']>;
  liquidity_not?: InputMaybe<Scalars['BigInt']['input']>;
  liquidity_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  or?: InputMaybe<Array<InputMaybe<Pool_Filter>>>;
  sqrtPrice?: InputMaybe<Scalars['BigInt']['input']>;
  sqrtPrice_gt?: InputMaybe<Scalars['BigInt']['input']>;
  sqrtPrice_gte?: InputMaybe<Scalars['BigInt']['input']>;
  sqrtPrice_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  sqrtPrice_lt?: InputMaybe<Scalars['BigInt']['input']>;
  sqrtPrice_lte?: InputMaybe<Scalars['BigInt']['input']>;
  sqrtPrice_not?: InputMaybe<Scalars['BigInt']['input']>;
  sqrtPrice_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  tick?: InputMaybe<Scalars['BigInt']['input']>;
  tick_gt?: InputMaybe<Scalars['BigInt']['input']>;
  tick_gte?: InputMaybe<Scalars['BigInt']['input']>;
  tick_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  tick_lt?: InputMaybe<Scalars['BigInt']['input']>;
  tick_lte?: InputMaybe<Scalars['BigInt']['input']>;
  tick_not?: InputMaybe<Scalars['BigInt']['input']>;
  tick_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  token0?: InputMaybe<Scalars['String']['input']>;
  token0Price?: InputMaybe<Scalars['BigDecimal']['input']>;
  token0Price_gt?: InputMaybe<Scalars['BigDecimal']['input']>;
  token0Price_gte?: InputMaybe<Scalars['BigDecimal']['input']>;
  token0Price_in?: InputMaybe<Array<Scalars['BigDecimal']['input']>>;
  token0Price_lt?: InputMaybe<Scalars['BigDecimal']['input']>;
  token0Price_lte?: InputMaybe<Scalars['BigDecimal']['input']>;
  token0Price_not?: InputMaybe<Scalars['BigDecimal']['input']>;
  token0Price_not_in?: InputMaybe<Array<Scalars['BigDecimal']['input']>>;
  token0_?: InputMaybe<Token_Filter>;
  token0_contains?: InputMaybe<Scalars['String']['input']>;
  token0_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  token0_ends_with?: InputMaybe<Scalars['String']['input']>;
  token0_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  token0_gt?: InputMaybe<Scalars['String']['input']>;
  token0_gte?: InputMaybe<Scalars['String']['input']>;
  token0_in?: InputMaybe<Array<Scalars['String']['input']>>;
  token0_lt?: InputMaybe<Scalars['String']['input']>;
  token0_lte?: InputMaybe<Scalars['String']['input']>;
  token0_not?: InputMaybe<Scalars['String']['input']>;
  token0_not_contains?: InputMaybe<Scalars['String']['input']>;
  token0_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  token0_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  token0_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  token0_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  token0_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  token0_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  token0_starts_with?: InputMaybe<Scalars['String']['input']>;
  token0_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  token1?: InputMaybe<Scalars['String']['input']>;
  token1Price?: InputMaybe<Scalars['BigDecimal']['input']>;
  token1Price_gt?: InputMaybe<Scalars['BigDecimal']['input']>;
  token1Price_gte?: InputMaybe<Scalars['BigDecimal']['input']>;
  token1Price_in?: InputMaybe<Array<Scalars['BigDecimal']['input']>>;
  token1Price_lt?: InputMaybe<Scalars['BigDecimal']['input']>;
  token1Price_lte?: InputMaybe<Scalars['BigDecimal']['input']>;
  token1Price_not?: InputMaybe<Scalars['BigDecimal']['input']>;
  token1Price_not_in?: InputMaybe<Array<Scalars['BigDecimal']['input']>>;
  token1_?: InputMaybe<Token_Filter>;
  token1_contains?: InputMaybe<Scalars['String']['input']>;
  token1_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  token1_ends_with?: InputMaybe<Scalars['String']['input']>;
  token1_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  token1_gt?: InputMaybe<Scalars['String']['input']>;
  token1_gte?: InputMaybe<Scalars['String']['input']>;
  token1_in?: InputMaybe<Array<Scalars['String']['input']>>;
  token1_lt?: InputMaybe<Scalars['String']['input']>;
  token1_lte?: InputMaybe<Scalars['String']['input']>;
  token1_not?: InputMaybe<Scalars['String']['input']>;
  token1_not_contains?: InputMaybe<Scalars['String']['input']>;
  token1_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  token1_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  token1_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  token1_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  token1_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  token1_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  token1_starts_with?: InputMaybe<Scalars['String']['input']>;
  token1_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  totalValueLockedToken0?: InputMaybe<Scalars['BigDecimal']['input']>;
  totalValueLockedToken0_gt?: InputMaybe<Scalars['BigDecimal']['input']>;
  totalValueLockedToken0_gte?: InputMaybe<Scalars['BigDecimal']['input']>;
  totalValueLockedToken0_in?: InputMaybe<Array<Scalars['BigDecimal']['input']>>;
  totalValueLockedToken0_lt?: InputMaybe<Scalars['BigDecimal']['input']>;
  totalValueLockedToken0_lte?: InputMaybe<Scalars['BigDecimal']['input']>;
  totalValueLockedToken0_not?: InputMaybe<Scalars['BigDecimal']['input']>;
  totalValueLockedToken0_not_in?: InputMaybe<Array<Scalars['BigDecimal']['input']>>;
  totalValueLockedToken1?: InputMaybe<Scalars['BigDecimal']['input']>;
  totalValueLockedToken1_gt?: InputMaybe<Scalars['BigDecimal']['input']>;
  totalValueLockedToken1_gte?: InputMaybe<Scalars['BigDecimal']['input']>;
  totalValueLockedToken1_in?: InputMaybe<Array<Scalars['BigDecimal']['input']>>;
  totalValueLockedToken1_lt?: InputMaybe<Scalars['BigDecimal']['input']>;
  totalValueLockedToken1_lte?: InputMaybe<Scalars['BigDecimal']['input']>;
  totalValueLockedToken1_not?: InputMaybe<Scalars['BigDecimal']['input']>;
  totalValueLockedToken1_not_in?: InputMaybe<Array<Scalars['BigDecimal']['input']>>;
}

export enum Pool_OrderBy {
  FeeTier = 'feeTier',
  Hooks = 'hooks',
  Id = 'id',
  IsV4Pool = 'isV4Pool',
  Liquidity = 'liquidity',
  SqrtPrice = 'sqrtPrice',
  Tick = 'tick',
  Token0 = 'token0',
  Token0Price = 'token0Price',
  Token0Decimals = 'token0__decimals',
  Token0DerivedEth = 'token0__derivedETH',
  Token0Id = 'token0__id',
  Token0Name = 'token0__name',
  Token0Symbol = 'token0__symbol',
  Token0TotalSupply = 'token0__totalSupply',
  Token1 = 'token1',
  Token1Price = 'token1Price',
  Token1Decimals = 'token1__decimals',
  Token1DerivedEth = 'token1__derivedETH',
  Token1Id = 'token1__id',
  Token1Name = 'token1__name',
  Token1Symbol = 'token1__symbol',
  Token1TotalSupply = 'token1__totalSupply',
  TotalValueLockedToken0 = 'totalValueLockedToken0',
  TotalValueLockedToken1 = 'totalValueLockedToken1'
}

export interface Query {
  __typename?: 'Query';
  /** Access to subgraph metadata */
  _meta?: Maybe<_Meta_>;
  account?: Maybe<Account>;
  accountantUpdated?: Maybe<AccountantUpdated>;
  accountantUpdateds: Array<AccountantUpdated>;
  accounts: Array<Account>;
  bundle?: Maybe<Bundle>;
  bundles: Array<Bundle>;
  depositCancelled?: Maybe<DepositCancelled>;
  depositCancelleds: Array<DepositCancelled>;
  depositEpochState?: Maybe<DepositEpochState>;
  depositEpochStates: Array<DepositEpochState>;
  depositExecuted?: Maybe<DepositExecuted>;
  depositExecuteds: Array<DepositExecuted>;
  depositRequested?: Maybe<DepositRequested>;
  depositRequesteds: Array<DepositRequested>;
  depositsFulfilled?: Maybe<DepositsFulfilled>;
  depositsFulfilleds: Array<DepositsFulfilled>;
  feeWalletUpdated?: Maybe<FeeWalletUpdated>;
  feeWalletUpdateds: Array<FeeWalletUpdated>;
  hypoVault?: Maybe<HypoVault>;
  hypoVaultFactories: Array<HypoVaultFactory>;
  hypoVaultFactory?: Maybe<HypoVaultFactory>;
  hypoVaults: Array<HypoVault>;
  managerUpdated?: Maybe<ManagerUpdated>;
  managerUpdateds: Array<ManagerUpdated>;
  ownershipTransferred?: Maybe<OwnershipTransferred>;
  ownershipTransferreds: Array<OwnershipTransferred>;
  pool?: Maybe<Pool>;
  pools: Array<Pool>;
  queuedDeposit?: Maybe<QueuedDeposit>;
  queuedDeposits: Array<QueuedDeposit>;
  queuedWithdrawal?: Maybe<QueuedWithdrawal>;
  queuedWithdrawals: Array<QueuedWithdrawal>;
  redepositStatusChanged?: Maybe<RedepositStatusChanged>;
  redepositStatusChangeds: Array<RedepositStatusChanged>;
  token?: Maybe<Token>;
  tokens: Array<Token>;
  transfer?: Maybe<Transfer>;
  transfers: Array<Transfer>;
  userBalance?: Maybe<UserBalance>;
  userBalances: Array<UserBalance>;
  userBases: Array<UserBasis>;
  userBasis?: Maybe<UserBasis>;
  withdrawalCancelled?: Maybe<WithdrawalCancelled>;
  withdrawalCancelleds: Array<WithdrawalCancelled>;
  withdrawalEpochState?: Maybe<WithdrawalEpochState>;
  withdrawalEpochStates: Array<WithdrawalEpochState>;
  withdrawalExecuted?: Maybe<WithdrawalExecuted>;
  withdrawalExecuteds: Array<WithdrawalExecuted>;
  withdrawalRequested?: Maybe<WithdrawalRequested>;
  withdrawalRequesteds: Array<WithdrawalRequested>;
  withdrawalsFulfilled?: Maybe<WithdrawalsFulfilled>;
  withdrawalsFulfilleds: Array<WithdrawalsFulfilled>;
}


export interface Query_MetaArgs {
  block?: InputMaybe<Block_Height>;
}


export interface QueryAccountArgs {
  block?: InputMaybe<Block_Height>;
  id: Scalars['ID']['input'];
  subgraphError?: _SubgraphErrorPolicy_;
}


export interface QueryAccountantUpdatedArgs {
  block?: InputMaybe<Block_Height>;
  id: Scalars['ID']['input'];
  subgraphError?: _SubgraphErrorPolicy_;
}


export interface QueryAccountantUpdatedsArgs {
  block?: InputMaybe<Block_Height>;
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<AccountantUpdated_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  subgraphError?: _SubgraphErrorPolicy_;
  where?: InputMaybe<AccountantUpdated_Filter>;
}


export interface QueryAccountsArgs {
  block?: InputMaybe<Block_Height>;
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<Account_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  subgraphError?: _SubgraphErrorPolicy_;
  where?: InputMaybe<Account_Filter>;
}


export interface QueryBundleArgs {
  block?: InputMaybe<Block_Height>;
  id: Scalars['ID']['input'];
  subgraphError?: _SubgraphErrorPolicy_;
}


export interface QueryBundlesArgs {
  block?: InputMaybe<Block_Height>;
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<Bundle_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  subgraphError?: _SubgraphErrorPolicy_;
  where?: InputMaybe<Bundle_Filter>;
}


export interface QueryDepositCancelledArgs {
  block?: InputMaybe<Block_Height>;
  id: Scalars['ID']['input'];
  subgraphError?: _SubgraphErrorPolicy_;
}


export interface QueryDepositCancelledsArgs {
  block?: InputMaybe<Block_Height>;
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<DepositCancelled_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  subgraphError?: _SubgraphErrorPolicy_;
  where?: InputMaybe<DepositCancelled_Filter>;
}


export interface QueryDepositEpochStateArgs {
  block?: InputMaybe<Block_Height>;
  id: Scalars['ID']['input'];
  subgraphError?: _SubgraphErrorPolicy_;
}


export interface QueryDepositEpochStatesArgs {
  block?: InputMaybe<Block_Height>;
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<DepositEpochState_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  subgraphError?: _SubgraphErrorPolicy_;
  where?: InputMaybe<DepositEpochState_Filter>;
}


export interface QueryDepositExecutedArgs {
  block?: InputMaybe<Block_Height>;
  id: Scalars['ID']['input'];
  subgraphError?: _SubgraphErrorPolicy_;
}


export interface QueryDepositExecutedsArgs {
  block?: InputMaybe<Block_Height>;
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<DepositExecuted_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  subgraphError?: _SubgraphErrorPolicy_;
  where?: InputMaybe<DepositExecuted_Filter>;
}


export interface QueryDepositRequestedArgs {
  block?: InputMaybe<Block_Height>;
  id: Scalars['ID']['input'];
  subgraphError?: _SubgraphErrorPolicy_;
}


export interface QueryDepositRequestedsArgs {
  block?: InputMaybe<Block_Height>;
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<DepositRequested_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  subgraphError?: _SubgraphErrorPolicy_;
  where?: InputMaybe<DepositRequested_Filter>;
}


export interface QueryDepositsFulfilledArgs {
  block?: InputMaybe<Block_Height>;
  id: Scalars['ID']['input'];
  subgraphError?: _SubgraphErrorPolicy_;
}


export interface QueryDepositsFulfilledsArgs {
  block?: InputMaybe<Block_Height>;
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<DepositsFulfilled_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  subgraphError?: _SubgraphErrorPolicy_;
  where?: InputMaybe<DepositsFulfilled_Filter>;
}


export interface QueryFeeWalletUpdatedArgs {
  block?: InputMaybe<Block_Height>;
  id: Scalars['ID']['input'];
  subgraphError?: _SubgraphErrorPolicy_;
}


export interface QueryFeeWalletUpdatedsArgs {
  block?: InputMaybe<Block_Height>;
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<FeeWalletUpdated_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  subgraphError?: _SubgraphErrorPolicy_;
  where?: InputMaybe<FeeWalletUpdated_Filter>;
}


export interface QueryHypoVaultArgs {
  block?: InputMaybe<Block_Height>;
  id: Scalars['ID']['input'];
  subgraphError?: _SubgraphErrorPolicy_;
}


export interface QueryHypoVaultFactoriesArgs {
  block?: InputMaybe<Block_Height>;
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<HypoVaultFactory_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  subgraphError?: _SubgraphErrorPolicy_;
  where?: InputMaybe<HypoVaultFactory_Filter>;
}


export interface QueryHypoVaultFactoryArgs {
  block?: InputMaybe<Block_Height>;
  id: Scalars['ID']['input'];
  subgraphError?: _SubgraphErrorPolicy_;
}


export interface QueryHypoVaultsArgs {
  block?: InputMaybe<Block_Height>;
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<HypoVault_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  subgraphError?: _SubgraphErrorPolicy_;
  where?: InputMaybe<HypoVault_Filter>;
}


export interface QueryManagerUpdatedArgs {
  block?: InputMaybe<Block_Height>;
  id: Scalars['ID']['input'];
  subgraphError?: _SubgraphErrorPolicy_;
}


export interface QueryManagerUpdatedsArgs {
  block?: InputMaybe<Block_Height>;
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<ManagerUpdated_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  subgraphError?: _SubgraphErrorPolicy_;
  where?: InputMaybe<ManagerUpdated_Filter>;
}


export interface QueryOwnershipTransferredArgs {
  block?: InputMaybe<Block_Height>;
  id: Scalars['ID']['input'];
  subgraphError?: _SubgraphErrorPolicy_;
}


export interface QueryOwnershipTransferredsArgs {
  block?: InputMaybe<Block_Height>;
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<OwnershipTransferred_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  subgraphError?: _SubgraphErrorPolicy_;
  where?: InputMaybe<OwnershipTransferred_Filter>;
}


export interface QueryPoolArgs {
  block?: InputMaybe<Block_Height>;
  id: Scalars['ID']['input'];
  subgraphError?: _SubgraphErrorPolicy_;
}


export interface QueryPoolsArgs {
  block?: InputMaybe<Block_Height>;
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<Pool_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  subgraphError?: _SubgraphErrorPolicy_;
  where?: InputMaybe<Pool_Filter>;
}


export interface QueryQueuedDepositArgs {
  block?: InputMaybe<Block_Height>;
  id: Scalars['ID']['input'];
  subgraphError?: _SubgraphErrorPolicy_;
}


export interface QueryQueuedDepositsArgs {
  block?: InputMaybe<Block_Height>;
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<QueuedDeposit_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  subgraphError?: _SubgraphErrorPolicy_;
  where?: InputMaybe<QueuedDeposit_Filter>;
}


export interface QueryQueuedWithdrawalArgs {
  block?: InputMaybe<Block_Height>;
  id: Scalars['ID']['input'];
  subgraphError?: _SubgraphErrorPolicy_;
}


export interface QueryQueuedWithdrawalsArgs {
  block?: InputMaybe<Block_Height>;
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<QueuedWithdrawal_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  subgraphError?: _SubgraphErrorPolicy_;
  where?: InputMaybe<QueuedWithdrawal_Filter>;
}


export interface QueryRedepositStatusChangedArgs {
  block?: InputMaybe<Block_Height>;
  id: Scalars['ID']['input'];
  subgraphError?: _SubgraphErrorPolicy_;
}


export interface QueryRedepositStatusChangedsArgs {
  block?: InputMaybe<Block_Height>;
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<RedepositStatusChanged_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  subgraphError?: _SubgraphErrorPolicy_;
  where?: InputMaybe<RedepositStatusChanged_Filter>;
}


export interface QueryTokenArgs {
  block?: InputMaybe<Block_Height>;
  id: Scalars['ID']['input'];
  subgraphError?: _SubgraphErrorPolicy_;
}


export interface QueryTokensArgs {
  block?: InputMaybe<Block_Height>;
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<Token_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  subgraphError?: _SubgraphErrorPolicy_;
  where?: InputMaybe<Token_Filter>;
}


export interface QueryTransferArgs {
  block?: InputMaybe<Block_Height>;
  id: Scalars['ID']['input'];
  subgraphError?: _SubgraphErrorPolicy_;
}


export interface QueryTransfersArgs {
  block?: InputMaybe<Block_Height>;
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<Transfer_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  subgraphError?: _SubgraphErrorPolicy_;
  where?: InputMaybe<Transfer_Filter>;
}


export interface QueryUserBalanceArgs {
  block?: InputMaybe<Block_Height>;
  id: Scalars['ID']['input'];
  subgraphError?: _SubgraphErrorPolicy_;
}


export interface QueryUserBalancesArgs {
  block?: InputMaybe<Block_Height>;
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<UserBalance_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  subgraphError?: _SubgraphErrorPolicy_;
  where?: InputMaybe<UserBalance_Filter>;
}


export interface QueryUserBasesArgs {
  block?: InputMaybe<Block_Height>;
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<UserBasis_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  subgraphError?: _SubgraphErrorPolicy_;
  where?: InputMaybe<UserBasis_Filter>;
}


export interface QueryUserBasisArgs {
  block?: InputMaybe<Block_Height>;
  id: Scalars['ID']['input'];
  subgraphError?: _SubgraphErrorPolicy_;
}


export interface QueryWithdrawalCancelledArgs {
  block?: InputMaybe<Block_Height>;
  id: Scalars['ID']['input'];
  subgraphError?: _SubgraphErrorPolicy_;
}


export interface QueryWithdrawalCancelledsArgs {
  block?: InputMaybe<Block_Height>;
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<WithdrawalCancelled_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  subgraphError?: _SubgraphErrorPolicy_;
  where?: InputMaybe<WithdrawalCancelled_Filter>;
}


export interface QueryWithdrawalEpochStateArgs {
  block?: InputMaybe<Block_Height>;
  id: Scalars['ID']['input'];
  subgraphError?: _SubgraphErrorPolicy_;
}


export interface QueryWithdrawalEpochStatesArgs {
  block?: InputMaybe<Block_Height>;
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<WithdrawalEpochState_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  subgraphError?: _SubgraphErrorPolicy_;
  where?: InputMaybe<WithdrawalEpochState_Filter>;
}


export interface QueryWithdrawalExecutedArgs {
  block?: InputMaybe<Block_Height>;
  id: Scalars['ID']['input'];
  subgraphError?: _SubgraphErrorPolicy_;
}


export interface QueryWithdrawalExecutedsArgs {
  block?: InputMaybe<Block_Height>;
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<WithdrawalExecuted_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  subgraphError?: _SubgraphErrorPolicy_;
  where?: InputMaybe<WithdrawalExecuted_Filter>;
}


export interface QueryWithdrawalRequestedArgs {
  block?: InputMaybe<Block_Height>;
  id: Scalars['ID']['input'];
  subgraphError?: _SubgraphErrorPolicy_;
}


export interface QueryWithdrawalRequestedsArgs {
  block?: InputMaybe<Block_Height>;
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<WithdrawalRequested_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  subgraphError?: _SubgraphErrorPolicy_;
  where?: InputMaybe<WithdrawalRequested_Filter>;
}


export interface QueryWithdrawalsFulfilledArgs {
  block?: InputMaybe<Block_Height>;
  id: Scalars['ID']['input'];
  subgraphError?: _SubgraphErrorPolicy_;
}


export interface QueryWithdrawalsFulfilledsArgs {
  block?: InputMaybe<Block_Height>;
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<WithdrawalsFulfilled_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  subgraphError?: _SubgraphErrorPolicy_;
  where?: InputMaybe<WithdrawalsFulfilled_Filter>;
}

/**
 * Tracks amounts of un-executed deposits for a user in a given epoch.
 * Unfulfilled deposits could be outstanding from other epochs.
 * Created upon DepositRequest in current epoch when no other deposit in the current epoch exists.
 * Amount incremented for a deposit request in the same epoch.
 * Created when a previous Deposit epoch was executed, but there are unfulfilled assets or shares rolled over to the next epoch.
 */
export interface QueuedDeposit {
  __typename?: 'QueuedDeposit';
  account: Account;
  amount: Scalars['BigInt']['output'];
  epoch: Scalars['BigInt']['output'];
  hypoVault: HypoVault;
  id: Scalars['Bytes']['output'];
}

export interface QueuedDeposit_Filter {
  /** Filter for the block changed event. */
  _change_block?: InputMaybe<BlockChangedFilter>;
  account?: InputMaybe<Scalars['String']['input']>;
  account_?: InputMaybe<Account_Filter>;
  account_contains?: InputMaybe<Scalars['String']['input']>;
  account_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  account_ends_with?: InputMaybe<Scalars['String']['input']>;
  account_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  account_gt?: InputMaybe<Scalars['String']['input']>;
  account_gte?: InputMaybe<Scalars['String']['input']>;
  account_in?: InputMaybe<Array<Scalars['String']['input']>>;
  account_lt?: InputMaybe<Scalars['String']['input']>;
  account_lte?: InputMaybe<Scalars['String']['input']>;
  account_not?: InputMaybe<Scalars['String']['input']>;
  account_not_contains?: InputMaybe<Scalars['String']['input']>;
  account_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  account_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  account_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  account_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  account_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  account_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  account_starts_with?: InputMaybe<Scalars['String']['input']>;
  account_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  amount?: InputMaybe<Scalars['BigInt']['input']>;
  amount_gt?: InputMaybe<Scalars['BigInt']['input']>;
  amount_gte?: InputMaybe<Scalars['BigInt']['input']>;
  amount_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  amount_lt?: InputMaybe<Scalars['BigInt']['input']>;
  amount_lte?: InputMaybe<Scalars['BigInt']['input']>;
  amount_not?: InputMaybe<Scalars['BigInt']['input']>;
  amount_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  and?: InputMaybe<Array<InputMaybe<QueuedDeposit_Filter>>>;
  epoch?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_gt?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_gte?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  epoch_lt?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_lte?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_not?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  hypoVault?: InputMaybe<Scalars['String']['input']>;
  hypoVault_?: InputMaybe<HypoVault_Filter>;
  hypoVault_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_lt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_lte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['Bytes']['input']>;
  id_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_gt?: InputMaybe<Scalars['Bytes']['input']>;
  id_gte?: InputMaybe<Scalars['Bytes']['input']>;
  id_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  id_lt?: InputMaybe<Scalars['Bytes']['input']>;
  id_lte?: InputMaybe<Scalars['Bytes']['input']>;
  id_not?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  or?: InputMaybe<Array<InputMaybe<QueuedDeposit_Filter>>>;
}

export enum QueuedDeposit_OrderBy {
  Account = 'account',
  AccountId = 'account__id',
  Amount = 'amount',
  Epoch = 'epoch',
  HypoVault = 'hypoVault',
  HypoVaultAccountant = 'hypoVault__accountant',
  HypoVaultCreatedAt = 'hypoVault__createdAt',
  HypoVaultCreatedAtBlock = 'hypoVault__createdAtBlock',
  HypoVaultDepositEpoch = 'hypoVault__depositEpoch',
  HypoVaultFeeWallet = 'hypoVault__feeWallet',
  HypoVaultId = 'hypoVault__id',
  HypoVaultManager = 'hypoVault__manager',
  HypoVaultName = 'hypoVault__name',
  HypoVaultOwner = 'hypoVault__owner',
  HypoVaultPerformanceFeeBps = 'hypoVault__performanceFeeBps',
  HypoVaultReservedWithdrawalAssets = 'hypoVault__reservedWithdrawalAssets',
  HypoVaultShares = 'hypoVault__shares',
  HypoVaultSymbol = 'hypoVault__symbol',
  HypoVaultTotalAssetsDeposited = 'hypoVault__totalAssetsDeposited',
  HypoVaultTotalAssetsWithdrawn = 'hypoVault__totalAssetsWithdrawn',
  HypoVaultTotalPerformanceFeesCollected = 'hypoVault__totalPerformanceFeesCollected',
  HypoVaultUpdatedAt = 'hypoVault__updatedAt',
  HypoVaultUpdatedAtBlock = 'hypoVault__updatedAtBlock',
  HypoVaultWithdrawalEpoch = 'hypoVault__withdrawalEpoch',
  Id = 'id'
}

export interface QueuedWithdrawal {
  __typename?: 'QueuedWithdrawal';
  account: Account;
  amount: Scalars['BigInt']['output'];
  basis: Scalars['BigInt']['output'];
  epoch: Scalars['BigInt']['output'];
  hypoVault: HypoVault;
  id: Scalars['Bytes']['output'];
  shouldRedeposit: Scalars['Boolean']['output'];
}

export interface QueuedWithdrawal_Filter {
  /** Filter for the block changed event. */
  _change_block?: InputMaybe<BlockChangedFilter>;
  account?: InputMaybe<Scalars['String']['input']>;
  account_?: InputMaybe<Account_Filter>;
  account_contains?: InputMaybe<Scalars['String']['input']>;
  account_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  account_ends_with?: InputMaybe<Scalars['String']['input']>;
  account_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  account_gt?: InputMaybe<Scalars['String']['input']>;
  account_gte?: InputMaybe<Scalars['String']['input']>;
  account_in?: InputMaybe<Array<Scalars['String']['input']>>;
  account_lt?: InputMaybe<Scalars['String']['input']>;
  account_lte?: InputMaybe<Scalars['String']['input']>;
  account_not?: InputMaybe<Scalars['String']['input']>;
  account_not_contains?: InputMaybe<Scalars['String']['input']>;
  account_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  account_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  account_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  account_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  account_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  account_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  account_starts_with?: InputMaybe<Scalars['String']['input']>;
  account_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  amount?: InputMaybe<Scalars['BigInt']['input']>;
  amount_gt?: InputMaybe<Scalars['BigInt']['input']>;
  amount_gte?: InputMaybe<Scalars['BigInt']['input']>;
  amount_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  amount_lt?: InputMaybe<Scalars['BigInt']['input']>;
  amount_lte?: InputMaybe<Scalars['BigInt']['input']>;
  amount_not?: InputMaybe<Scalars['BigInt']['input']>;
  amount_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  and?: InputMaybe<Array<InputMaybe<QueuedWithdrawal_Filter>>>;
  basis?: InputMaybe<Scalars['BigInt']['input']>;
  basis_gt?: InputMaybe<Scalars['BigInt']['input']>;
  basis_gte?: InputMaybe<Scalars['BigInt']['input']>;
  basis_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  basis_lt?: InputMaybe<Scalars['BigInt']['input']>;
  basis_lte?: InputMaybe<Scalars['BigInt']['input']>;
  basis_not?: InputMaybe<Scalars['BigInt']['input']>;
  basis_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  epoch?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_gt?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_gte?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  epoch_lt?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_lte?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_not?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  hypoVault?: InputMaybe<Scalars['String']['input']>;
  hypoVault_?: InputMaybe<HypoVault_Filter>;
  hypoVault_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_lt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_lte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['Bytes']['input']>;
  id_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_gt?: InputMaybe<Scalars['Bytes']['input']>;
  id_gte?: InputMaybe<Scalars['Bytes']['input']>;
  id_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  id_lt?: InputMaybe<Scalars['Bytes']['input']>;
  id_lte?: InputMaybe<Scalars['Bytes']['input']>;
  id_not?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  or?: InputMaybe<Array<InputMaybe<QueuedWithdrawal_Filter>>>;
  shouldRedeposit?: InputMaybe<Scalars['Boolean']['input']>;
  shouldRedeposit_in?: InputMaybe<Array<Scalars['Boolean']['input']>>;
  shouldRedeposit_not?: InputMaybe<Scalars['Boolean']['input']>;
  shouldRedeposit_not_in?: InputMaybe<Array<Scalars['Boolean']['input']>>;
}

export enum QueuedWithdrawal_OrderBy {
  Account = 'account',
  AccountId = 'account__id',
  Amount = 'amount',
  Basis = 'basis',
  Epoch = 'epoch',
  HypoVault = 'hypoVault',
  HypoVaultAccountant = 'hypoVault__accountant',
  HypoVaultCreatedAt = 'hypoVault__createdAt',
  HypoVaultCreatedAtBlock = 'hypoVault__createdAtBlock',
  HypoVaultDepositEpoch = 'hypoVault__depositEpoch',
  HypoVaultFeeWallet = 'hypoVault__feeWallet',
  HypoVaultId = 'hypoVault__id',
  HypoVaultManager = 'hypoVault__manager',
  HypoVaultName = 'hypoVault__name',
  HypoVaultOwner = 'hypoVault__owner',
  HypoVaultPerformanceFeeBps = 'hypoVault__performanceFeeBps',
  HypoVaultReservedWithdrawalAssets = 'hypoVault__reservedWithdrawalAssets',
  HypoVaultShares = 'hypoVault__shares',
  HypoVaultSymbol = 'hypoVault__symbol',
  HypoVaultTotalAssetsDeposited = 'hypoVault__totalAssetsDeposited',
  HypoVaultTotalAssetsWithdrawn = 'hypoVault__totalAssetsWithdrawn',
  HypoVaultTotalPerformanceFeesCollected = 'hypoVault__totalPerformanceFeesCollected',
  HypoVaultUpdatedAt = 'hypoVault__updatedAt',
  HypoVaultUpdatedAtBlock = 'hypoVault__updatedAtBlock',
  HypoVaultWithdrawalEpoch = 'hypoVault__withdrawalEpoch',
  Id = 'id',
  ShouldRedeposit = 'shouldRedeposit'
}

export interface RedepositStatusChanged {
  __typename?: 'RedepositStatusChanged';
  blockNumber: Scalars['BigInt']['output'];
  blockTimestamp: Scalars['BigInt']['output'];
  epoch: Scalars['BigInt']['output'];
  hypoVault: HypoVault;
  id: Scalars['Bytes']['output'];
  shouldRedeposit: Scalars['Boolean']['output'];
  transactionHash: Scalars['Bytes']['output'];
  user: Account;
}

export interface RedepositStatusChanged_Filter {
  /** Filter for the block changed event. */
  _change_block?: InputMaybe<BlockChangedFilter>;
  and?: InputMaybe<Array<InputMaybe<RedepositStatusChanged_Filter>>>;
  blockNumber?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_gt?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_gte?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockNumber_lt?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_lte?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_not?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockTimestamp?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_gt?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_gte?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockTimestamp_lt?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_lte?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_not?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  epoch?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_gt?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_gte?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  epoch_lt?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_lte?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_not?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  hypoVault?: InputMaybe<Scalars['String']['input']>;
  hypoVault_?: InputMaybe<HypoVault_Filter>;
  hypoVault_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_lt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_lte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['Bytes']['input']>;
  id_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_gt?: InputMaybe<Scalars['Bytes']['input']>;
  id_gte?: InputMaybe<Scalars['Bytes']['input']>;
  id_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  id_lt?: InputMaybe<Scalars['Bytes']['input']>;
  id_lte?: InputMaybe<Scalars['Bytes']['input']>;
  id_not?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  or?: InputMaybe<Array<InputMaybe<RedepositStatusChanged_Filter>>>;
  shouldRedeposit?: InputMaybe<Scalars['Boolean']['input']>;
  shouldRedeposit_in?: InputMaybe<Array<Scalars['Boolean']['input']>>;
  shouldRedeposit_not?: InputMaybe<Scalars['Boolean']['input']>;
  shouldRedeposit_not_in?: InputMaybe<Array<Scalars['Boolean']['input']>>;
  transactionHash?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_contains?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_gt?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_gte?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  transactionHash_lt?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_lte?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  user?: InputMaybe<Scalars['String']['input']>;
  user_?: InputMaybe<Account_Filter>;
  user_contains?: InputMaybe<Scalars['String']['input']>;
  user_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  user_ends_with?: InputMaybe<Scalars['String']['input']>;
  user_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  user_gt?: InputMaybe<Scalars['String']['input']>;
  user_gte?: InputMaybe<Scalars['String']['input']>;
  user_in?: InputMaybe<Array<Scalars['String']['input']>>;
  user_lt?: InputMaybe<Scalars['String']['input']>;
  user_lte?: InputMaybe<Scalars['String']['input']>;
  user_not?: InputMaybe<Scalars['String']['input']>;
  user_not_contains?: InputMaybe<Scalars['String']['input']>;
  user_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  user_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  user_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  user_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  user_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  user_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  user_starts_with?: InputMaybe<Scalars['String']['input']>;
  user_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
}

export enum RedepositStatusChanged_OrderBy {
  BlockNumber = 'blockNumber',
  BlockTimestamp = 'blockTimestamp',
  Epoch = 'epoch',
  HypoVault = 'hypoVault',
  HypoVaultAccountant = 'hypoVault__accountant',
  HypoVaultCreatedAt = 'hypoVault__createdAt',
  HypoVaultCreatedAtBlock = 'hypoVault__createdAtBlock',
  HypoVaultDepositEpoch = 'hypoVault__depositEpoch',
  HypoVaultFeeWallet = 'hypoVault__feeWallet',
  HypoVaultId = 'hypoVault__id',
  HypoVaultManager = 'hypoVault__manager',
  HypoVaultName = 'hypoVault__name',
  HypoVaultOwner = 'hypoVault__owner',
  HypoVaultPerformanceFeeBps = 'hypoVault__performanceFeeBps',
  HypoVaultReservedWithdrawalAssets = 'hypoVault__reservedWithdrawalAssets',
  HypoVaultShares = 'hypoVault__shares',
  HypoVaultSymbol = 'hypoVault__symbol',
  HypoVaultTotalAssetsDeposited = 'hypoVault__totalAssetsDeposited',
  HypoVaultTotalAssetsWithdrawn = 'hypoVault__totalAssetsWithdrawn',
  HypoVaultTotalPerformanceFeesCollected = 'hypoVault__totalPerformanceFeesCollected',
  HypoVaultUpdatedAt = 'hypoVault__updatedAt',
  HypoVaultUpdatedAtBlock = 'hypoVault__updatedAtBlock',
  HypoVaultWithdrawalEpoch = 'hypoVault__withdrawalEpoch',
  Id = 'id',
  ShouldRedeposit = 'shouldRedeposit',
  TransactionHash = 'transactionHash',
  User = 'user',
  UserId = 'user__id'
}

export interface Token {
  __typename?: 'Token';
  /**  Token decimals  */
  decimals: Scalars['BigInt']['output'];
  /**  Derived price in ETH, used to provide human readable price  */
  derivedETH: Scalars['BigDecimal']['output'];
  /**  Token address  */
  id: Scalars['Bytes']['output'];
  /**  Token name  */
  name: Scalars['String']['output'];
  /**  Token symbol  */
  symbol: Scalars['String']['output'];
  /**  Token total supply  */
  totalSupply: Scalars['BigInt']['output'];
  /**  Pools token is in that are white listed for USD pricing  */
  whitelistPools: Array<Pool>;
}


export interface TokenWhitelistPoolsArgs {
  first?: InputMaybe<Scalars['Int']['input']>;
  orderBy?: InputMaybe<Pool_OrderBy>;
  orderDirection?: InputMaybe<OrderDirection>;
  skip?: InputMaybe<Scalars['Int']['input']>;
  where?: InputMaybe<Pool_Filter>;
}

export interface Token_Filter {
  /** Filter for the block changed event. */
  _change_block?: InputMaybe<BlockChangedFilter>;
  and?: InputMaybe<Array<InputMaybe<Token_Filter>>>;
  decimals?: InputMaybe<Scalars['BigInt']['input']>;
  decimals_gt?: InputMaybe<Scalars['BigInt']['input']>;
  decimals_gte?: InputMaybe<Scalars['BigInt']['input']>;
  decimals_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  decimals_lt?: InputMaybe<Scalars['BigInt']['input']>;
  decimals_lte?: InputMaybe<Scalars['BigInt']['input']>;
  decimals_not?: InputMaybe<Scalars['BigInt']['input']>;
  decimals_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  derivedETH?: InputMaybe<Scalars['BigDecimal']['input']>;
  derivedETH_gt?: InputMaybe<Scalars['BigDecimal']['input']>;
  derivedETH_gte?: InputMaybe<Scalars['BigDecimal']['input']>;
  derivedETH_in?: InputMaybe<Array<Scalars['BigDecimal']['input']>>;
  derivedETH_lt?: InputMaybe<Scalars['BigDecimal']['input']>;
  derivedETH_lte?: InputMaybe<Scalars['BigDecimal']['input']>;
  derivedETH_not?: InputMaybe<Scalars['BigDecimal']['input']>;
  derivedETH_not_in?: InputMaybe<Array<Scalars['BigDecimal']['input']>>;
  id?: InputMaybe<Scalars['Bytes']['input']>;
  id_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_gt?: InputMaybe<Scalars['Bytes']['input']>;
  id_gte?: InputMaybe<Scalars['Bytes']['input']>;
  id_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  id_lt?: InputMaybe<Scalars['Bytes']['input']>;
  id_lte?: InputMaybe<Scalars['Bytes']['input']>;
  id_not?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  name?: InputMaybe<Scalars['String']['input']>;
  name_contains?: InputMaybe<Scalars['String']['input']>;
  name_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  name_ends_with?: InputMaybe<Scalars['String']['input']>;
  name_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  name_gt?: InputMaybe<Scalars['String']['input']>;
  name_gte?: InputMaybe<Scalars['String']['input']>;
  name_in?: InputMaybe<Array<Scalars['String']['input']>>;
  name_lt?: InputMaybe<Scalars['String']['input']>;
  name_lte?: InputMaybe<Scalars['String']['input']>;
  name_not?: InputMaybe<Scalars['String']['input']>;
  name_not_contains?: InputMaybe<Scalars['String']['input']>;
  name_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  name_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  name_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  name_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  name_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  name_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  name_starts_with?: InputMaybe<Scalars['String']['input']>;
  name_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  or?: InputMaybe<Array<InputMaybe<Token_Filter>>>;
  symbol?: InputMaybe<Scalars['String']['input']>;
  symbol_contains?: InputMaybe<Scalars['String']['input']>;
  symbol_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  symbol_ends_with?: InputMaybe<Scalars['String']['input']>;
  symbol_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  symbol_gt?: InputMaybe<Scalars['String']['input']>;
  symbol_gte?: InputMaybe<Scalars['String']['input']>;
  symbol_in?: InputMaybe<Array<Scalars['String']['input']>>;
  symbol_lt?: InputMaybe<Scalars['String']['input']>;
  symbol_lte?: InputMaybe<Scalars['String']['input']>;
  symbol_not?: InputMaybe<Scalars['String']['input']>;
  symbol_not_contains?: InputMaybe<Scalars['String']['input']>;
  symbol_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  symbol_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  symbol_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  symbol_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  symbol_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  symbol_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  symbol_starts_with?: InputMaybe<Scalars['String']['input']>;
  symbol_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  totalSupply?: InputMaybe<Scalars['BigInt']['input']>;
  totalSupply_gt?: InputMaybe<Scalars['BigInt']['input']>;
  totalSupply_gte?: InputMaybe<Scalars['BigInt']['input']>;
  totalSupply_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  totalSupply_lt?: InputMaybe<Scalars['BigInt']['input']>;
  totalSupply_lte?: InputMaybe<Scalars['BigInt']['input']>;
  totalSupply_not?: InputMaybe<Scalars['BigInt']['input']>;
  totalSupply_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  whitelistPools?: InputMaybe<Array<Scalars['String']['input']>>;
  whitelistPools_?: InputMaybe<Pool_Filter>;
  whitelistPools_contains?: InputMaybe<Array<Scalars['String']['input']>>;
  whitelistPools_contains_nocase?: InputMaybe<Array<Scalars['String']['input']>>;
  whitelistPools_not?: InputMaybe<Array<Scalars['String']['input']>>;
  whitelistPools_not_contains?: InputMaybe<Array<Scalars['String']['input']>>;
  whitelistPools_not_contains_nocase?: InputMaybe<Array<Scalars['String']['input']>>;
}

export enum Token_OrderBy {
  Decimals = 'decimals',
  DerivedEth = 'derivedETH',
  Id = 'id',
  Name = 'name',
  Symbol = 'symbol',
  TotalSupply = 'totalSupply',
  WhitelistPools = 'whitelistPools'
}

export interface Transfer {
  __typename?: 'Transfer';
  amount: Scalars['BigInt']['output'];
  blockNumber: Scalars['BigInt']['output'];
  blockTimestamp: Scalars['BigInt']['output'];
  from: Account;
  hypoVault: HypoVault;
  id: Scalars['Bytes']['output'];
  to: Account;
  transactionHash: Scalars['Bytes']['output'];
}

export interface Transfer_Filter {
  /** Filter for the block changed event. */
  _change_block?: InputMaybe<BlockChangedFilter>;
  amount?: InputMaybe<Scalars['BigInt']['input']>;
  amount_gt?: InputMaybe<Scalars['BigInt']['input']>;
  amount_gte?: InputMaybe<Scalars['BigInt']['input']>;
  amount_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  amount_lt?: InputMaybe<Scalars['BigInt']['input']>;
  amount_lte?: InputMaybe<Scalars['BigInt']['input']>;
  amount_not?: InputMaybe<Scalars['BigInt']['input']>;
  amount_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  and?: InputMaybe<Array<InputMaybe<Transfer_Filter>>>;
  blockNumber?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_gt?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_gte?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockNumber_lt?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_lte?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_not?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockTimestamp?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_gt?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_gte?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockTimestamp_lt?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_lte?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_not?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  from?: InputMaybe<Scalars['String']['input']>;
  from_?: InputMaybe<Account_Filter>;
  from_contains?: InputMaybe<Scalars['String']['input']>;
  from_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  from_ends_with?: InputMaybe<Scalars['String']['input']>;
  from_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  from_gt?: InputMaybe<Scalars['String']['input']>;
  from_gte?: InputMaybe<Scalars['String']['input']>;
  from_in?: InputMaybe<Array<Scalars['String']['input']>>;
  from_lt?: InputMaybe<Scalars['String']['input']>;
  from_lte?: InputMaybe<Scalars['String']['input']>;
  from_not?: InputMaybe<Scalars['String']['input']>;
  from_not_contains?: InputMaybe<Scalars['String']['input']>;
  from_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  from_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  from_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  from_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  from_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  from_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  from_starts_with?: InputMaybe<Scalars['String']['input']>;
  from_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault?: InputMaybe<Scalars['String']['input']>;
  hypoVault_?: InputMaybe<HypoVault_Filter>;
  hypoVault_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_lt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_lte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['Bytes']['input']>;
  id_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_gt?: InputMaybe<Scalars['Bytes']['input']>;
  id_gte?: InputMaybe<Scalars['Bytes']['input']>;
  id_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  id_lt?: InputMaybe<Scalars['Bytes']['input']>;
  id_lte?: InputMaybe<Scalars['Bytes']['input']>;
  id_not?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  or?: InputMaybe<Array<InputMaybe<Transfer_Filter>>>;
  to?: InputMaybe<Scalars['String']['input']>;
  to_?: InputMaybe<Account_Filter>;
  to_contains?: InputMaybe<Scalars['String']['input']>;
  to_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  to_ends_with?: InputMaybe<Scalars['String']['input']>;
  to_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  to_gt?: InputMaybe<Scalars['String']['input']>;
  to_gte?: InputMaybe<Scalars['String']['input']>;
  to_in?: InputMaybe<Array<Scalars['String']['input']>>;
  to_lt?: InputMaybe<Scalars['String']['input']>;
  to_lte?: InputMaybe<Scalars['String']['input']>;
  to_not?: InputMaybe<Scalars['String']['input']>;
  to_not_contains?: InputMaybe<Scalars['String']['input']>;
  to_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  to_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  to_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  to_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  to_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  to_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  to_starts_with?: InputMaybe<Scalars['String']['input']>;
  to_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  transactionHash?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_contains?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_gt?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_gte?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  transactionHash_lt?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_lte?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
}

export enum Transfer_OrderBy {
  Amount = 'amount',
  BlockNumber = 'blockNumber',
  BlockTimestamp = 'blockTimestamp',
  From = 'from',
  FromId = 'from__id',
  HypoVault = 'hypoVault',
  HypoVaultAccountant = 'hypoVault__accountant',
  HypoVaultCreatedAt = 'hypoVault__createdAt',
  HypoVaultCreatedAtBlock = 'hypoVault__createdAtBlock',
  HypoVaultDepositEpoch = 'hypoVault__depositEpoch',
  HypoVaultFeeWallet = 'hypoVault__feeWallet',
  HypoVaultId = 'hypoVault__id',
  HypoVaultManager = 'hypoVault__manager',
  HypoVaultName = 'hypoVault__name',
  HypoVaultOwner = 'hypoVault__owner',
  HypoVaultPerformanceFeeBps = 'hypoVault__performanceFeeBps',
  HypoVaultReservedWithdrawalAssets = 'hypoVault__reservedWithdrawalAssets',
  HypoVaultShares = 'hypoVault__shares',
  HypoVaultSymbol = 'hypoVault__symbol',
  HypoVaultTotalAssetsDeposited = 'hypoVault__totalAssetsDeposited',
  HypoVaultTotalAssetsWithdrawn = 'hypoVault__totalAssetsWithdrawn',
  HypoVaultTotalPerformanceFeesCollected = 'hypoVault__totalPerformanceFeesCollected',
  HypoVaultUpdatedAt = 'hypoVault__updatedAt',
  HypoVaultUpdatedAtBlock = 'hypoVault__updatedAtBlock',
  HypoVaultWithdrawalEpoch = 'hypoVault__withdrawalEpoch',
  Id = 'id',
  To = 'to',
  ToId = 'to__id',
  TransactionHash = 'transactionHash'
}

export interface UserBalance {
  __typename?: 'UserBalance';
  account: Account;
  hypoVault: HypoVault;
  /**  <hypovault_address><account_address>  */
  id: Scalars['Bytes']['output'];
  shares: Scalars['BigInt']['output'];
}

export interface UserBalance_Filter {
  /** Filter for the block changed event. */
  _change_block?: InputMaybe<BlockChangedFilter>;
  account?: InputMaybe<Scalars['String']['input']>;
  account_?: InputMaybe<Account_Filter>;
  account_contains?: InputMaybe<Scalars['String']['input']>;
  account_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  account_ends_with?: InputMaybe<Scalars['String']['input']>;
  account_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  account_gt?: InputMaybe<Scalars['String']['input']>;
  account_gte?: InputMaybe<Scalars['String']['input']>;
  account_in?: InputMaybe<Array<Scalars['String']['input']>>;
  account_lt?: InputMaybe<Scalars['String']['input']>;
  account_lte?: InputMaybe<Scalars['String']['input']>;
  account_not?: InputMaybe<Scalars['String']['input']>;
  account_not_contains?: InputMaybe<Scalars['String']['input']>;
  account_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  account_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  account_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  account_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  account_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  account_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  account_starts_with?: InputMaybe<Scalars['String']['input']>;
  account_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  and?: InputMaybe<Array<InputMaybe<UserBalance_Filter>>>;
  hypoVault?: InputMaybe<Scalars['String']['input']>;
  hypoVault_?: InputMaybe<HypoVault_Filter>;
  hypoVault_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_lt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_lte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['Bytes']['input']>;
  id_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_gt?: InputMaybe<Scalars['Bytes']['input']>;
  id_gte?: InputMaybe<Scalars['Bytes']['input']>;
  id_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  id_lt?: InputMaybe<Scalars['Bytes']['input']>;
  id_lte?: InputMaybe<Scalars['Bytes']['input']>;
  id_not?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  or?: InputMaybe<Array<InputMaybe<UserBalance_Filter>>>;
  shares?: InputMaybe<Scalars['BigInt']['input']>;
  shares_gt?: InputMaybe<Scalars['BigInt']['input']>;
  shares_gte?: InputMaybe<Scalars['BigInt']['input']>;
  shares_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  shares_lt?: InputMaybe<Scalars['BigInt']['input']>;
  shares_lte?: InputMaybe<Scalars['BigInt']['input']>;
  shares_not?: InputMaybe<Scalars['BigInt']['input']>;
  shares_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
}

export enum UserBalance_OrderBy {
  Account = 'account',
  AccountId = 'account__id',
  HypoVault = 'hypoVault',
  HypoVaultAccountant = 'hypoVault__accountant',
  HypoVaultCreatedAt = 'hypoVault__createdAt',
  HypoVaultCreatedAtBlock = 'hypoVault__createdAtBlock',
  HypoVaultDepositEpoch = 'hypoVault__depositEpoch',
  HypoVaultFeeWallet = 'hypoVault__feeWallet',
  HypoVaultId = 'hypoVault__id',
  HypoVaultManager = 'hypoVault__manager',
  HypoVaultName = 'hypoVault__name',
  HypoVaultOwner = 'hypoVault__owner',
  HypoVaultPerformanceFeeBps = 'hypoVault__performanceFeeBps',
  HypoVaultReservedWithdrawalAssets = 'hypoVault__reservedWithdrawalAssets',
  HypoVaultShares = 'hypoVault__shares',
  HypoVaultSymbol = 'hypoVault__symbol',
  HypoVaultTotalAssetsDeposited = 'hypoVault__totalAssetsDeposited',
  HypoVaultTotalAssetsWithdrawn = 'hypoVault__totalAssetsWithdrawn',
  HypoVaultTotalPerformanceFeesCollected = 'hypoVault__totalPerformanceFeesCollected',
  HypoVaultUpdatedAt = 'hypoVault__updatedAt',
  HypoVaultUpdatedAtBlock = 'hypoVault__updatedAtBlock',
  HypoVaultWithdrawalEpoch = 'hypoVault__withdrawalEpoch',
  Id = 'id',
  Shares = 'shares'
}

export interface UserBasis {
  __typename?: 'UserBasis';
  account: Account;
  /**  User basis in the hypoVault's underlying token  */
  basis: Scalars['BigInt']['output'];
  /**  User basis converted to ETH  */
  basisInETH: Scalars['BigDecimal']['output'];
  /**  User basis converted to USD  */
  basisInUSD: Scalars['BigDecimal']['output'];
  hypoVault: HypoVault;
  id: Scalars['Bytes']['output'];
}

export interface UserBasis_Filter {
  /** Filter for the block changed event. */
  _change_block?: InputMaybe<BlockChangedFilter>;
  account?: InputMaybe<Scalars['String']['input']>;
  account_?: InputMaybe<Account_Filter>;
  account_contains?: InputMaybe<Scalars['String']['input']>;
  account_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  account_ends_with?: InputMaybe<Scalars['String']['input']>;
  account_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  account_gt?: InputMaybe<Scalars['String']['input']>;
  account_gte?: InputMaybe<Scalars['String']['input']>;
  account_in?: InputMaybe<Array<Scalars['String']['input']>>;
  account_lt?: InputMaybe<Scalars['String']['input']>;
  account_lte?: InputMaybe<Scalars['String']['input']>;
  account_not?: InputMaybe<Scalars['String']['input']>;
  account_not_contains?: InputMaybe<Scalars['String']['input']>;
  account_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  account_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  account_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  account_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  account_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  account_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  account_starts_with?: InputMaybe<Scalars['String']['input']>;
  account_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  and?: InputMaybe<Array<InputMaybe<UserBasis_Filter>>>;
  basis?: InputMaybe<Scalars['BigInt']['input']>;
  basisInETH?: InputMaybe<Scalars['BigDecimal']['input']>;
  basisInETH_gt?: InputMaybe<Scalars['BigDecimal']['input']>;
  basisInETH_gte?: InputMaybe<Scalars['BigDecimal']['input']>;
  basisInETH_in?: InputMaybe<Array<Scalars['BigDecimal']['input']>>;
  basisInETH_lt?: InputMaybe<Scalars['BigDecimal']['input']>;
  basisInETH_lte?: InputMaybe<Scalars['BigDecimal']['input']>;
  basisInETH_not?: InputMaybe<Scalars['BigDecimal']['input']>;
  basisInETH_not_in?: InputMaybe<Array<Scalars['BigDecimal']['input']>>;
  basisInUSD?: InputMaybe<Scalars['BigDecimal']['input']>;
  basisInUSD_gt?: InputMaybe<Scalars['BigDecimal']['input']>;
  basisInUSD_gte?: InputMaybe<Scalars['BigDecimal']['input']>;
  basisInUSD_in?: InputMaybe<Array<Scalars['BigDecimal']['input']>>;
  basisInUSD_lt?: InputMaybe<Scalars['BigDecimal']['input']>;
  basisInUSD_lte?: InputMaybe<Scalars['BigDecimal']['input']>;
  basisInUSD_not?: InputMaybe<Scalars['BigDecimal']['input']>;
  basisInUSD_not_in?: InputMaybe<Array<Scalars['BigDecimal']['input']>>;
  basis_gt?: InputMaybe<Scalars['BigInt']['input']>;
  basis_gte?: InputMaybe<Scalars['BigInt']['input']>;
  basis_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  basis_lt?: InputMaybe<Scalars['BigInt']['input']>;
  basis_lte?: InputMaybe<Scalars['BigInt']['input']>;
  basis_not?: InputMaybe<Scalars['BigInt']['input']>;
  basis_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  hypoVault?: InputMaybe<Scalars['String']['input']>;
  hypoVault_?: InputMaybe<HypoVault_Filter>;
  hypoVault_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_lt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_lte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['Bytes']['input']>;
  id_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_gt?: InputMaybe<Scalars['Bytes']['input']>;
  id_gte?: InputMaybe<Scalars['Bytes']['input']>;
  id_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  id_lt?: InputMaybe<Scalars['Bytes']['input']>;
  id_lte?: InputMaybe<Scalars['Bytes']['input']>;
  id_not?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  or?: InputMaybe<Array<InputMaybe<UserBasis_Filter>>>;
}

export enum UserBasis_OrderBy {
  Account = 'account',
  AccountId = 'account__id',
  Basis = 'basis',
  BasisInEth = 'basisInETH',
  BasisInUsd = 'basisInUSD',
  HypoVault = 'hypoVault',
  HypoVaultAccountant = 'hypoVault__accountant',
  HypoVaultCreatedAt = 'hypoVault__createdAt',
  HypoVaultCreatedAtBlock = 'hypoVault__createdAtBlock',
  HypoVaultDepositEpoch = 'hypoVault__depositEpoch',
  HypoVaultFeeWallet = 'hypoVault__feeWallet',
  HypoVaultId = 'hypoVault__id',
  HypoVaultManager = 'hypoVault__manager',
  HypoVaultName = 'hypoVault__name',
  HypoVaultOwner = 'hypoVault__owner',
  HypoVaultPerformanceFeeBps = 'hypoVault__performanceFeeBps',
  HypoVaultReservedWithdrawalAssets = 'hypoVault__reservedWithdrawalAssets',
  HypoVaultShares = 'hypoVault__shares',
  HypoVaultSymbol = 'hypoVault__symbol',
  HypoVaultTotalAssetsDeposited = 'hypoVault__totalAssetsDeposited',
  HypoVaultTotalAssetsWithdrawn = 'hypoVault__totalAssetsWithdrawn',
  HypoVaultTotalPerformanceFeesCollected = 'hypoVault__totalPerformanceFeesCollected',
  HypoVaultUpdatedAt = 'hypoVault__updatedAt',
  HypoVaultUpdatedAtBlock = 'hypoVault__updatedAtBlock',
  HypoVaultWithdrawalEpoch = 'hypoVault__withdrawalEpoch',
  Id = 'id'
}

export interface WithdrawalCancelled {
  __typename?: 'WithdrawalCancelled';
  blockNumber: Scalars['BigInt']['output'];
  blockTimestamp: Scalars['BigInt']['output'];
  hypoVault: HypoVault;
  id: Scalars['Bytes']['output'];
  shares: Scalars['BigInt']['output'];
  transactionHash: Scalars['Bytes']['output'];
  user: Account;
}

export interface WithdrawalCancelled_Filter {
  /** Filter for the block changed event. */
  _change_block?: InputMaybe<BlockChangedFilter>;
  and?: InputMaybe<Array<InputMaybe<WithdrawalCancelled_Filter>>>;
  blockNumber?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_gt?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_gte?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockNumber_lt?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_lte?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_not?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockTimestamp?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_gt?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_gte?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockTimestamp_lt?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_lte?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_not?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  hypoVault?: InputMaybe<Scalars['String']['input']>;
  hypoVault_?: InputMaybe<HypoVault_Filter>;
  hypoVault_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_lt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_lte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['Bytes']['input']>;
  id_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_gt?: InputMaybe<Scalars['Bytes']['input']>;
  id_gte?: InputMaybe<Scalars['Bytes']['input']>;
  id_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  id_lt?: InputMaybe<Scalars['Bytes']['input']>;
  id_lte?: InputMaybe<Scalars['Bytes']['input']>;
  id_not?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  or?: InputMaybe<Array<InputMaybe<WithdrawalCancelled_Filter>>>;
  shares?: InputMaybe<Scalars['BigInt']['input']>;
  shares_gt?: InputMaybe<Scalars['BigInt']['input']>;
  shares_gte?: InputMaybe<Scalars['BigInt']['input']>;
  shares_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  shares_lt?: InputMaybe<Scalars['BigInt']['input']>;
  shares_lte?: InputMaybe<Scalars['BigInt']['input']>;
  shares_not?: InputMaybe<Scalars['BigInt']['input']>;
  shares_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  transactionHash?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_contains?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_gt?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_gte?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  transactionHash_lt?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_lte?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  user?: InputMaybe<Scalars['String']['input']>;
  user_?: InputMaybe<Account_Filter>;
  user_contains?: InputMaybe<Scalars['String']['input']>;
  user_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  user_ends_with?: InputMaybe<Scalars['String']['input']>;
  user_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  user_gt?: InputMaybe<Scalars['String']['input']>;
  user_gte?: InputMaybe<Scalars['String']['input']>;
  user_in?: InputMaybe<Array<Scalars['String']['input']>>;
  user_lt?: InputMaybe<Scalars['String']['input']>;
  user_lte?: InputMaybe<Scalars['String']['input']>;
  user_not?: InputMaybe<Scalars['String']['input']>;
  user_not_contains?: InputMaybe<Scalars['String']['input']>;
  user_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  user_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  user_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  user_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  user_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  user_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  user_starts_with?: InputMaybe<Scalars['String']['input']>;
  user_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
}

export enum WithdrawalCancelled_OrderBy {
  BlockNumber = 'blockNumber',
  BlockTimestamp = 'blockTimestamp',
  HypoVault = 'hypoVault',
  HypoVaultAccountant = 'hypoVault__accountant',
  HypoVaultCreatedAt = 'hypoVault__createdAt',
  HypoVaultCreatedAtBlock = 'hypoVault__createdAtBlock',
  HypoVaultDepositEpoch = 'hypoVault__depositEpoch',
  HypoVaultFeeWallet = 'hypoVault__feeWallet',
  HypoVaultId = 'hypoVault__id',
  HypoVaultManager = 'hypoVault__manager',
  HypoVaultName = 'hypoVault__name',
  HypoVaultOwner = 'hypoVault__owner',
  HypoVaultPerformanceFeeBps = 'hypoVault__performanceFeeBps',
  HypoVaultReservedWithdrawalAssets = 'hypoVault__reservedWithdrawalAssets',
  HypoVaultShares = 'hypoVault__shares',
  HypoVaultSymbol = 'hypoVault__symbol',
  HypoVaultTotalAssetsDeposited = 'hypoVault__totalAssetsDeposited',
  HypoVaultTotalAssetsWithdrawn = 'hypoVault__totalAssetsWithdrawn',
  HypoVaultTotalPerformanceFeesCollected = 'hypoVault__totalPerformanceFeesCollected',
  HypoVaultUpdatedAt = 'hypoVault__updatedAt',
  HypoVaultUpdatedAtBlock = 'hypoVault__updatedAtBlock',
  HypoVaultWithdrawalEpoch = 'hypoVault__withdrawalEpoch',
  Id = 'id',
  Shares = 'shares',
  TransactionHash = 'transactionHash',
  User = 'user',
  UserId = 'user__id'
}

export interface WithdrawalEpochState {
  __typename?: 'WithdrawalEpochState';
  assetsReceived: Scalars['BigInt']['output'];
  epoch: Scalars['BigInt']['output'];
  hypoVault: HypoVault;
  /**  Byte concatenation of hypoVault + withdrawal epoch  */
  id: Scalars['Bytes']['output'];
  sharesFulfilled: Scalars['BigInt']['output'];
  sharesWithdrawn: Scalars['BigInt']['output'];
}

export interface WithdrawalEpochState_Filter {
  /** Filter for the block changed event. */
  _change_block?: InputMaybe<BlockChangedFilter>;
  and?: InputMaybe<Array<InputMaybe<WithdrawalEpochState_Filter>>>;
  assetsReceived?: InputMaybe<Scalars['BigInt']['input']>;
  assetsReceived_gt?: InputMaybe<Scalars['BigInt']['input']>;
  assetsReceived_gte?: InputMaybe<Scalars['BigInt']['input']>;
  assetsReceived_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  assetsReceived_lt?: InputMaybe<Scalars['BigInt']['input']>;
  assetsReceived_lte?: InputMaybe<Scalars['BigInt']['input']>;
  assetsReceived_not?: InputMaybe<Scalars['BigInt']['input']>;
  assetsReceived_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  epoch?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_gt?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_gte?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  epoch_lt?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_lte?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_not?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  hypoVault?: InputMaybe<Scalars['String']['input']>;
  hypoVault_?: InputMaybe<HypoVault_Filter>;
  hypoVault_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_lt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_lte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['Bytes']['input']>;
  id_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_gt?: InputMaybe<Scalars['Bytes']['input']>;
  id_gte?: InputMaybe<Scalars['Bytes']['input']>;
  id_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  id_lt?: InputMaybe<Scalars['Bytes']['input']>;
  id_lte?: InputMaybe<Scalars['Bytes']['input']>;
  id_not?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  or?: InputMaybe<Array<InputMaybe<WithdrawalEpochState_Filter>>>;
  sharesFulfilled?: InputMaybe<Scalars['BigInt']['input']>;
  sharesFulfilled_gt?: InputMaybe<Scalars['BigInt']['input']>;
  sharesFulfilled_gte?: InputMaybe<Scalars['BigInt']['input']>;
  sharesFulfilled_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  sharesFulfilled_lt?: InputMaybe<Scalars['BigInt']['input']>;
  sharesFulfilled_lte?: InputMaybe<Scalars['BigInt']['input']>;
  sharesFulfilled_not?: InputMaybe<Scalars['BigInt']['input']>;
  sharesFulfilled_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  sharesWithdrawn?: InputMaybe<Scalars['BigInt']['input']>;
  sharesWithdrawn_gt?: InputMaybe<Scalars['BigInt']['input']>;
  sharesWithdrawn_gte?: InputMaybe<Scalars['BigInt']['input']>;
  sharesWithdrawn_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  sharesWithdrawn_lt?: InputMaybe<Scalars['BigInt']['input']>;
  sharesWithdrawn_lte?: InputMaybe<Scalars['BigInt']['input']>;
  sharesWithdrawn_not?: InputMaybe<Scalars['BigInt']['input']>;
  sharesWithdrawn_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
}

export enum WithdrawalEpochState_OrderBy {
  AssetsReceived = 'assetsReceived',
  Epoch = 'epoch',
  HypoVault = 'hypoVault',
  HypoVaultAccountant = 'hypoVault__accountant',
  HypoVaultCreatedAt = 'hypoVault__createdAt',
  HypoVaultCreatedAtBlock = 'hypoVault__createdAtBlock',
  HypoVaultDepositEpoch = 'hypoVault__depositEpoch',
  HypoVaultFeeWallet = 'hypoVault__feeWallet',
  HypoVaultId = 'hypoVault__id',
  HypoVaultManager = 'hypoVault__manager',
  HypoVaultName = 'hypoVault__name',
  HypoVaultOwner = 'hypoVault__owner',
  HypoVaultPerformanceFeeBps = 'hypoVault__performanceFeeBps',
  HypoVaultReservedWithdrawalAssets = 'hypoVault__reservedWithdrawalAssets',
  HypoVaultShares = 'hypoVault__shares',
  HypoVaultSymbol = 'hypoVault__symbol',
  HypoVaultTotalAssetsDeposited = 'hypoVault__totalAssetsDeposited',
  HypoVaultTotalAssetsWithdrawn = 'hypoVault__totalAssetsWithdrawn',
  HypoVaultTotalPerformanceFeesCollected = 'hypoVault__totalPerformanceFeesCollected',
  HypoVaultUpdatedAt = 'hypoVault__updatedAt',
  HypoVaultUpdatedAtBlock = 'hypoVault__updatedAtBlock',
  HypoVaultWithdrawalEpoch = 'hypoVault__withdrawalEpoch',
  Id = 'id',
  SharesFulfilled = 'sharesFulfilled',
  SharesWithdrawn = 'sharesWithdrawn'
}

export interface WithdrawalExecuted {
  __typename?: 'WithdrawalExecuted';
  assets: Scalars['BigInt']['output'];
  blockNumber: Scalars['BigInt']['output'];
  blockTimestamp: Scalars['BigInt']['output'];
  epoch: Scalars['BigInt']['output'];
  hypoVault: HypoVault;
  id: Scalars['Bytes']['output'];
  performanceFee: Scalars['BigInt']['output'];
  shares: Scalars['BigInt']['output'];
  shouldRedeposit: Scalars['Boolean']['output'];
  transactionHash: Scalars['Bytes']['output'];
  user: Account;
}

export interface WithdrawalExecuted_Filter {
  /** Filter for the block changed event. */
  _change_block?: InputMaybe<BlockChangedFilter>;
  and?: InputMaybe<Array<InputMaybe<WithdrawalExecuted_Filter>>>;
  assets?: InputMaybe<Scalars['BigInt']['input']>;
  assets_gt?: InputMaybe<Scalars['BigInt']['input']>;
  assets_gte?: InputMaybe<Scalars['BigInt']['input']>;
  assets_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  assets_lt?: InputMaybe<Scalars['BigInt']['input']>;
  assets_lte?: InputMaybe<Scalars['BigInt']['input']>;
  assets_not?: InputMaybe<Scalars['BigInt']['input']>;
  assets_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockNumber?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_gt?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_gte?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockNumber_lt?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_lte?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_not?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockTimestamp?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_gt?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_gte?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockTimestamp_lt?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_lte?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_not?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  epoch?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_gt?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_gte?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  epoch_lt?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_lte?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_not?: InputMaybe<Scalars['BigInt']['input']>;
  epoch_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  hypoVault?: InputMaybe<Scalars['String']['input']>;
  hypoVault_?: InputMaybe<HypoVault_Filter>;
  hypoVault_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_lt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_lte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['Bytes']['input']>;
  id_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_gt?: InputMaybe<Scalars['Bytes']['input']>;
  id_gte?: InputMaybe<Scalars['Bytes']['input']>;
  id_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  id_lt?: InputMaybe<Scalars['Bytes']['input']>;
  id_lte?: InputMaybe<Scalars['Bytes']['input']>;
  id_not?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  or?: InputMaybe<Array<InputMaybe<WithdrawalExecuted_Filter>>>;
  performanceFee?: InputMaybe<Scalars['BigInt']['input']>;
  performanceFee_gt?: InputMaybe<Scalars['BigInt']['input']>;
  performanceFee_gte?: InputMaybe<Scalars['BigInt']['input']>;
  performanceFee_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  performanceFee_lt?: InputMaybe<Scalars['BigInt']['input']>;
  performanceFee_lte?: InputMaybe<Scalars['BigInt']['input']>;
  performanceFee_not?: InputMaybe<Scalars['BigInt']['input']>;
  performanceFee_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  shares?: InputMaybe<Scalars['BigInt']['input']>;
  shares_gt?: InputMaybe<Scalars['BigInt']['input']>;
  shares_gte?: InputMaybe<Scalars['BigInt']['input']>;
  shares_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  shares_lt?: InputMaybe<Scalars['BigInt']['input']>;
  shares_lte?: InputMaybe<Scalars['BigInt']['input']>;
  shares_not?: InputMaybe<Scalars['BigInt']['input']>;
  shares_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  shouldRedeposit?: InputMaybe<Scalars['Boolean']['input']>;
  shouldRedeposit_in?: InputMaybe<Array<Scalars['Boolean']['input']>>;
  shouldRedeposit_not?: InputMaybe<Scalars['Boolean']['input']>;
  shouldRedeposit_not_in?: InputMaybe<Array<Scalars['Boolean']['input']>>;
  transactionHash?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_contains?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_gt?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_gte?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  transactionHash_lt?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_lte?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  user?: InputMaybe<Scalars['String']['input']>;
  user_?: InputMaybe<Account_Filter>;
  user_contains?: InputMaybe<Scalars['String']['input']>;
  user_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  user_ends_with?: InputMaybe<Scalars['String']['input']>;
  user_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  user_gt?: InputMaybe<Scalars['String']['input']>;
  user_gte?: InputMaybe<Scalars['String']['input']>;
  user_in?: InputMaybe<Array<Scalars['String']['input']>>;
  user_lt?: InputMaybe<Scalars['String']['input']>;
  user_lte?: InputMaybe<Scalars['String']['input']>;
  user_not?: InputMaybe<Scalars['String']['input']>;
  user_not_contains?: InputMaybe<Scalars['String']['input']>;
  user_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  user_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  user_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  user_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  user_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  user_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  user_starts_with?: InputMaybe<Scalars['String']['input']>;
  user_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
}

export enum WithdrawalExecuted_OrderBy {
  Assets = 'assets',
  BlockNumber = 'blockNumber',
  BlockTimestamp = 'blockTimestamp',
  Epoch = 'epoch',
  HypoVault = 'hypoVault',
  HypoVaultAccountant = 'hypoVault__accountant',
  HypoVaultCreatedAt = 'hypoVault__createdAt',
  HypoVaultCreatedAtBlock = 'hypoVault__createdAtBlock',
  HypoVaultDepositEpoch = 'hypoVault__depositEpoch',
  HypoVaultFeeWallet = 'hypoVault__feeWallet',
  HypoVaultId = 'hypoVault__id',
  HypoVaultManager = 'hypoVault__manager',
  HypoVaultName = 'hypoVault__name',
  HypoVaultOwner = 'hypoVault__owner',
  HypoVaultPerformanceFeeBps = 'hypoVault__performanceFeeBps',
  HypoVaultReservedWithdrawalAssets = 'hypoVault__reservedWithdrawalAssets',
  HypoVaultShares = 'hypoVault__shares',
  HypoVaultSymbol = 'hypoVault__symbol',
  HypoVaultTotalAssetsDeposited = 'hypoVault__totalAssetsDeposited',
  HypoVaultTotalAssetsWithdrawn = 'hypoVault__totalAssetsWithdrawn',
  HypoVaultTotalPerformanceFeesCollected = 'hypoVault__totalPerformanceFeesCollected',
  HypoVaultUpdatedAt = 'hypoVault__updatedAt',
  HypoVaultUpdatedAtBlock = 'hypoVault__updatedAtBlock',
  HypoVaultWithdrawalEpoch = 'hypoVault__withdrawalEpoch',
  Id = 'id',
  PerformanceFee = 'performanceFee',
  Shares = 'shares',
  ShouldRedeposit = 'shouldRedeposit',
  TransactionHash = 'transactionHash',
  User = 'user',
  UserId = 'user__id'
}

export interface WithdrawalRequested {
  __typename?: 'WithdrawalRequested';
  blockNumber: Scalars['BigInt']['output'];
  blockTimestamp: Scalars['BigInt']['output'];
  hypoVault: HypoVault;
  id: Scalars['Bytes']['output'];
  shares: Scalars['BigInt']['output'];
  shouldRedeposit: Scalars['Boolean']['output'];
  transactionHash: Scalars['Bytes']['output'];
  user: Account;
}

export interface WithdrawalRequested_Filter {
  /** Filter for the block changed event. */
  _change_block?: InputMaybe<BlockChangedFilter>;
  and?: InputMaybe<Array<InputMaybe<WithdrawalRequested_Filter>>>;
  blockNumber?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_gt?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_gte?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockNumber_lt?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_lte?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_not?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockTimestamp?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_gt?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_gte?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockTimestamp_lt?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_lte?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_not?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  hypoVault?: InputMaybe<Scalars['String']['input']>;
  hypoVault_?: InputMaybe<HypoVault_Filter>;
  hypoVault_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_lt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_lte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['Bytes']['input']>;
  id_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_gt?: InputMaybe<Scalars['Bytes']['input']>;
  id_gte?: InputMaybe<Scalars['Bytes']['input']>;
  id_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  id_lt?: InputMaybe<Scalars['Bytes']['input']>;
  id_lte?: InputMaybe<Scalars['Bytes']['input']>;
  id_not?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  or?: InputMaybe<Array<InputMaybe<WithdrawalRequested_Filter>>>;
  shares?: InputMaybe<Scalars['BigInt']['input']>;
  shares_gt?: InputMaybe<Scalars['BigInt']['input']>;
  shares_gte?: InputMaybe<Scalars['BigInt']['input']>;
  shares_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  shares_lt?: InputMaybe<Scalars['BigInt']['input']>;
  shares_lte?: InputMaybe<Scalars['BigInt']['input']>;
  shares_not?: InputMaybe<Scalars['BigInt']['input']>;
  shares_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  shouldRedeposit?: InputMaybe<Scalars['Boolean']['input']>;
  shouldRedeposit_in?: InputMaybe<Array<Scalars['Boolean']['input']>>;
  shouldRedeposit_not?: InputMaybe<Scalars['Boolean']['input']>;
  shouldRedeposit_not_in?: InputMaybe<Array<Scalars['Boolean']['input']>>;
  transactionHash?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_contains?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_gt?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_gte?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  transactionHash_lt?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_lte?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  user?: InputMaybe<Scalars['String']['input']>;
  user_?: InputMaybe<Account_Filter>;
  user_contains?: InputMaybe<Scalars['String']['input']>;
  user_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  user_ends_with?: InputMaybe<Scalars['String']['input']>;
  user_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  user_gt?: InputMaybe<Scalars['String']['input']>;
  user_gte?: InputMaybe<Scalars['String']['input']>;
  user_in?: InputMaybe<Array<Scalars['String']['input']>>;
  user_lt?: InputMaybe<Scalars['String']['input']>;
  user_lte?: InputMaybe<Scalars['String']['input']>;
  user_not?: InputMaybe<Scalars['String']['input']>;
  user_not_contains?: InputMaybe<Scalars['String']['input']>;
  user_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  user_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  user_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  user_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  user_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  user_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  user_starts_with?: InputMaybe<Scalars['String']['input']>;
  user_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
}

export enum WithdrawalRequested_OrderBy {
  BlockNumber = 'blockNumber',
  BlockTimestamp = 'blockTimestamp',
  HypoVault = 'hypoVault',
  HypoVaultAccountant = 'hypoVault__accountant',
  HypoVaultCreatedAt = 'hypoVault__createdAt',
  HypoVaultCreatedAtBlock = 'hypoVault__createdAtBlock',
  HypoVaultDepositEpoch = 'hypoVault__depositEpoch',
  HypoVaultFeeWallet = 'hypoVault__feeWallet',
  HypoVaultId = 'hypoVault__id',
  HypoVaultManager = 'hypoVault__manager',
  HypoVaultName = 'hypoVault__name',
  HypoVaultOwner = 'hypoVault__owner',
  HypoVaultPerformanceFeeBps = 'hypoVault__performanceFeeBps',
  HypoVaultReservedWithdrawalAssets = 'hypoVault__reservedWithdrawalAssets',
  HypoVaultShares = 'hypoVault__shares',
  HypoVaultSymbol = 'hypoVault__symbol',
  HypoVaultTotalAssetsDeposited = 'hypoVault__totalAssetsDeposited',
  HypoVaultTotalAssetsWithdrawn = 'hypoVault__totalAssetsWithdrawn',
  HypoVaultTotalPerformanceFeesCollected = 'hypoVault__totalPerformanceFeesCollected',
  HypoVaultUpdatedAt = 'hypoVault__updatedAt',
  HypoVaultUpdatedAtBlock = 'hypoVault__updatedAtBlock',
  HypoVaultWithdrawalEpoch = 'hypoVault__withdrawalEpoch',
  Id = 'id',
  Shares = 'shares',
  ShouldRedeposit = 'shouldRedeposit',
  TransactionHash = 'transactionHash',
  User = 'user',
  UserId = 'user__id'
}

export interface WithdrawalsFulfilled {
  __typename?: 'WithdrawalsFulfilled';
  assetsReceived: Scalars['BigInt']['output'];
  blockNumber: Scalars['BigInt']['output'];
  blockTimestamp: Scalars['BigInt']['output'];
  hypoVault: HypoVault;
  id: Scalars['Bytes']['output'];
  nextEpoch: Scalars['BigInt']['output'];
  sharesFulfilled: Scalars['BigInt']['output'];
  transactionHash: Scalars['Bytes']['output'];
}

export interface WithdrawalsFulfilled_Filter {
  /** Filter for the block changed event. */
  _change_block?: InputMaybe<BlockChangedFilter>;
  and?: InputMaybe<Array<InputMaybe<WithdrawalsFulfilled_Filter>>>;
  assetsReceived?: InputMaybe<Scalars['BigInt']['input']>;
  assetsReceived_gt?: InputMaybe<Scalars['BigInt']['input']>;
  assetsReceived_gte?: InputMaybe<Scalars['BigInt']['input']>;
  assetsReceived_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  assetsReceived_lt?: InputMaybe<Scalars['BigInt']['input']>;
  assetsReceived_lte?: InputMaybe<Scalars['BigInt']['input']>;
  assetsReceived_not?: InputMaybe<Scalars['BigInt']['input']>;
  assetsReceived_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockNumber?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_gt?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_gte?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockNumber_lt?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_lte?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_not?: InputMaybe<Scalars['BigInt']['input']>;
  blockNumber_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockTimestamp?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_gt?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_gte?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  blockTimestamp_lt?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_lte?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_not?: InputMaybe<Scalars['BigInt']['input']>;
  blockTimestamp_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  hypoVault?: InputMaybe<Scalars['String']['input']>;
  hypoVault_?: InputMaybe<HypoVault_Filter>;
  hypoVault_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_gte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_lt?: InputMaybe<Scalars['String']['input']>;
  hypoVault_lte?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_contains_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_ends_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_in?: InputMaybe<Array<Scalars['String']['input']>>;
  hypoVault_not_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_not_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with?: InputMaybe<Scalars['String']['input']>;
  hypoVault_starts_with_nocase?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['Bytes']['input']>;
  id_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_gt?: InputMaybe<Scalars['Bytes']['input']>;
  id_gte?: InputMaybe<Scalars['Bytes']['input']>;
  id_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  id_lt?: InputMaybe<Scalars['Bytes']['input']>;
  id_lte?: InputMaybe<Scalars['Bytes']['input']>;
  id_not?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  id_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  nextEpoch?: InputMaybe<Scalars['BigInt']['input']>;
  nextEpoch_gt?: InputMaybe<Scalars['BigInt']['input']>;
  nextEpoch_gte?: InputMaybe<Scalars['BigInt']['input']>;
  nextEpoch_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  nextEpoch_lt?: InputMaybe<Scalars['BigInt']['input']>;
  nextEpoch_lte?: InputMaybe<Scalars['BigInt']['input']>;
  nextEpoch_not?: InputMaybe<Scalars['BigInt']['input']>;
  nextEpoch_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  or?: InputMaybe<Array<InputMaybe<WithdrawalsFulfilled_Filter>>>;
  sharesFulfilled?: InputMaybe<Scalars['BigInt']['input']>;
  sharesFulfilled_gt?: InputMaybe<Scalars['BigInt']['input']>;
  sharesFulfilled_gte?: InputMaybe<Scalars['BigInt']['input']>;
  sharesFulfilled_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  sharesFulfilled_lt?: InputMaybe<Scalars['BigInt']['input']>;
  sharesFulfilled_lte?: InputMaybe<Scalars['BigInt']['input']>;
  sharesFulfilled_not?: InputMaybe<Scalars['BigInt']['input']>;
  sharesFulfilled_not_in?: InputMaybe<Array<Scalars['BigInt']['input']>>;
  transactionHash?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_contains?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_gt?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_gte?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
  transactionHash_lt?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_lte?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not_contains?: InputMaybe<Scalars['Bytes']['input']>;
  transactionHash_not_in?: InputMaybe<Array<Scalars['Bytes']['input']>>;
}

export enum WithdrawalsFulfilled_OrderBy {
  AssetsReceived = 'assetsReceived',
  BlockNumber = 'blockNumber',
  BlockTimestamp = 'blockTimestamp',
  HypoVault = 'hypoVault',
  HypoVaultAccountant = 'hypoVault__accountant',
  HypoVaultCreatedAt = 'hypoVault__createdAt',
  HypoVaultCreatedAtBlock = 'hypoVault__createdAtBlock',
  HypoVaultDepositEpoch = 'hypoVault__depositEpoch',
  HypoVaultFeeWallet = 'hypoVault__feeWallet',
  HypoVaultId = 'hypoVault__id',
  HypoVaultManager = 'hypoVault__manager',
  HypoVaultName = 'hypoVault__name',
  HypoVaultOwner = 'hypoVault__owner',
  HypoVaultPerformanceFeeBps = 'hypoVault__performanceFeeBps',
  HypoVaultReservedWithdrawalAssets = 'hypoVault__reservedWithdrawalAssets',
  HypoVaultShares = 'hypoVault__shares',
  HypoVaultSymbol = 'hypoVault__symbol',
  HypoVaultTotalAssetsDeposited = 'hypoVault__totalAssetsDeposited',
  HypoVaultTotalAssetsWithdrawn = 'hypoVault__totalAssetsWithdrawn',
  HypoVaultTotalPerformanceFeesCollected = 'hypoVault__totalPerformanceFeesCollected',
  HypoVaultUpdatedAt = 'hypoVault__updatedAt',
  HypoVaultUpdatedAtBlock = 'hypoVault__updatedAtBlock',
  HypoVaultWithdrawalEpoch = 'hypoVault__withdrawalEpoch',
  Id = 'id',
  NextEpoch = 'nextEpoch',
  SharesFulfilled = 'sharesFulfilled',
  TransactionHash = 'transactionHash'
}

export interface _Block_ {
  __typename?: '_Block_';
  /** The hash of the block */
  hash?: Maybe<Scalars['Bytes']['output']>;
  /** The block number */
  number: Scalars['Int']['output'];
  /** The hash of the parent block */
  parentHash?: Maybe<Scalars['Bytes']['output']>;
  /** Integer representation of the timestamp stored in blocks for the chain */
  timestamp?: Maybe<Scalars['Int']['output']>;
}

/** The type for the top-level _meta field */
export interface _Meta_ {
  __typename?: '_Meta_';
  /**
   * Information about a specific subgraph block. The hash of the block
   * will be null if the _meta field has a block constraint that asks for
   * a block number. It will be filled if the _meta field has no block constraint
   * and therefore asks for the latest  block
   */
  block: _Block_;
  /** The deployment ID */
  deployment: Scalars['String']['output'];
  /** If `true`, the subgraph encountered indexing errors at some past block */
  hasIndexingErrors: Scalars['Boolean']['output'];
}

export enum _SubgraphErrorPolicy_ {
  /** Data will be returned even if the subgraph has indexing errors */
  Allow = 'allow',
  /** If the subgraph has indexing errors, data will be omitted. The default. */
  Deny = 'deny'
}

export type DepositEpochStateFragment = { __typename?: 'DepositEpochState', id: any, epoch: string, assetsDeposited: string, assetsFulfilled: string, sharesReceived: string, hypoVault: { __typename?: 'HypoVault', id: any } };

export type HypoVaultFragment = { __typename?: 'HypoVault', id: any, symbol: string, name: string, performanceFeeBps: string, owner: any, feeWallet: any, manager: any, accountant: any, withdrawalEpoch: string, depositEpoch: string, reservedWithdrawalAssets: string, totalAssetsDeposited: string, totalAssetsWithdrawn: string, totalPerformanceFeesCollected: string, createdAt: string, updatedAt: string, createdAtBlock: string, updatedAtBlock: string, underlyingToken: { __typename?: 'Token', id: any, symbol: string, decimals: string, name: string, derivedETH: string }, depositEpochStates: Array<{ __typename?: 'DepositEpochState', id: any }>, withdrawalEpochStates: Array<{ __typename?: 'WithdrawalEpochState', id: any }>, userBalances: Array<{ __typename?: 'UserBalance', id: any }> };

export type WithdrawalEpochStateFragment = { __typename?: 'WithdrawalEpochState', id: any, epoch: string, sharesWithdrawn: string, assetsReceived: string, sharesFulfilled: string, hypoVault: { __typename?: 'HypoVault', id: any } };

export type GetDepositOverviewQueryVariables = Exact<{
  account: Scalars['String']['input'];
  hypoVault: Scalars['String']['input'];
  hypoVaultId: Scalars['ID']['input'];
  historyLimit?: InputMaybe<Scalars['Int']['input']>;
}>;


export type GetDepositOverviewQuery = { __typename?: 'Query', hypoVault?: { __typename?: 'HypoVault', id: any, underlyingToken: { __typename?: 'Token', symbol: string, decimals: string } } | null, queuedDeposits: Array<{ __typename?: 'QueuedDeposit', amount: string, epoch: string }>, queuedWithdrawals: Array<{ __typename?: 'QueuedWithdrawal', amount: string, epoch: string }>, depositExecuteds: Array<{ __typename?: 'DepositExecuted', assets: string, blockTimestamp: string }>, withdrawalExecuteds: Array<{ __typename?: 'WithdrawalExecuted', assets: string, blockTimestamp: string }> };

export type GetLatestDepositAndWithdrawEpochQueryVariables = Exact<{
  hypoVault: Scalars['String']['input'];
}>;


export type GetLatestDepositAndWithdrawEpochQuery = { __typename?: 'Query', depositEpochStates: Array<{ __typename?: 'DepositEpochState', id: any, epoch: string, assetsDeposited: string, assetsFulfilled: string, sharesReceived: string, hypoVault: { __typename?: 'HypoVault', id: any } }>, withdrawalEpochStates: Array<{ __typename?: 'WithdrawalEpochState', id: any, epoch: string, sharesWithdrawn: string, assetsReceived: string, sharesFulfilled: string, hypoVault: { __typename?: 'HypoVault', id: any } }> };

export type GetLatestEpochQueryVariables = Exact<{
  hypoVault: Scalars['String']['input'];
}>;


export type GetLatestEpochQuery = { __typename?: 'Query', depositEpochStates: Array<{ __typename?: 'DepositEpochState', id: any, epoch: string, assetsDeposited: string, assetsFulfilled: string, sharesReceived: string, hypoVault: { __typename?: 'HypoVault', id: any } }>, withdrawalEpochStates: Array<{ __typename?: 'WithdrawalEpochState', id: any, epoch: string, sharesWithdrawn: string, assetsReceived: string, sharesFulfilled: string, hypoVault: { __typename?: 'HypoVault', id: any } }> };

export type GetFilteredHypoVaultsQueryVariables = Exact<{
  hypoVaultWhitelist: Array<Scalars['Bytes']['input']> | Scalars['Bytes']['input'];
}>;


export type GetFilteredHypoVaultsQuery = { __typename?: 'Query', bundle?: { __typename?: 'Bundle', ethPriceUSD: string } | null, hypoVaults: Array<{ __typename?: 'HypoVault', id: any, symbol: string, name: string, performanceFeeBps: string, owner: any, feeWallet: any, manager: any, accountant: any, withdrawalEpoch: string, depositEpoch: string, reservedWithdrawalAssets: string, totalAssetsDeposited: string, totalAssetsWithdrawn: string, totalPerformanceFeesCollected: string, createdAt: string, updatedAt: string, createdAtBlock: string, updatedAtBlock: string, underlyingToken: { __typename?: 'Token', id: any, symbol: string, decimals: string, name: string, derivedETH: string }, depositEpochStates: Array<{ __typename?: 'DepositEpochState', id: any }>, withdrawalEpochStates: Array<{ __typename?: 'WithdrawalEpochState', id: any }>, userBalances: Array<{ __typename?: 'UserBalance', id: any }> }> };

export type GetQueuedWithdrawalsForExecutionQueryVariables = Exact<{
  account: Scalars['String']['input'];
  hypoVault: Scalars['String']['input'];
  hypoVaultId: Scalars['ID']['input'];
}>;


export type GetQueuedWithdrawalsForExecutionQuery = { __typename?: 'Query', hypoVault?: { __typename?: 'HypoVault', id: any, withdrawalEpoch: string } | null, queuedWithdrawals: Array<{ __typename?: 'QueuedWithdrawal', amount: string, epoch: string }> };

export type GetWithdrawalEpochStatesForExecutionQueryVariables = Exact<{
  hypoVault: Scalars['String']['input'];
  epochs: Array<Scalars['BigInt']['input']> | Scalars['BigInt']['input'];
}>;


export type GetWithdrawalEpochStatesForExecutionQuery = { __typename?: 'Query', withdrawalEpochStates: Array<{ __typename?: 'WithdrawalEpochState', id: any, epoch: string, sharesWithdrawn: string, assetsReceived: string, sharesFulfilled: string, hypoVault: { __typename?: 'HypoVault', id: any } }> };

export type GetQueuedDepositsForWithdrawalQueryVariables = Exact<{
  account: Scalars['String']['input'];
  hypoVault: Scalars['String']['input'];
  hypoVaultId: Scalars['ID']['input'];
}>;


export type GetQueuedDepositsForWithdrawalQuery = { __typename?: 'Query', hypoVault?: { __typename?: 'HypoVault', id: any, depositEpoch: string } | null, userBalances: Array<{ __typename?: 'UserBalance', shares: string }>, queuedDeposits: Array<{ __typename?: 'QueuedDeposit', amount: string, epoch: string }> };

export type GetDepositEpochStatesForWithdrawalQueryVariables = Exact<{
  hypoVault: Scalars['String']['input'];
  minEpoch: Scalars['BigInt']['input'];
  maxEpoch: Scalars['BigInt']['input'];
}>;


export type GetDepositEpochStatesForWithdrawalQuery = { __typename?: 'Query', depositEpochStates: Array<{ __typename?: 'DepositEpochState', id: any, epoch: string, assetsDeposited: string, assetsFulfilled: string, sharesReceived: string, hypoVault: { __typename?: 'HypoVault', id: any } }> };
