import { rolesV2Abi } from './rolesAbi'

/** One idempotent Roles-modifier configuration call. */
export interface ScopeStep {
  name: string
  functionName:
    | 'assignRoles'
    | 'scopeTarget'
    | 'scopeFunction'
    | 'allowFunction'
    | 'setTransactionUnwrapper'
  args: unknown[]
}

/**
 * Minimal structural client shapes (instead of viem's `PublicClient` /
 * `WalletClient`) so any viem 2.x instance is accepted — pnpm peer-keying can
 * produce multiple viem type-instances across a workspace, and the deeply
 * generic client types are not assignable across instances (TS2719).
 */
export interface ScopeStepsPublicClient {
  waitForTransactionReceipt(args: {
    hash: `0x${string}`
    timeout?: number
  }): Promise<{ status: string }>
}

export interface ScopeStepsWalletClient {
  writeContract(args: {
    address: `0x${string}`
    abi: typeof rolesV2Abi
    functionName: ScopeStep['functionName']
    args: never
    maxFeePerGas?: bigint
    maxPriorityFeePerGas?: bigint
  }): Promise<`0x${string}`>
}

/**
 * Apply scope steps to a Roles v2 modifier sequentially, aborting on the
 * first revert so a partially-applied role is never silently left behind.
 * The wallet must be the modifier's owner.
 */
export async function applyScopeSteps(params: {
  publicClient: ScopeStepsPublicClient
  walletClient: ScopeStepsWalletClient
  rolesModifier: `0x${string}`
  steps: ScopeStep[]
  log?: (line: string) => void
  /**
   * EIP-1559 fee overrides applied to every tx. Pass a NON-ZERO
   * `maxPriorityFeePerGas` — some RPC estimators return a zero tip, which leaves
   * txs un-prioritised and slow to include.
   */
  fees?: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint }
  /** Receipt-wait timeout (ms). */
  timeoutMs?: number
}): Promise<void> {
  // eslint-disable-next-line no-console
  const { publicClient, walletClient, rolesModifier, steps, log = console.log } = params
  for (const step of steps) {
    log(`→ ${step.name}`)
    const hash = await walletClient.writeContract({
      address: rolesModifier,
      abi: rolesV2Abi,
      functionName: step.functionName,
      args: step.args as never,
      ...(params.fees ?? {}),
    })
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      ...(params.timeoutMs ? { timeout: params.timeoutMs } : {}),
    })
    log(`  ${receipt.status} ${hash}`)
    if (receipt.status !== 'success') {
      throw new Error(`step "${step.name}" reverted (tx ${hash}); aborting before later steps`)
    }
  }
}
