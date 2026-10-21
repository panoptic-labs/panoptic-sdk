import { type Address, type PublicClient, createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'
import { describe, expect, it } from 'vitest'

import { getPool } from '../../../reads/pool'
import { getSafeMode } from '../../../reads/safeMode'
import {
  type GuardrailConfig,
  evaluateGuardrails,
  parseOperation,
} from '../../intermediate/risk-guardrails'
import { ANVIL_CONFIG, getAnvilRpcUrl } from '../anvil.config'

const poolAddress = (process.env.TEST_POOL_ADDRESS || process.env.POOL_ADDRESS) as
  | Address
  | undefined
const describeFork = poolAddress ? describe : describe.skip

describeFork('risk guardrails fork integration', () => {
  it('evaluates a forked pool without the monorepo deployment config', async () => {
    const client = createPublicClient({
      chain: mainnet,
      transport: http(getAnvilRpcUrl()),
    }) as PublicClient

    const config: GuardrailConfig = {
      maxDataAgeSeconds: BigInt(process.env.MAX_DATA_AGE_SECONDS || '60'),
      warnUtilizationBps: BigInt(process.env.WARN_UTILIZATION_BPS || '8000'),
      haltUtilizationBps: BigInt(process.env.HALT_UTILIZATION_BPS || '9500'),
      operation: parseOperation(process.env.OPERATION),
    }

    const pool = await getPool({
      client,
      poolAddress: poolAddress as Address,
      chainId: ANVIL_CONFIG.chainId,
    })
    const safeMode = await getSafeMode({
      client,
      poolAddress: poolAddress as Address,
      blockNumber: pool._meta.blockNumber,
      _meta: pool._meta,
    })
    const decision = evaluateGuardrails(pool, safeMode, config)

    expect(decision.checks.map((check) => check.name)).toEqual([
      'data_freshness',
      'pool_health',
      'safe_mode',
      'utilization',
      'operation_allowed',
    ])
    expect(['ok', 'warn', 'halt']).toContain(decision.severity)
    expect(typeof decision.canProceed).toBe('boolean')
    expect(pool.address.toLowerCase()).toBe((poolAddress as Address).toLowerCase())
  })
})
