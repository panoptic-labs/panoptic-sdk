/**
 * Send an SFPM off-venue swap.
 * @module v2/sfpmSwap/execute
 */
import type { Address, PublicClient, WalletClient } from 'viem'

import { semiFungiblePositionManagerV3Abi as sfpmV3Abi } from '../../../generated'
import type { TxOverrides, TxResult } from '../types'
import { submitWrite } from '../writes/utils'
import { buildSfpmSwapCalldata } from './calldata'
import type { SfpmSwapPlan } from './types'

export interface ExecuteSfpmSwapParams {
  client: PublicClient
  walletClient: WalletClient
  /** The caller: pays the input token (approved to the SFPM) and receives the output. */
  account: Address
  /** Plan from {@link buildSfpmSwapPlan}. */
  plan: SfpmSwapPlan
  txOverrides?: TxOverrides
}

/**
 * Send a swap plan as one atomic `SFPM.multicall([mint, burn])`.
 *
 * The only on-chain protection is the plan's tick band on the pool's final
 * tick; there is no minimum-output or maximum-input check. Size the band with
 * {@link quoteSfpmSwap} before sending.
 */
export function executeSfpmSwap(params: ExecuteSfpmSwapParams): Promise<TxResult> {
  const { client, walletClient, account, plan, txOverrides } = params
  const { mintData, burnData } = buildSfpmSwapCalldata(plan)
  return submitWrite({
    client,
    walletClient,
    account,
    address: plan.sfpmAddress,
    abi: sfpmV3Abi,
    functionName: 'multicall',
    args: [[mintData, burnData]],
    txOverrides,
  })
}
