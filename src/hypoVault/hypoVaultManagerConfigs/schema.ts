import { z } from 'zod'

const addressSchema = z.custom<`0x${string}`>((val) => {
  return typeof val === 'string' && /^0x[a-fA-F0-9]{40}$/.test(val)
})

const timedRehedgeSchema = z
  .object({
    elapsedMinutes: z.number().int().positive(),
    jitterMinutes: z.number().int().nonnegative(),
    deltaThresholdBps: z.bigint().nonnegative(),
  })
  .refine(({ elapsedMinutes, jitterMinutes }) => jitterMinutes < elapsedMinutes, {
    message: 'timed rehedge jitterMinutes must be less than elapsedMinutes',
    path: ['jitterMinutes'],
  })

export const HypoVaultManagerConfigSchema = z.object({
  deployment: z.enum(['dev', 'prod']),
  artifactSet: z.enum(['base', 'mainnet-prod', 'mainnet-legacy', 'sepolia']).optional(),
  // Deprecated compatibility field. Pool-local automation derives its delta
  // asset from token roles and must not use this index for decisions.
  vaultAssetIndex: z.union([z.literal(0n), z.literal(1n)]),
  manageCycleIntervalMs: z.number().positive().optional(), // can be optional if only running manage cycles in response to websocket events instead of polling
  vaultCapInUnderlying: z.bigint().positive(),
  vaultCapInShares: z.bigint().positive().optional(), // when set, manager caps by totalSupply instead of totalAssets
  allowUnlimitedDepositRequestIfCapNotReached: z.boolean().optional(),
  maxBuyingPowerUsageBps: z.number().int().positive().max(10000), // skip auto-fulfilling a withdrawal if it would push requiredCollateral / collateralBalance past this, on the vault's asset side
  chainId: z.number().int().positive().optional(),
  // Deprecated vault-wide fallback for pool infos without positionScanFromBlock.
  poolDeploymentBlock: z.number().int().nonnegative().optional(),
  hypoVaultAddress: addressSchema.optional(),
  addresses: z
    .object({
      ethUsdc500bpsV4Collateral0: addressSchema.optional(),
      ethUsdc500bpsV4Collateral1: addressSchema.optional(),
      ethUsdc500bpsV4PanopticPool: addressSchema.optional(),
      hypoVaultManagerWithMerkleVerification: addressSchema.optional(),
      hypoVault: addressSchema.optional(),
      underlyingToken: addressSchema.optional(),
    })
    .optional(),
  automation: z.object({
    primaryPool: addressSchema,
    windDownPools: z.array(addressSchema),
  }),
  manualTxDefaults: z
    .object({
      collateralAllocations: z
        .array(
          z.object({
            trackerAddress: addressSchema,
            allocationBps: z.number().int().positive().max(10000),
          }),
        )
        .optional(),
    })
    .optional(),
  deltaHedge: z
    .object({
      deltaThresholdBps: z.bigint().positive().optional(),
      maxHedgeSlots: z.number().int().positive().optional(),
      timedRehedge: timedRehedgeSchema.optional(),
    })
    .optional(),
  alerts: z
    .object({
      outOfRangeEnabled: z.boolean().optional(),
    })
    .optional(),
})

export type HypoVaultManagerConfig = z.infer<typeof HypoVaultManagerConfigSchema>
