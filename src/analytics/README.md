# Candle indicators

`calculateMarketIndicator`, `calculateVarianceProfile`, and `prepareIndicatorCandles`
are exported from `@panoptic-eng/sdk/v2`. These are pure functions with no indexer,
RPC, React, or subgraph dependency.

Inputs are Unix bucket-start seconds and Uniswap OHLC ticks as bigints. Prices use
Decimal.js with 40 digits of precision and quote units per asset. Inverting the
asset also inverts high/low ordering. Log returns are tick differences multiplied
by `ln(1.0001)`; the constant cancels in skewness, kurtosis, and variance ratios,
so those calculations retain bigint tick differences until the final division.

Callers must supply completed candles. Preparation sorts and validates candles,
rejects duplicates, and fills only internal no-swap buckets with the preceding
close. It does not extend coverage before the first or after the last observation.
The caller must ensure gaps represent no activity, rather than missing indexer
history. Windows exceeding 4,096 buckets are rejected.

| Indicator | Definition |
| --- | --- |
| ATR | True range is `max(high-low, abs(high-prevClose), abs(low-prevClose))`; the first range is `high-low`. Seed with the first 14-range mean, then Wilder smoothing with alpha `1/14`. |
| Kaufman ER | Absolute 10-candle net price change divided by the sum of the 10 absolute close changes. Flat windows return 0. |
| RSI | Wilder-smoothed positive and negative close changes over 14 observations. `100 - 100/(1 + avgGain/avgLoss)`. Flat prices return 50; gains with no losses return 100. |
| Realized moments | Rolling 96 log returns. Population central moments: skewness `m3/m2^(3/2)` and excess kurtosis `m4/m2² - 3`. These are descriptive moments without small-sample bias correction. |
| Variance ratio | Rolling 96 log returns, lag 4, overlapping and finite-sample corrected as below. This is the ratio, not a significance test or p-value. |
| UTC variance profile | Unannualized sample variance (`n-1` denominator) of selected-interval log returns, grouped separately by UTC hour (0–23) and weekday (0–6, starting Monday). The bucket belongs to the ending candle's start timestamp. Each group includes its sample count. |

For the variance ratio, let `n=96`, `q=4`, `r` be log returns, and `mu` their
sample mean. The one-period variance is `sum((r-mu)²)/(n-1)`. The q-period
variance per period is `sum((sum_q(r)-q*mu)²)/m`, using all overlapping windows,
where `m=q*(n-q+1)*(1-q/n)`. The displayed ratio divides the latter by the former.

Warm-up points and zero-variance moments/ratios return null. Variance-profile
buckets with fewer than two returns also return null, rather than zero.

The UI requests at most 512 candles for rolling charts and 2,048 candles for
calendar profiles, bounded by the indexer's retained history. By default the
interval follows the Price chart, including its Auto resolution. Profiles accept
intervals that divide a UTC day; the UI displays only weekdays for daily candles.
The function's default interval remains one hour for existing callers.

## Formula references

- [TradingView: ATR](https://www.tradingview.com/support/solutions/43000501823-average-true-range-atr/)
- [TradingView: Kaufman efficiency ratio](https://www.tradingview.com/support/solutions/43000773012-kaufman-s-adaptive-moving-average-kama/)
- [TradingView: RSI](https://www.tradingview.com/support/solutions/43000502338-relative-strength-index-rsi/)
- [NIST: skewness and kurtosis](https://www.itl.nist.gov/div898/handbook/eda/section3/eda35b.htm)
- [arch: Lo–MacKinlay implementation](https://bashtage.github.io/arch/_modules/arch/unitroot/unitroot.html#VarianceRatio)
