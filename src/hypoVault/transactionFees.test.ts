import { describe, expect, it } from 'vitest'

import {
  __transactionFeeTestUtils,
  applyVaultTransactionGasCostLimit,
  bufferVaultTransactionGasEstimate,
  getVaultTransactionReplacementFeeQuote,
  MAX_VAULT_PRIORITY_FEE_PER_GAS,
  MAX_VAULT_TRANSACTION_GAS_COST,
  MIN_VAULT_PRIORITY_FEE_PER_GAS,
  validateVaultSignedTransactionFeeCaps,
  VaultTransactionFeeEstimationError,
  VaultTransactionGasCostLimitError,
  VaultTransactionReplacementLimitError,
} from './transactionFees'

const {
  resolveDeltaHedgeFeeHistoryQuote,
  resolveFallbackQuote,
  resolveFeeHistoryQuote,
  resolveRpcPriorityFeeQuote,
  resolveVaultDeltaHedgeInitialFeeQuote,
  resolveVaultTransactionFeeQuote,
} = __transactionFeeTestUtils

describe('vault transaction fee quote', () => {
  it('floors zero and one-wei p90 rewards at 0.1 gwei', () => {
    const quote = resolveFeeHistoryQuote({
      baseFeePerGas: [100n, 101n, 102n],
      reward: [[0n], [1n]],
    })

    expect(quote).toEqual({
      maxFeePerGas: MIN_VAULT_PRIORITY_FEE_PER_GAS + 114n,
      maxPriorityFeePerGas: MIN_VAULT_PRIORITY_FEE_PER_GAS,
      minimumMaxFeePerGas: MIN_VAULT_PRIORITY_FEE_PER_GAS + 114n,
      source: 'fee_history',
    })
  })

  it('uses the median sampled p90 reward when it exceeds the floor', () => {
    const quote = resolveFeeHistoryQuote({
      baseFeePerGas: [100_000_000n, 200_000_000n, 250_000_000n],
      reward: [[120_000_000n], [350_000_000n]],
    })

    expect(quote).toEqual({
      maxFeePerGas: 460_000_000n,
      maxPriorityFeePerGas: 235_000_000n,
      minimumMaxFeePerGas: 325_000_000n,
      source: 'fee_history',
    })
  })

  it('ignores isolated p90 outliers and caps sustained outliers at 3 gwei', () => {
    const typical = resolveFeeHistoryQuote({
      baseFeePerGas: [100_000_000n, 100_000_000n],
      reward: [[1_000_000_000n], [2_000_000_000n], [2_000_000_000n], [122_000_000_000n]],
    })
    const sustainedOutlier = resolveFeeHistoryQuote({
      baseFeePerGas: [100_000_000n, 100_000_000n],
      reward: [[10_000_000_000n], [20_000_000_000n]],
    })

    expect(typical?.maxPriorityFeePerGas).toBe(2_000_000_000n)
    expect(sustainedOutlier?.maxPriorityFeePerGas).toBe(MAX_VAULT_PRIORITY_FEE_PER_GAS)
  })

  it('rounds the 12.5 percent base-fee buffer upward', () => {
    const quote = resolveFeeHistoryQuote({
      baseFeePerGas: [1n, 1n],
      reward: [[0n]],
    })

    expect(quote?.maxFeePerGas).toBe(MIN_VAULT_PRIORITY_FEE_PER_GAS + 2n)
  })

  it('returns null for malformed fee history', () => {
    expect(resolveFeeHistoryQuote({ baseFeePerGas: [1n], reward: [[1n]] })).toBeNull()
    expect(resolveFeeHistoryQuote({ baseFeePerGas: [1n, 2n], reward: undefined })).toBeNull()
    expect(resolveFeeHistoryQuote({ baseFeePerGas: [1n, 2n], reward: [[]] })).toBeNull()
  })

  it('clamps the fallback priority fee without losing the estimated base allowance', () => {
    expect(
      resolveFallbackQuote({
        maxFeePerGas: 240_000_001n,
        maxPriorityFeePerGas: 1n,
      }),
    ).toEqual({
      maxFeePerGas: 340_000_000n,
      maxPriorityFeePerGas: MIN_VAULT_PRIORITY_FEE_PER_GAS,
      minimumMaxFeePerGas: 340_000_000n,
      source: 'viem_fallback',
    })
  })

  it('caps the fallback priority fee at 3 gwei', () => {
    expect(
      resolveFallbackQuote({
        maxFeePerGas: 122_500_000_000n,
        maxPriorityFeePerGas: 122_000_000_000n,
      }),
    ).toEqual({
      maxFeePerGas: 3_500_000_000n,
      maxPriorityFeePerGas: MAX_VAULT_PRIORITY_FEE_PER_GAS,
      minimumMaxFeePerGas: 600_000_000n,
      source: 'viem_fallback',
    })
  })

  it('uses the clamped Viem fallback when fee history fails', async () => {
    await expect(
      resolveVaultTransactionFeeQuote({
        readFeeHistory: () => Promise.reject(new Error('fee history unavailable')),
        readFallbackEstimate: () =>
          Promise.resolve({ maxFeePerGas: 240_000_001n, maxPriorityFeePerGas: 1n }),
      }),
    ).resolves.toEqual({
      maxFeePerGas: 340_000_000n,
      maxPriorityFeePerGas: MIN_VAULT_PRIORITY_FEE_PER_GAS,
      minimumMaxFeePerGas: 340_000_000n,
      source: 'viem_fallback',
    })
  })

  it('fails before signing when both fee sources fail', async () => {
    await expect(
      resolveVaultTransactionFeeQuote({
        readFeeHistory: () => Promise.reject(new Error('fee history unavailable')),
        readFallbackEstimate: () => Promise.reject(new Error('fallback unavailable')),
      }),
    ).rejects.toBeInstanceOf(VaultTransactionFeeEstimationError)
  })

  it('clamps a quote to the 0.015 ETH gas-cost limit', () => {
    expect(
      applyVaultTransactionGasCostLimit(
        {
          maxFeePerGas: 20_000_000_000n,
          maxPriorityFeePerGas: 2_500_000_000n,
          minimumMaxFeePerGas: 600_000_000n,
          source: 'fee_history',
        },
        1_000_000n,
      ),
    ).toEqual({
      maxFeePerGas: 15_000_000_000n,
      maxPriorityFeePerGas: 2_500_000_000n,
      minimumMaxFeePerGas: 600_000_000n,
      source: 'fee_history',
    })
  })

  it('rejects a quote when base fee plus the minimum tip cannot fit the gas-cost limit', () => {
    expect(() =>
      applyVaultTransactionGasCostLimit(
        {
          maxFeePerGas: 1_000_000_000n,
          maxPriorityFeePerGas: 100_000_000n,
          minimumMaxFeePerGas: 1_000_000_000n,
          source: 'fee_history',
        },
        20_000_000n,
      ),
    ).toThrow(VaultTransactionGasCostLimitError)
  })

  it('adds a 50% gas limit buffer, rounding up', () => {
    expect(bufferVaultTransactionGasEstimate(500_000n)).toBe(750_000n)
    expect(bufferVaultTransactionGasEstimate(1n)).toBe(2n)
  })

  it('rejects non-positive gas estimates', () => {
    expect(() => bufferVaultTransactionGasEstimate(0n)).toThrow('must be positive')
  })
})

