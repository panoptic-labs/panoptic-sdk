import { z } from 'zod'

const addressSchema = z.custom<`0x${string}`>((val) => {
  return typeof val === 'string' && /^0x[a-fA-F0-9]{40}$/.test(val)
})

export const HypoVaultManagerConfigSchema = z.object({
  manageCycleIntervalMs: z.number().positive().optional(), // can be optional if only running manage cycles in response to websocket events instead of polling
  vaultCapInUnderlying: z.bigint().positive(),
  chainId: z.number().int().positive().optional(),
  hypoVaultAddress: addressSchema.optional(),
  addresses: z
    .object({
      wethUsdc500bpsV4Collateral0: addressSchema.optional(),
      wethUsdc500bpsV4PanopticPool: addressSchema.optional(),
      hypoVaultManagerWithMerkleVerification: addressSchema.optional(),
      hypoVault: addressSchema.optional(),
      underlyingToken: addressSchema.optional(),
    })
    .optional(),
})

export type HypoVaultManagerConfig = z.infer<typeof HypoVaultManagerConfigSchema>
