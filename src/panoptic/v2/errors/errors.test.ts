import { describe, expect, it } from 'vitest'

import {
  // Contract errors
  AccountInsolventError,
  ChunkLimitError,
  CrossPoolError,
  InvalidTokenIdParameterError,
  // SDK errors
  NetworkMismatchError,
  NotEnoughTokensError,
  OracleRateLimitedError,
  PanopticError,
  PanopticHelperNotDeployedError,
  PriceBoundFailError,
  ProviderLagError,
  RpcError,
  SafeModeError,
  StaleDataError,
  SyncTimeoutError,
  TransferFailedError,
  UnhealthyPoolError,
} from './index'

describe('PanopticError (base)', () => {
  it('creates error with message', () => {
    const error = new PanopticError('Test error')
    expect(error.message).toBe('Test error')
    expect(error.name).toBe('PanopticError')
  })

  it('creates error with cause', () => {
    const cause = new Error('Original error')
    const error = new PanopticError('Wrapped error', cause)
    expect(error.cause).toBe(cause)
  })

  it('is instanceof Error', () => {
    const error = new PanopticError('Test')
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(PanopticError)
  })

  it('has stack trace', () => {
    const error = new PanopticError('Test')
    expect(error.stack).toBeDefined()
    expect(error.stack).toContain('PanopticError')
  })
})

describe('Contract errors', () => {
  describe('AccountInsolventError', () => {
    it('includes solvent and numberOfTicks', () => {
      const error = new AccountInsolventError(100n, 5n)
      expect(error.solvent).toBe(100n)
      expect(error.numberOfTicks).toBe(5n)
      expect(error.name).toBe('AccountInsolventError')
      expect(error.message).toContain('100')
      expect(error.message).toContain('5')
    })

    it('extends PanopticError', () => {
      const error = new AccountInsolventError(100n, 5n)
      expect(error).toBeInstanceOf(PanopticError)
    })
  })

  describe('NotEnoughTokensError', () => {
    it('includes token details', () => {
      const error = new NotEnoughTokensError(
        '0x1234567890123456789012345678901234567890',
        1000n,
        500n,
      )
      expect(error.tokenAddress).toBe('0x1234567890123456789012345678901234567890')
      expect(error.assetsRequested).toBe(1000n)
      expect(error.assetBalance).toBe(500n)
    })
  })

  describe('InvalidTokenIdParameterError', () => {
    it('maps parameter type to name', () => {
      const error0 = new InvalidTokenIdParameterError(0n)
      expect(error0.message).toContain('poolId')

      const error1 = new InvalidTokenIdParameterError(1n)
      expect(error1.message).toContain('ratio')

      const error4 = new InvalidTokenIdParameterError(4n)
      expect(error4.message).toContain('strike')

      const error99 = new InvalidTokenIdParameterError(99n)
      expect(error99.message).toContain('unknown')
    })
  })

  describe('PriceBoundFailError', () => {
    it('includes current tick', () => {
      const error = new PriceBoundFailError(-12345n)
      expect(error.currentTick).toBe(-12345n)
      expect(error.message).toContain('-12345')
    })
  })

  describe('TransferFailedError', () => {
    it('includes all transfer details', () => {
      const error = new TransferFailedError(
        '0x1111111111111111111111111111111111111111',
        '0x2222222222222222222222222222222222222222',
        1000n,
        500n,
      )
      expect(error.token).toBe('0x1111111111111111111111111111111111111111')
      expect(error.from).toBe('0x2222222222222222222222222222222222222222')
      expect(error.amount).toBe(1000n)
      expect(error.balance).toBe(500n)
    })
  })
})

