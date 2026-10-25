import { describe, expect, it } from 'vitest'

import {
  adjustVaultSharePricesForDonations,
  donationRetainedFactor,
  valueDonationInUnderlying,
} from './donations'

describe('donation-adjusted performance', () => {
  it('removes contributions and retains later gains, across multiple donations', () => {
    const history = [
      { timestampSec: 0, sharePrice: '1' },
      { timestampSec: 10, sharePrice: '1.1' },
      { timestampSec: 20, sharePrice: '1.21' },
      { timestampSec: 30, sharePrice: '1.331' },
    ]
    const result = adjustVaultSharePricesForDonations(
      history,
      [10, 30].map((timestampSec) => ({
        timestampSec,
        blockNumber: String(timestampSec),
        donatedAssetsRaw: '10',
        retainedFactor: donationRetainedFactor(10n, 110n),
      })),
    )
    expect(result.map((p) => Number(p.sharePrice))).toEqual([1, 1, 1.1, 1.1])
    expect(history[1]?.sharePrice).toBe('1.1')
  })
  it('does not reattribute donations before a window to its returns', () => {
    const result = adjustVaultSharePricesForDonations(
      [
        { timestampSec: 20, sharePrice: '1.1' },
        { timestampSec: 30, sharePrice: '1.21' },
      ],
      [{ timestampSec: 10, blockNumber: '1', donatedAssetsRaw: '10', retainedFactor: '0.5' }],
    )
    expect(Number(result[1]?.sharePrice) / Number(result[0]?.sharePrice)).toBeCloseTo(1.1)
  })
  it('values mixed frames in either token ordering without applying decimals twice', () => {
    for (const tick of [-200000, 200000]) {
      const converted = valueDonationInUnderlying({
        assetsRaw: 10n ** 18n,
        tokenIndex: 0,
        underlyingIndex: 1,
        tick,
      })
      const reversed = valueDonationInUnderlying({
        assetsRaw: converted,
        tokenIndex: 1,
        underlyingIndex: 0,
        tick,
      })
      expect(Number(reversed) / 1e18).toBeCloseTo(1, 6)
    }
    expect(
      valueDonationInUnderlying({ assetsRaw: 123456n, tokenIndex: 1, underlyingIndex: 1, tick: 0 }),
    ).toBe(123456n)
    expect(() => donationRetainedFactor(100n, 100n)).toThrow()
    expect(() =>
      adjustVaultSharePricesForDonations(
        [{ timestampSec: 1, sharePrice: '1' }],
        [{ timestampSec: 1, blockNumber: '1', donatedAssetsRaw: '1', retainedFactor: '-1' }],
      ),
    ).toThrow()
  })
})
