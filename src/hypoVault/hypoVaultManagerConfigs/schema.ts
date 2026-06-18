import { z } from 'zod'

const addressSchema = z.custom<`0x${string}`>((val) => {
  return typeof val === 'string' && /^0x[a-fA-F0-9]{40}$/.test(val)
})

export const HypoVaultManagerConfigSchema = z.object({
  deployment: z.enum(['dev', 'prod']),
  artifactSet: z.enum(['base', 'mainnet-prod', 'mainnet-legacy', 'sepolia']).optional(),
  vaultAssetIndex: z.union([z.literal(0n), z.literal(1n)]),
  manageCycleIntervalMs: z.number().positive().optional(), // can be optional if only running manage cycles in response to websocket events instead of polling
  vaultCapInUnderlying: z.bigint().positive(),
  vaultCapInShares: z.bigint().positive().optional(), // when set, manager caps by totalSupply instead of totalAssets
  allowUnlimitedDepositRequestIfCapNotReached: z.boolean().optional(),
  maxBuyingPowerUsageBps: z.number().int().positive().max(10000), // skip auto-fulfilling a withdrawal if it would push requiredCollateral / collateralBalance past this, on the vault's asset side
  chainId: z.number().int().positive().optional(),
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
    })
    .optional(),
  alerts: z
    .object({
      outOfRangeEnabled: z.boolean().optional(),
    })
    .optional(),
})

export type HypoVaultManagerConfig = z.infer<typeof HypoVaultManagerConfigSchema>
