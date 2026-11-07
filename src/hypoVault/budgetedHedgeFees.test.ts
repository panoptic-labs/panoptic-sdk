import { describe, expect, it } from 'vitest'

import { selectBudgetedHedgeFees } from './budgetedHedgeFees'
import {
  applyVaultTransactionGasCostLimit,
  validateVaultSignedTransactionFeeCaps,
} from './transactionFees'

const gwei = 1_000_000_000n
const quote = {
  source: 'adaptive_hedge' as const,
  currentBaseFeePerGas: 1n * gwei,
  rawPriorityFeePerGas: 1_104n * gwei,
  maxPriorityFeePerGas: 1_104n * gwei,
  maxFeePerGas: 1_106n * gwei,
  minimumMaxFeePerGas: 1_105n * gwei,
  minimumPriorityFeePerGas: 1_104n * gwei,
  competitivePriorityFeePerGas: 3n * gwei,
}
const feePolicy = { marketPriorityFees: true, maxTransactionGasCost: 200_000_000_000_000_000n }
const gasLimit = 2_000_000n

describe('budgeted hedge fees', () => {
  it('clips an extreme p90 while preserving a competitive tip, two base fees and replacement room', () => {
    const selected = selectBudgetedHedgeFees({ quote, gasLimit, feePolicy })
    expect(selected.status).toBe('ready')
    if (selected.status !== 'ready') throw new Error('Expected affordable clipped fees')
    expect(selected.quote.maxPriorityFeePerGas).toBeGreaterThanOrEqual(3n * gwei)
    expect(selected.quote.maxPriorityFeePerGas).toBeLessThan(quote.maxPriorityFeePerGas)
    expect(selected.quote.maxFeePerGas - selected.quote.maxPriorityFeePerGas).toBe(2n * gwei)
    expect(selected.feePolicy.maxTransactionGasCost).toBeLessThan(feePolicy.maxTransactionGasCost)
    expect(applyVaultTransactionGasCostLimit(selected.quote, gasLimit, selected.feePolicy)).toEqual(
      selected.quote,
    )
    expect(
      validateVaultSignedTransactionFeeCaps(
        {
          gasLimit,
          maxFeePerGas: selected.quote.maxFeePerGas,
          maxPriorityFeePerGas: selected.quote.maxPriorityFeePerGas,
        },
        selected.quote,
        selected.feePolicy,
      ),
    ).toEqual({ valid: true })
    const replacement = selectBudgetedHedgeFees({
      quote,
      gasLimit,
      feePolicy,
      originalQuote: selected.quote,
    })
    expect(replacement.status).toBe('ready')
    if (replacement.status !== 'ready') throw new Error('Expected replacement headroom')
    expect(replacement.quote.maxFeePerGas * 8n).toBeGreaterThanOrEqual(
      selected.quote.maxFeePerGas * 9n,
    )
    expect(replacement.quote.maxPriorityFeePerGas * 8n).toBeGreaterThanOrEqual(
      selected.quote.maxPriorityFeePerGas * 9n,
    )
    expect(replacement.quote.maxFeePerGas * gasLimit).toBeLessThanOrEqual(
      feePolicy.maxTransactionGasCost,
    )
  })

  it('does not inflate an affordable desired quote', () => {
    const cheap = { ...quote, maxPriorityFeePerGas: 3n * gwei, maxFeePerGas: 5n * gwei }
    const selected = selectBudgetedHedgeFees({ quote: cheap, gasLimit, feePolicy })
    expect(selected).toMatchObject({
      status: 'ready',
      quote: { maxPriorityFeePerGas: 3n * gwei, maxFeePerGas: 5n * gwei },
    })
  })

  it('waits when the competitive floor cannot fit, including double-base headroom', () => {
    expect(
      selectBudgetedHedgeFees({
        quote,
        gasLimit,
        feePolicy: { ...feePolicy, maxTransactionGasCost: 10_000_000_000_000_000n },
      }),
    ).toMatchObject({ status: 'wait' })
    expect(
      selectBudgetedHedgeFees({
        quote: { ...quote, currentBaseFeePerGas: 100n * gwei },
        gasLimit,
        feePolicy,
      }),
    ).toMatchObject({ status: 'wait' })
  })

  it('retains mandatory bumps even if market fees drop, and refuses a shrunken budget', () => {
    const originalQuote = { maxFeePerGas: 60n * gwei, maxPriorityFeePerGas: 10n * gwei }
    const cheap = { ...quote, maxPriorityFeePerGas: 3n * gwei }
    const selected = selectBudgetedHedgeFees({ quote: cheap, gasLimit, feePolicy, originalQuote })
    expect(selected).toMatchObject({
      status: 'ready',
      quote: { maxFeePerGas: 67_500_000_000n, maxPriorityFeePerGas: 11_250_000_000n },
    })
    expect(
      selectBudgetedHedgeFees({
        quote: cheap,
        gasLimit,
        feePolicy: { ...feePolicy, maxTransactionGasCost: 120_000_000_000_000_000n },
        originalQuote,
      }),
    ).toMatchObject({ status: 'wait' })
    expect(
      selectBudgetedHedgeFees({
        quote: cheap,
        gasLimit: gasLimit * 100n,
        feePolicy,
        originalQuote,
      }),
    ).toMatchObject({ status: 'wait' })
  })

  it('reserves a ceil-rounded replacement at one-wei boundaries', () => {
    const tinyQuote = {
      ...quote,
      currentBaseFeePerGas: 0n,
      maxPriorityFeePerGas: 1_000n,
      competitivePriorityFeePerGas: 1n,
    }
    for (const gas of [1n, 3n, 19n]) {
      for (let budget = gas; budget < gas * 40n; budget++) {
        const policy = { ...feePolicy, maxTransactionGasCost: budget }
        const first = selectBudgetedHedgeFees({
          quote: tinyQuote,
          gasLimit: gas,
          feePolicy: policy,
        })
        if (first.status !== 'ready') continue
        const next = selectBudgetedHedgeFees({
          quote: tinyQuote,
          gasLimit: gas,
          feePolicy: policy,
          originalQuote: first.quote,
        })
        expect(next.status).toBe('ready')
        if (next.status === 'ready')
          expect(next.quote.maxFeePerGas * gas).toBeLessThanOrEqual(budget)
      }
    }
  })

  it('rejects missing, inconsistent or routine authority rather than inventing a floor', () => {
    for (const invalid of [
      { ...quote, competitivePriorityFeePerGas: undefined },
      { ...quote, competitivePriorityFeePerGas: quote.maxPriorityFeePerGas + 1n },
      { ...quote, currentBaseFeePerGas: -1n },
    ])
      expect(() => selectBudgetedHedgeFees({ quote: invalid, gasLimit, feePolicy })).toThrow(
        'authority',
      )
    expect(() =>
      selectBudgetedHedgeFees({
        quote,
        gasLimit,
        feePolicy: { ...feePolicy, marketPriorityFees: false },
      }),
    ).toThrow('authority')
  })
})
