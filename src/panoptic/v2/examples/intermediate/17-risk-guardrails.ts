/**
 * Intermediate Example 17: Risk Guardrails
 *
 * Demonstrates:
 * - Building a preflight guardrail layer before automated writes
 * - Checking pool data freshness with assertFresh()
 * - Checking pool health and safe-mode restrictions
 * - Applying utilization thresholds before strategy execution
 * - Classifying RPC errors as retryable or fatal
 *
 * Prerequisites:
 * - RPC_URL environment variable (defaults to a public Ethereum RPC)
 * - POOL_ADDRESS environment variable
 * - CHAIN_ID environment variable (optional, defaults to 1)
 *
 * This example does not execute transactions. It returns a structured decision
 * that bots can use before attempting mints, burns, liquidations, or force exercise.
 */

import { type Address, type PublicClient, createPublicClient, http } from 'viem'
import { base, mainnet, sepolia } from 'viem/chains'

import { getPool } from '../../reads/pool'
import { getSafeMode } from '../../reads/safeMode'
import {
  type GuardrailConfig,
  type GuardrailDecision,
  classifyRpcError,
  evaluateGuardrails,
  parseOperation,
} from './risk-guardrails'

const RPC_URL = process.env.RPC_URL || 'https://ethereum-rpc.publicnode.com'
const POOL_ADDRESS = process.env.POOL_ADDRESS as Address
const CHAIN_ID = BigInt(process.env.CHAIN_ID || '1')

const CONFIG: GuardrailConfig = {
  maxDataAgeSeconds: BigInt(process.env.MAX_DATA_AGE_SECONDS || '60'),
  warnUtilizationBps: BigInt(process.env.WARN_UTILIZATION_BPS || '8000'),
  haltUtilizationBps: BigInt(process.env.HALT_UTILIZATION_BPS || '9500'),
  operation: parseOperation(process.env.OPERATION),
}

if (!POOL_ADDRESS) {
  console.error('Error: POOL_ADDRESS environment variable is required')
  process.exit(1)
}

function resolveChain(chainId: bigint) {
  switch (Number(chainId)) {
    case mainnet.id:
      return mainnet
    case sepolia.id:
      return sepolia
    case base.id:
      return base
    default:
      return mainnet
  }
}

function printDecision(decision: GuardrailDecision): void {
  console.log(`Decision: ${decision.canProceed ? 'PROCEED' : 'HALT'} (${decision.severity})\n`)

  for (const check of decision.checks) {
    const icon = check.severity === 'ok' ? '[OK]' : check.severity === 'warn' ? '[WARN]' : '[HALT]'
    console.log(`${icon} ${check.name}`)
    console.log(`     ${check.reason}`)
    if (check.observed) console.log(`     observed: ${check.observed}`)
    if (check.threshold) console.log(`     threshold: ${check.threshold}`)
  }
}

async function main() {
  console.log('=== Panoptic v2 SDK: Risk Guardrails ===\n')

  const client = createPublicClient({
    chain: resolveChain(CHAIN_ID),
    transport: http(RPC_URL),
  }) as PublicClient

  console.log(`Pool: ${POOL_ADDRESS}`)
  console.log(`Chain ID: ${CHAIN_ID}`)
  console.log(`Operation: ${CONFIG.operation}`)
  console.log(`RPC: ${RPC_URL}\n`)

  try {
    const pool = await getPool({
      client,
      poolAddress: POOL_ADDRESS,
      chainId: CHAIN_ID,
    })
    const safeMode = await getSafeMode({
      client,
      poolAddress: POOL_ADDRESS,
      blockNumber: pool._meta.blockNumber,
      _meta: pool._meta,
    })

    const decision = evaluateGuardrails(pool, safeMode, CONFIG)
    printDecision(decision)
  } catch (error) {
    const check = classifyRpcError(error)
    printDecision({
      canProceed: false,
      severity: 'halt',
      checks: [check],
    })
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