describe('SDK errors', () => {
  describe('NetworkMismatchError', () => {
    it('includes chain IDs', () => {
      const error = new NetworkMismatchError(1n, 42161n)
      expect(error.walletChainId).toBe(1n)
      expect(error.expectedChainId).toBe(42161n)
      expect(error.name).toBe('NetworkMismatchError')
    })
  })

  describe('CrossPoolError', () => {
    it('includes pool addresses', () => {
      const error = new CrossPoolError(
        '0x1111111111111111111111111111111111111111',
        '0x2222222222222222222222222222222222222222',
      )
      expect(error.requestedPool).toBe('0x1111111111111111111111111111111111111111')
      expect(error.configuredPool).toBe('0x2222222222222222222222222222222222222222')
    })
  })

  describe('SyncTimeoutError', () => {
    it('includes timing information', () => {
      const error = new SyncTimeoutError(30000n, 5000n, 1000n)
      expect(error.elapsedMs).toBe(30000n)
      expect(error.blocksProcessed).toBe(5000n)
      expect(error.blocksRemaining).toBe(1000n)
    })
  })

  describe('ChunkLimitError', () => {
    it('includes count information', () => {
      const error = new ChunkLimitError(995n, 10n)
      expect(error.currentCount).toBe(995n)
      expect(error.attemptedAdd).toBe(10n)
      expect(error.message).toContain('1000')
    })
  })

  describe('SafeModeError', () => {
    it('includes level and reason', () => {
      const error = new SafeModeError('restricted', 'High volatility detected')
      expect(error.level).toBe('restricted')
      expect(error.reason).toBe('High volatility detected')
      expect(error.message).toContain('restricted')
      expect(error.message).toContain('High volatility detected')
    })
  })

  describe('StaleDataError', () => {
    it('includes timestamps', () => {
      const error = new StaleDataError(1000n, 1100n, 100n)
      expect(error.blockTimestamp).toBe(1000n)
      expect(error.currentTimestamp).toBe(1100n)
      expect(error.stalenessSeconds).toBe(100n)
    })
  })

  describe('UnhealthyPoolError', () => {
    it('includes health status', () => {
      const error = new UnhealthyPoolError('low_liquidity')
      expect(error.healthStatus).toBe('low_liquidity')
      expect(error.message).toContain('low_liquidity')
    })
  })

  describe('OracleRateLimitedError', () => {
    it('includes timing', () => {
      const error = new OracleRateLimitedError(1000n, 1030n)
      expect(error.lastUpdate).toBe(1000n)
      expect(error.currentTime).toBe(1030n)
      expect(error.message).toContain('64s')
    })
  })

  describe('PanopticHelperNotDeployedError', () => {
    it('has descriptive message', () => {
      const error = new PanopticHelperNotDeployedError()
      expect(error.message).toContain('PanopticHelper')
      expect(error.message).toContain('not deployed')
    })
  })

  describe('ProviderLagError', () => {
    it('includes block numbers', () => {
      const error = new ProviderLagError(1000n, 1010n)
      expect(error.providerBlock).toBe(1000n)
      expect(error.expectedBlock).toBe(1010n)
    })
  })

  describe('RpcError', () => {
    it('includes method and retry count', () => {
      const error = new RpcError('eth_call', 3n)
      expect(error.method).toBe('eth_call')
      expect(error.retriesAttempted).toBe(3n)
    })
  })
})

describe('Error hierarchy', () => {
  it('all errors extend PanopticError', () => {
    const errors = [
      new AccountInsolventError(0n, 0n),
      new NetworkMismatchError(1n, 2n),
      new ChunkLimitError(1n, 1n),
    ]

    for (const error of errors) {
      expect(error).toBeInstanceOf(PanopticError)
      expect(error).toBeInstanceOf(Error)
    }
  })

  it('errors can be caught by PanopticError', () => {
    const catchError = (fn: () => void): PanopticError | null => {
      try {
        fn()
        return null
      } catch (e) {
        if (e instanceof PanopticError) {
          return e
        }
        throw e
      }
    }

    const result = catchError(() => {
      throw new ChunkLimitError(1000n, 1n)
    })

    expect(result).toBeInstanceOf(ChunkLimitError)
    expect(result).toBeInstanceOf(PanopticError)
  })
})
