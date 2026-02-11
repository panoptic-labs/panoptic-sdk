# Panoptic v2 SDK Example Catalog

This document defines the example tiers and the strategy goals for each example.
It is intentionally high-level so individual example READMEs can focus on implementation details.

## Tiering

- `basic/`: Single-purpose scripts that teach one SDK capability at a time.
- `intermediate/`: Multi-step workflows that combine reads, simulations, writes, and safety checks.
- `advanced/`: Full strategy systems with execution/risk infrastructure and production-style control loops.

## Basic Examples

- `01-simple-read`: Read pool/account/oracle state and verify freshness.
- `02-open-position`: Build tokenId, simulate open, execute open.
- `03-close-position`: Inspect an existing position and close it safely.
- `04-vault-operations`: Deposit/withdraw and ERC4626 preview flows.
- `05-position-sync`: Initial + incremental position synchronization.
- `06-trade-history`: Persist closed positions and query realized PnL.
- `07-chunk-tracking`: Scan/track chunks and inspect spread dynamics.
- `08-pending-positions`: Optimistic position state before confirmation.
- `09-reorg-handling`: Detect and recover from chain reorganizations.

## Intermediate Examples

- `10-event-subscription`: Real-time event stream with reconnect and gap fill.
- `11-position-lifecycle`: Open -> roll -> settle premia -> close lifecycle.
- `12-query-utils`: Portfolio/collateral utility reads from PanopticQuery helpers.
- `13-delta-hedge`: Use account/position greeks to keep delta near target.
- `14-vertical-spreads`: Build and manage defined-risk vertical structures.
- `15-calendar-spreads`: Same strike across expiries for term-structure positioning.
- `16-roll-manager`: Rule-based rolling by delta, distance, or time criteria.
- `17-risk-guardrails`: Freshness/health checks, safe-mode controls, kill switch.

## Advanced Examples

- `market-maker`: Continuous quoting/open/roll/close with inventory management.
- `execution-engine`: Nonce, retry, gas policy, and broadcaster abstraction layer.
- `reorg-resilient-runner`: Idempotent strategy loop with checkpointed recovery.
- `gamma-scalping`: Dynamic delta hedging around short gamma exposure.
- `spread-multiplier-targeted-selling`: Write options where spread dislocation is largest.
- `vol-surface-arbitrage`: Relative-value trades across strikes/widths/expiries.
- `vix-like-replication-calendar-strips`: Variance-style exposure using calendar spread strips to approximate an implied-volatility index profile.

## Design Notes

- Keep public interfaces simple; hide strategy complexity inside modules.
- Simulate before every write path, then enforce explicit execution gates.
- Prefer deterministic state recovery (sync checkpoints + event replay) over implicit assumptions.
- Standardize observability: logs, metrics, and structured error categories across all advanced examples.