describe('delta hedge transaction fee quotes', () => {
  it.each([
    [0n, 0n],
    [1n, 1n],
    [1_500_000_000n, 1_500_000_000n],
    [4_000_000_000n, 4_000_000_000n],
  ])('passes an RPC priority fee of %s wei through as %s wei', (raw, expected) => {
    expect(
      resolveRpcPriorityFeeQuote({ baseFeePerGas: 1_000_000_000n, rawPriorityFeePerGas: raw }),
    ).toEqual({
      maxFeePerGas: 1_125_000_000n + expected,
      maxPriorityFeePerGas: expected,
      minimumMaxFeePerGas: 1_125_000_000n + expected,
      rawPriorityFeePerGas: raw,
      source: 'rpc_priority_fee',
    })
  })

  it('does not lower an Alchemy priority fee to fit the total-cost cap', () => {
    const quote = resolveRpcPriorityFeeQuote({
      baseFeePerGas: 1_000_000_000n,
      rawPriorityFeePerGas: 20_000_000_000n,
    })
    expect(() => applyVaultTransactionGasCostLimit(quote, 1_000_000n)).toThrow(
      VaultTransactionGasCostLimitError,
    )
  })

  it('falls back to historical p25 when eth_maxPriorityFeePerGas fails', async () => {
    const historicalQuote = {
      maxFeePerGas: 2_125_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      minimumMaxFeePerGas: 1_225_000_000n,
      rawPriorityFeePerGas: 1_000_000_000n,
      source: 'fee_history_p25' as const,
    }
    await expect(
      resolveVaultDeltaHedgeInitialFeeQuote({
        readRpcQuote: () => Promise.reject(new Error('RPC unavailable')),
        readHistoricalQuote: () => Promise.resolve(historicalQuote),
      }),
    ).resolves.toEqual(historicalQuote)
  })

  it.each([
    [1n, MIN_VAULT_PRIORITY_FEE_PER_GAS],
    [1_500_000_000n, 1_500_000_000n],
    [4_000_000_000n, MAX_VAULT_PRIORITY_FEE_PER_GAS],
  ])('clamps a rolling p25 value of %s wei to %s wei', (raw, clamped) => {
    const quote = resolveDeltaHedgeFeeHistoryQuote({
      baseFeePerGas: [1_000_000_000n, 1_000_000_000n],
      reward: [[raw]],
    })
    expect(quote).toMatchObject({
      maxPriorityFeePerGas: clamped,
      rawPriorityFeePerGas: raw,
      source: 'fee_history_p25',
    })
  })

  it('takes the median of 20 per-block p25 rewards', () => {
    const rewards = [
      ...Array.from({ length: 10 }, () => [500_000_000n]),
      ...Array.from({ length: 10 }, () => [1_500_000_000n]),
    ]
    const quote = resolveDeltaHedgeFeeHistoryQuote({
      baseFeePerGas: [1_000_000_000n, 1_000_000_000n],
      reward: rewards,
    })
    expect(quote?.rawPriorityFeePerGas).toBe(1_000_000_000n)
    expect(quote?.maxPriorityFeePerGas).toBe(1_000_000_000n)
  })

  it('uses the 12.5 percent replacement bump when p25 is lower', () => {
    const replacement = getVaultTransactionReplacementFeeQuote({
      originalQuote: { maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n },
      historicalQuote: {
        maxFeePerGas: 1_500_000_000n,
        maxPriorityFeePerGas: 500_000_000n,
        minimumMaxFeePerGas: 1_100_000_000n,
        rawPriorityFeePerGas: 500_000_000n,
        source: 'fee_history_p25',
      },
      gasLimit: 1_000_000n,
    })
    expect(replacement).toMatchObject({
      maxFeePerGas: 2_250_000_000n,
      maxPriorityFeePerGas: 1_125_000_000n,
    })
  })

  it('adds a bumped priority fee to the current buffered base fee', () => {
    const replacement = getVaultTransactionReplacementFeeQuote({
      originalQuote: { maxFeePerGas: 1_100_000_000n, maxPriorityFeePerGas: 1_000_000_000n },
      historicalQuote: {
        maxFeePerGas: 10_100_000_000n,
        maxPriorityFeePerGas: 100_000_000n,
        minimumMaxFeePerGas: 10_100_000_000n,
        rawPriorityFeePerGas: 1n,
        source: 'fee_history_p25',
      },
      gasLimit: 1_000_000n,
    })
    expect(replacement).toMatchObject({
      maxFeePerGas: 11_125_000_000n,
      maxPriorityFeePerGas: 1_125_000_000n,
    })
  })

  it('allows the required replacement bump above the historical 3 gwei cap', () => {
    expect(
      getVaultTransactionReplacementFeeQuote({
        originalQuote: {
          maxFeePerGas: 5_000_000_000n,
          maxPriorityFeePerGas: MAX_VAULT_PRIORITY_FEE_PER_GAS,
        },
        historicalQuote: {
          maxFeePerGas: 5_000_000_000n,
          maxPriorityFeePerGas: MAX_VAULT_PRIORITY_FEE_PER_GAS,
          minimumMaxFeePerGas: 2_100_000_000n,
          rawPriorityFeePerGas: 4_000_000_000n,
          source: 'fee_history_p25',
        },
        gasLimit: 1_000_000n,
      }),
    ).toMatchObject({
      maxFeePerGas: 5_625_000_000n,
      maxPriorityFeePerGas: 3_375_000_000n,
    })
  })

  it('rejects a replacement whose required max fee exceeds the 0.015 ETH cap', () => {
    expect(() =>
      getVaultTransactionReplacementFeeQuote({
        originalQuote: {
          maxFeePerGas: 14_000_000_000n,
          maxPriorityFeePerGas: 1_000_000_000n,
        },
        historicalQuote: {
          maxFeePerGas: 14_000_000_000n,
          maxPriorityFeePerGas: 1_000_000_000n,
          minimumMaxFeePerGas: 13_100_000_000n,
          rawPriorityFeePerGas: 1_000_000_000n,
          source: 'fee_history_p25',
        },
        gasLimit: 1_000_000n,
      }),
    ).toThrow(VaultTransactionReplacementLimitError)
  })

  it('fits the recent 1,171,452 gas / 9.698402347 gwei failure under 0.015 ETH', () => {
    expect(1_171_452n * 9_698_402_347n).toBeLessThan(MAX_VAULT_TRANSACTION_GAS_COST)
  })
})

