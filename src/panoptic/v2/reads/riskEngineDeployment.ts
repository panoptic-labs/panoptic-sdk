import type {
  ContractFunctionParameters,
  MulticallParameters,
  MulticallReturnType,
  PublicClient,
} from 'viem'

const IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
const PROXIES = new Set([
  '0x000000000000ffe5efdb5ae76b9200263c58b4c0',
  '0x000000000000ffada7c641e2ad6b13b51b50cc94',
])

// Implementation constants and constructor values from panoptic-v2-core deployment manifests.
const BLUE_CHIP = {
  DECIMALS: 10_000_000n,
  VEGOID: 8,
  CROSS_BUFFER_0: 9_000_000n,
  CROSS_BUFFER_1: 9_000_000n,
  EMA_PERIODS: 4533471891108855828971580n,
  MAX_TICKS_DELTA: 724n,
  MAX_CLAMP_DELTA: 149,
  MAX_TWAP_DELTA_DISPATCH: 513,
  MAX_SPREAD: 90_000,
  BP_DECREASE_BUFFER: 10_750_000,
  SELLER_COLLATERAL_RATIO: 2_000_000n,
  BUYER_COLLATERAL_RATIO: 100_000n,
  MAINT_MARGIN_RATE: 1_000_000n,
  LOAN_MARGIN_DIVISOR: 4n,
  FORCE_EXERCISE_COST: 5_000_000n,
  TARGET_POOL_UTIL: 6_666_667n,
  SATURATED_POOL_UTIL: 9_000_000n,
  MAX_OPEN_LEGS: 26n,
  MAX_BONUS: 2_000_000n,
  NOTIONAL_FEE: 3,
  PREMIUM_FEE: 250,
  PROTOCOL_SPLIT: 5_000,
  BUILDER_SPLIT: 4_000,
  MIN_RATE_AT_TARGET: 634195839n,
}

const IMPLEMENTATIONS: Readonly<Record<string, Readonly<Record<string, bigint | number>>>> = {
  '0x000000000000f0b287c19f606bc3a471f260c502': BLUE_CHIP,
  '0x000000000000f4901018445c697e1e358dab8dad': {
    ...BLUE_CHIP,
    CROSS_BUFFER_0: 7_500_000n,
    CROSS_BUFFER_1: 7_500_000n,
    EMA_PERIODS: 9066943782217711657943160n,
    MAX_TICKS_DELTA: 953n,
    MAINT_MARGIN_RATE: 2_500_000n,
  },
}

/** Resolve immutable getters from the implementation manifest and read dynamic state at the same block. */
export async function riskEngineMulticall<
  const contracts extends readonly unknown[],
  allowFailure extends boolean = true,
>(
  client: PublicClient,
  parameters: MulticallParameters<contracts, allowFailure> & { blockNumber: bigint },
): Promise<MulticallReturnType<contracts, allowFailure>> {
  const calls = parameters.contracts as readonly ContractFunctionParameters[]
  const proxies = [...new Set(calls.map((call) => call.address.toLowerCase()))].filter((address) =>
    PROXIES.has(address),
  )
  if (proxies.length === 0) return client.multicall(parameters)

  const manifests = new Map(
    await Promise.all(
      proxies.map(async (address) => {
        const slot = await client.getStorageAt({
          address: address as `0x${string}`,
          slot: IMPLEMENTATION_SLOT,
          blockNumber: parameters.blockNumber,
        })
        const implementation = slot?.length === 66 ? `0x${slot.slice(-40)}`.toLowerCase() : ''
        const manifest = IMPLEMENTATIONS[implementation]
        if (!manifest) {
          throw new Error(
            `Unknown RiskEngine implementation ${implementation || '(missing)'} for ${address}; update the SDK deployment parameters`,
          )
        }
        return [address, manifest] as const
      }),
    ),
  )
  const values = calls.map((call) =>
    call.args?.length ? undefined : manifests.get(call.address.toLowerCase())?.[call.functionName],
  )
  const liveCalls = calls.filter((_, index) => values[index] === undefined)
  const liveResults =
    liveCalls.length === 0 ? [] : await client.multicall({ ...parameters, contracts: liveCalls })
  let liveIndex = 0
  // Preserve viem's tuple order and number/bigint widths, including allowFailure result envelopes.
  return values.map((value) =>
    value === undefined
      ? liveResults[liveIndex++]
      : parameters.allowFailure === false
        ? value
        : { status: 'success', result: value },
  ) as MulticallReturnType<contracts, allowFailure>
}
