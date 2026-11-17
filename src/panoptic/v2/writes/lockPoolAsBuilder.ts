/**
 * Builder-admin pool lock for the Panoptic v2 SDK.
 * @module v2/writes/lockPoolAsBuilder
 */

import type { Address, PublicClient, WalletClient } from 'viem'

import { panopticGuardianAbi } from '../../../generated'
import type { TxOverrides, TxResult } from '../types'
import { submitWrite } from './utils'

export interface LockPoolAsBuilderParams {
  client: PublicClient
  walletClient: WalletClient
  /** Admin of the builder wallet for `builderCode` */
  account: Address
  /** PanopticGuardian of the pool's RiskEngine */
  guardianAddress: Address
  poolAddress: Address
  builderCode: bigint
  txOverrides?: TxOverrides
}

/**
 * Lock a pool into close-only mode as a builder admin. The authority covers every
 * pool on the guardian's RiskEngine; only the guardian admin can unlock, after
 * the timelock.
 */
export async function lockPoolAsBuilder(params: LockPoolAsBuilderParams): Promise<TxResult> {
  const { client, walletClient, account, guardianAddress, poolAddress, builderCode, txOverrides } =
    params
  return submitWrite({
    client,
    walletClient,
    account,
    address: guardianAddress,
    abi: panopticGuardianAbi,
    functionName: 'lockPoolAsBuilder',
    args: [poolAddress, builderCode],
    txOverrides,
  })
}