describe('signed vault transaction fee validation', () => {
  const quote = {
    maxFeePerGas: 500_000_000n,
    maxPriorityFeePerGas: 300_000_000n,
    minimumMaxFeePerGas: 300_000_000n,
    source: 'fee_history' as const,
  }

  it('rejects missing EIP-1559 caps', () => {
    expect(
      validateVaultSignedTransactionFeeCaps(
        { maxFeePerGas: null, maxPriorityFeePerGas: null },
        quote,
      ),
    ).toMatchObject({ valid: false, code: 'MissingEip1559Fees' })
  })

  it('rejects inverted fee caps', () => {
    expect(
      validateVaultSignedTransactionFeeCaps(
        { maxFeePerGas: 300_000_000n, maxPriorityFeePerGas: 400_000_000n },
        quote,
      ),
    ).toMatchObject({ valid: false, code: 'InvalidFeeCaps' })
  })

  it('rejects priority fees below the floor', () => {
    expect(
      validateVaultSignedTransactionFeeCaps(
        { maxFeePerGas: 300_000_000n, maxPriorityFeePerGas: 99_999_999n },
        quote,
      ),
    ).toMatchObject({ valid: false, code: 'PriorityFeeTooLow' })
  })

  it('rejects priority fees above the ceiling', () => {
    expect(
      validateVaultSignedTransactionFeeCaps({
        maxFeePerGas: MAX_VAULT_PRIORITY_FEE_PER_GAS + 1n,
        maxPriorityFeePerGas: MAX_VAULT_PRIORITY_FEE_PER_GAS + 1n,
      }),
    ).toMatchObject({ valid: false, code: 'PriorityFeeTooHigh' })
  })

  it('rejects signed transactions whose maximum gas cost exceeds 0.015 ETH', () => {
    expect(
      validateVaultSignedTransactionFeeCaps({
        gasLimit: 1_000_001n,
        maxFeePerGas: MAX_VAULT_TRANSACTION_GAS_COST / 1_000_000n,
        maxPriorityFeePerGas: 100_000_000n,
      }),
    ).toMatchObject({ valid: false, code: 'GasCostTooHigh' })
  })

  it('accepts signed transactions exactly at the gas-cost ceiling', () => {
    expect(
      validateVaultSignedTransactionFeeCaps({
        gasLimit: 1_000_000n,
        maxFeePerGas: MAX_VAULT_TRANSACTION_GAS_COST / 1_000_000n,
        maxPriorityFeePerGas: 100_000_000n,
      }),
    ).toEqual({ valid: true })
  })

  it('rejects max fees that cannot cover the buffered base fee and floor', () => {
    expect(
      validateVaultSignedTransactionFeeCaps(
        { maxFeePerGas: 299_999_999n, maxPriorityFeePerGas: 100_000_000n },
        quote,
      ),
    ).toMatchObject({ valid: false, code: 'MaxFeeTooLow' })
  })

  it('accepts statically valid caps without applying quote-dependent max-fee policy', () => {
    expect(
      validateVaultSignedTransactionFeeCaps({
        maxFeePerGas: 299_999_999n,
        maxPriorityFeePerGas: 100_000_000n,
      }),
    ).toEqual({ valid: true })
  })

  it('accepts caps at the policy thresholds', () => {
    expect(
      validateVaultSignedTransactionFeeCaps(
        { maxFeePerGas: 300_000_000n, maxPriorityFeePerGas: 100_000_000n },
        quote,
      ),
    ).toEqual({ valid: true })
  })
})
