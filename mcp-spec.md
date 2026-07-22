# Panoptic MCP Spec

Status: draft — 2026-07-21. Supersedes the 2026-07-09 draft (see Decisions Log
for what changed and why).

This document covers two related but distinct MCP surfaces:

- **Product MCP**: a Panoptic MCP server for users' agents and developer
  integrators. It exposes the SDK as read / build / simulate tools. It ships
  **first, as a local stdio server distributed via `npx`** — see Strategy.
- **Hedger MCP**: an internal operator surface for `apps/hedger-bot`. It exposes
  cycle inspection, simulation, diagnostics, and (much later, guarded) execution.

They share serialization, tool-shape conventions, and security posture, but they
are not one server. Product MCP is public and protocol-facing; Hedger MCP is
deployment-local and authority-bearing.

## Strategy

The overarching goal: **let anyone running any agent framework (Claude Code,
Cursor, and any other MCP client) interface with Panoptic with near-zero
friction.**

Two conclusions follow, and they set the shape of everything below:

1. **Reach comes from a local stdio server, not from hosting.** The first and
   primary distribution is `npx @panoptic-eng/mcp`: zero infra, zero auth, no
   keys, running against the user's own
   RPC endpoint. A hosted `mcp.panoptic.xyz` endpoint is a later *convenience*
   layer, justified mainly when indexer-only analytics cannot run on a user's
   plain RPC. It is **deferred**, not designed here beyond a stub.
2. **The moat is the tool catalog, not the transport.** The value is in
   agent-shaped, decode-heavy tools — `explain_position`, `simulate_tx` with
   decoded reverts, `account_health`, `build_position` returning summarized
   unsigned envelopes. Any MCP client can speak stdio; only Panoptic can ship
   tools that understand a TokenId.

Recommended build order (see Phasing for detail):

```text
v0  local, read-only          →  v1  local, build + simulate (unsigned envelopes)
        →  v2  local signer (separate spec)  →  v3  hosted (only if demand /
           indexer analytics force it)
```

This is validated by the SDK's shape: `@panoptic-eng/sdk/v2` is pure viem (no
React/wagmi), and essentially every v0/v1 tool runs on a plain viem
`PublicClient` — no subgraph required. Subgraph access is an *enhancement* for
history and account discovery, exposed as an optional per-call URL.

## Goals

Make Panoptic natively usable by AI agents without giving those agents raw
contract or key authority.

- End-user agents can analyze pools, inspect portfolio risk, and prepare trades.
- Integrators get a zero-learning-curve surface over `@panoptic-eng/sdk`.
- Bot operators can ask "why did this hedger act or skip?" and get a grounded
  answer backed by deterministic bot state.

Prioritized product domains: trading and portfolio, analytics and data, risk and
liquidations, contract introspection.

Prioritized hedger domains: cycle inspection, dry-run simulation, incident
triage, deployment/scope auditing, and threshold tuning.

## Architecture

### Product MCP (local stdio — the primary surface)

```text
┌──────────────────────┐        ┌─────────────────────────────────────────────┐
│ MCP client            │ stdio  │ npx @panoptic-eng/mcp  (local process)        │
│ (Claude Code, Cursor, ├───────▶│  - wraps @panoptic-eng/sdk/v2 (pure viem)     │
│  any MCP client)      │        │  - reads / analytics / risk                   │
│                       │        │  - build + simulate → unsigned tx envelopes   │
│                       │◀───────┤  - never holds private keys, never signs      │
└──────────────────────┘        └───────────────┬───────────────────┬───────────┘
                                                 │ RPC               │ optional
                                                 ▼                   ▼
                                    user's own RPC endpoint   subgraph URL (analytics)
```

- The server is a **stateless wrapper over the SDK**. It is configured with the
  user's RPC URL and a chain id; it holds no keys and cannot move value.
- Write-like tools return a fully built, simulated, **unsigned transaction
  envelope** plus a human-readable summary. Signing happens elsewhere (a wallet,
  or the future local signer companion).
- Position discovery for a wallet uses the SDK's event-scan `syncPositions` into
  a local `StorageAdapter` (file or in-memory) — no subgraph needed.
- Analytics tools that benefit from an indexer accept an **optional
  `subgraphUrl`** argument (or `PANOPTIC_SUBGRAPH_URL` env). Without it they fall
  back to pure-RPC event scans over a bounded block window.

**Implementation home**: a new workspace package, `packages/mcp`, published to
npm as `@panoptic-eng/mcp`. It depends on `@panoptic-eng/sdk`; the SDK
never depends on it. This keeps the SDK free of MCP/server concerns and lets the
server release on its own cadence. (Decided — was an open question in the prior
draft.)

### Hosted Product MCP (deferred)

Not designed in this revision. When demand or indexer-only analytics justify it,
a hosted server would add:

- Streamable HTTP transport at a single `mcp.panoptic.xyz/mcp` endpoint.
- Resource-bound OAuth / API-key auth — tokens issued for the MCP resource
  itself; **no** passthrough of upstream tokens.
- Origin validation, TLS, rate limits, per-tenant cache/log isolation, and SSRF
  protection on any user-supplied URLs (subgraph, OAuth discovery).

The hosted server would reuse the exact same tool implementations as the local
server; only the transport and auth wrapper differ. Nothing in v0/v1 should make
that reuse harder.

### Hedger MCP

Hedger MCP is local to a bot deployment:

```text
agent/client ──MCP──▶ hedger MCP ──calls──▶ hedger internals ──module──▶ Safe/Roles or future AccountModule
```

It must reuse the same code path as the bot loop. The bot's cycle is already
factored into `readHedgeSnapshot()` (`src/hedge/snapshot.ts`),
`computeHedgePlan()` (`src/hedge/decision.ts`), and `assessSafety()`
(`src/hedge/safety.ts`). First compose these into a shared `buildCycleSnapshot()`
so the polling loop, `scripts/inspectHedge.ts`, and the MCP tools all produce an
identical snapshot:

```ts
buildCycleSnapshot({
  config,
  publicClient,
  priceSource,
  owner,
  trackedHedgeIds,
  lastDispatchTxHash,
})
```

It should return signal, positions, hedge classification, pool metadata, safety,
gas status, `HedgePlan`, and the `HedgeContext` needed by executors. Then use it
in:

- the normal polling loop (`src/hedgerBot.ts` `doCycle`);
- `scripts/inspectHedge.ts`;
- the Hedger MCP tools.

This removes the drift where `inspectHedge.ts` derives CEX price-source token
decimals from the snapshot it just read, while `main.ts` fetches decimals up
front from `getPoolMetadata()` and passes them into `createPriceSignalSource()`.
Both must build the price source from one metadata source, before the snapshot.

## Quickstart

The server is a standard stdio MCP server. **Every MCP client accepts the same
command + args + env shape**; only the config file location/format differs. A
canonical config:

```jsonc
{
  "mcpServers": {
    "panoptic": {
      "command": "npx",
      "args": ["-y", "@panoptic-eng/mcp"],
      "env": {
        "PANOPTIC_RPC_URL": "https://mainnet.base.org",
        "PANOPTIC_CHAIN_ID": "8453",
        // optional — enables indexer-backed analytics tools
        "PANOPTIC_SUBGRAPH_URL": ""
      }
    }
  }
}
```

- **Claude Code / Claude Desktop**: this block goes in `.mcp.json` (project) or
  the client's MCP settings.
- **Cursor and other clients**: the same `command`/`args`/`env` triple, in that
  client's MCP config location.

RPC URL and chain id may also be passed as CLI flags (`--rpc-url`, `--chain-id`,
`--subgraph-url`), which override the env vars.

### Example tool-call flow

An agent helping a user open a hedged position:

1. `get_portfolio({ address })` → current positions, collateral, net greeks.
2. `explain_position({ tokenId })` → decode an existing position into readable
   legs and likely strategy shape.
3. `build_position({ pool, legs, size, slippageBps })` → an **unsigned tx
   envelope** with `summary`, `simulation` (expected token flows / collateral
   delta), and `envelopeHash`.
4. `simulate_tx({ envelope })` → re-simulate the exact envelope; surfaces a
   decoded revert reason if the trade would fail.
5. The agent presents the summary; the user signs in their own wallet (or, later,
   via the local signer companion). The MCP server never signs.

## Serialization & Envelope Conventions

These invariants hold across **both** surfaces:

- **Bigints serialize as decimal strings.** Every numeric on-chain quantity
  (sizes, balances, ticks passed as bigint, premia) is a JSON string, never a
  JS number, to avoid precision loss.
- **Block context is attached.** Read results carry a `_meta` block
  `{ blockNumber, blockTimestamp, blockHash }` (all strings) so agents can reason
  about staleness and same-block consistency. The SDK already returns this on
  reads; the server passes it through.
- **Transaction outputs are unsigned envelopes, never free-form calldata.** Every
  build/write-like tool returns:

  ```jsonc
  {
    "summary": "Open 1×ETH short put, strike ~3200, width 4, 0.5% slippage",
    "risk": "defined | undefined | info",   // qualitative risk tag
    "chainId": "8453",
    "to": "0x…",                              // a known Panoptic deployment
    "value": "0",                             // decimal string, wei
    "data": "0x…",                            // ABI-encoded call, from the SDK
    "simulation": { /* expected token flow, collateral delta, gas */ },
    "envelopeHash": "0x…"                     // keccak of the canonical envelope
  }
  ```

  `envelopeHash` lets a future signer verify it is signing the exact object that
  was simulated and shown to the user — it cannot be tricked into signing a
  mutated transaction after the fact. The field is defined now so the envelope
  schema is stable before the signer exists.

## Product Tool Catalog

Organized by milestone. Each tool notes the SDK function(s) it wraps.

### v0 — read-only (pure RPC)

The tools below marked **SHIPPED** are the exact read-only surface the
`@panoptic-eng/mcp` package registers today (see the package README). The rest
are planned and **not yet exposed**.

- `list_pools({ chainId? })` — **SHIPPED.** Known deployment from the SDK
  `CHAIN_DEPLOYMENTS` registry, hydrated with live state via `getPool`: tokens,
  current tick, collateral trackers, health.
- `get_portfolio({ address, fromBlock? })` — **SHIPPED.** Discover open positions
  via `syncPositions` (event scan into a `StorageAdapter`), then `getPositions`,
  `getAccountCollateral`, and `getAccountGreeks` for legs, sizes, collateral
  balances, and net greeks.
- `explain_position({ tokenId })` — **SHIPPED.** `decodeTokenId` + leg
  introspection helpers (`hasLongLeg`, `isSpread`, `hasLoanOrCredit`, …) into
  human-readable legs and a coarse strategy label.
- `account_health({ address, fromBlock? })` — **SHIPPED.** Margin status and
  liquidation distance via `getAccountBuyingPower`, `getMarginBuffer`,
  `isLiquidatable`.
- `liquidity_map({ startTick?, nTicks? })` — **SHIPPED.** Tick liquidity
  distribution via `getPoolLiquidities`.
- `chunk_spread({ timescale?, width?, tickLower?, tickUpper?, vegoid? })` —
  **SHIPPED.** Per-chunk spread multiplier via `scanChunks` (`spreadWad / WAD`).
  Carries the interpretation that ~1.0x chunks (no removed liquidity, lowest IV)
  are cheapest to BUY and higher-multiplier chunks pay a richer premium so are
  most profitable to SELL.
- `identify_address({ address, chainId? })` — **SHIPPED.** Map an address to
  pool, tracker, factory, query, vault, manager, router, or unknown, from the
  deployment registry.
- `suggest_delta_hedge`, `advise_position`, `preview_position`,
  `position_scenario`, `hedge_params`, `trade_history` — **SHIPPED.** Additional
  read-only analytics tools (net delta + neutralizing leg, position management
  advice, pre-trade quote, payoff/NLV curve, SDK delta-hedge params, and
  event-level trade history). All discover positions via the same on-chain event
  scan; none build or send transactions.
- `stress_test({ address, priceMoves[] })` — *future.* Recompute account health
  / greeks at hypothetical ticks using client-side greeks (no RPC per scenario).
- `decode_calldata({ to, data, chainId })` — *future.* Identify the Panoptic
  contract and decode the call; `dispatch` args decoded into readable token ids /
  legs.
- `read_contract({ address, functionName, args })` — *future.* Known-ABI getter
  reads only.

### v1 — build + simulate (unsigned envelopes)

- `build_position({ pool, legs[], size, slippageBps, options? })` — construct a
  valid TokenId with `createTokenIdBuilder`, build SDK `dispatch` args, simulate,
  and return an unsigned envelope + summary.
- `build_strategy({ pool, name, params })` — named templates (e.g. `strangle`,
  `straddle`, `covered_call`, `spread`) that **expand to explicit legs the agent
  can inspect** and then run through the same `build_position` path. Templates
  are convenience over the explicit-leg builder, never a replacement; default
  parameters need product approval (see Open Questions).
- `close_position({ pool, tokenId, size?, slippageBps })` — close tx envelope.
- `roll_position({ pool, tokenId, targetLegs, size?, slippageBps })` — close/open
  batch when supported by SDK helpers.
- `deposit_collateral` / `withdraw_collateral({ pool, asset, amount })` —
  CollateralTracker tx envelopes.
- `simulate_tx({ envelope })` — `eth_call` the exact envelope; return expected
  token flow, collateral delta, and a **decoded revert reason** via
  `parsePanopticError` if any. Reuses the SDK's typed error classes.
- `find_liquidatable({ pool, cursor? })` — scan candidates (RPC event scan or
  subgraph when available), return estimated bonus and required tx inputs.
- `build_liquidation_tx({ account, pool })` — unsigned liquidation tx envelope.

Avoid raw strategy execution in v1: `build_strategy` only *expands and builds*;
it never signs or sends.

### Advisory (agent-shaped, read-only)

These are decode/compute-heavy tools that encode Panoptic domain knowledge on top
of the reads. They ground every recommendation in live on-chain facts and never
sign or send.

- `suggest_delta_hedge({ address, assetIndex?, fromBlock? })` — compute net delta
  (option positions + deposited collateral via `getAccountGreeks` with
  `includeCollateral`), then suggest a **width=0 loan/credit leg** sized to
  neutralize it: a loan borrowing the asset (short delta) when net long, a credit
  lending the asset (long delta) when net short. Returns an inspectable
  explicit-leg suggestion (tokenId + size, verified with `getLegDelta`) that can
  be handed to `build_position` for an envelope.
- `advise_position({ tokenId, address, fromBlock? })` — pull live position, pool,
  streamia (`getAccountPremia`), health (`getMarginBuffer`, `isLiquidatable`), and
  closeability (`simulateClosePosition`, decoded revert) and advise across four
  situations: short ITM/underwater, long options, can't-close/force-exercise, and
  collateral/liquidation risk. Tiered output — facts always, a single
  recommendation only when the situation is clear-cut.
- `preview_position({ address, tokenId, positionSize, ... })` — pre-trade quote via
  `getOpenPositionPreview` (a read-only dry-run `simulateOpenPosition`): collateral
  required, post-mint balances/requirements, solvency. tokenId-in.
- `position_scenario({ address, startTick?, endTick?, points? })` — payoff / NLV
  curve via `getNetLiquidationValues` over a tick band; answers "P&L if price → X".
- `hedge_params({ address? | tokenId+positionSize, targetDelta?, assetIndex? })` —
  SDK-native `getDeltaHedgeParams` (loan + `swapAtMint`) to reach a target delta,
  whole-portfolio or single-position. Complements the simpler `suggest_delta_hedge`
  (which hand-builds an asset=tokenType loan/credit without a swap).
- `trade_history({ address, fromBlock?, toBlock? })` — chronological mints/burns via
  `getAccountHistory` (event-level only; not realized P&L).

### Analytics and Data (optional subgraph)

These accept an optional `subgraphUrl` (or `PANOPTIC_SUBGRAPH_URL`). With it,
they answer from the indexer; without it, they fall back to a bounded pure-RPC
event scan and **document the window limit in their response**.

- `pool_stats({ pool, window })` — volume, open interest, utilization, PLP APY.
- `iv_surface({ pool, window? })` / `premia_history({ pool, strike?, window })` —
  implied vol and streamia research data (subgraph strongly preferred).
- `price_history({ pool, window })` — oracle/pool tick history.

These are read-only and cacheable — the natural free tier and the best
distribution hook for research agents, and the clearest future justification for
a hosted server.

### Contract Introspection

Contracts cannot host MCP servers. The realistic surface is an introspection
layer over known deployments, covered by `identify_address`, `decode_calldata`,
and `read_contract` above.

Future: generate tool manifests from on-chain permission sets (strategist leaves
or Zodiac Roles) so "what the agent can do" derives from live authorization.

## Local Signer Companion (deferred to its own spec)

v0 and v1 are **unsigned-envelope-only**. The server never holds keys. A separate
local signer companion (`@panoptic-eng/mcp-signer`, stdio) will later hold the
user's key and sign only previously built envelopes that pass local guardrails
(allowed chains, allowlisted `to`, max value, tx caps, and the `envelopeHash`
check defined above). Its guardrail design, storage model, and approval UX are
out of scope here and will be specified when v2 begins. The envelope schema is
already signer-ready so that spec does not force a breaking change.

## Hedger Tool Catalog

These tools belong in `apps/hedger-bot/src/mcp/`, not the public product MCP.

### Read and Explain

- `preflight()` — module/Safe/Roles wiring, chain, owner, pool metadata, price
  source readiness.
- `get_cycle_snapshot()` — structured `buildCycleSnapshot()` result.
- `get_portfolio_state()` — positions, hedge loans, collateral, net delta,
  `H`, `H*`, drift, safety.
- `get_price_signal()` — current source, tick, age, CEX contributors / dropped
  feeds when relevant.
- `get_cycle_journal({ limit, since })` — recent persisted cycle records.
- `explain_cycle(cycleId)` — deterministic facts plus an LLM-friendly summary.

### Simulate

- `compute_hedge_plan(overrides?)` — run the planner with optional hypothetical
  tick, threshold, max slots, or gas caps. Return the intent, not calldata.
- `simulate_hedge(planId?)` — dry-run execution through the configured executor
  or AccountModule; include decoded calls and expected result.
- `stress_hedger(priceMoves[])` — replay plan decisions over hypothetical ticks.

### Controlled Mutations

Default: **disabled**. Enable only with explicit env flags, never by default.

- `force_cycle()` — trigger one normal bot cycle; still runs safety, gas, and
  executor checks.
- `pause()` / `resume()` — only if the runtime has a local pause switch.
- `execute_hedge(planId)` — **deferred**; the last thing to ship, and only after
  everything above is stable. It must not accept raw calldata or arbitrary
  transaction objects. It accepts a `planId` derived from:

  ```text
  hash(chainId, poolAddress, owner, snapshotBlock, signalTick, plan.intent, expiresAt)
  ```

  Before execution it must recompute or reload the snapshot, verify the plan is
  fresh, simulate the exact intent, then call the existing executor. The final
  authority boundary remains the Safe/Zodiac role or future AccountModule.

## Hedger Cycle Journal

Add an append-only **JSONL** cycle journal before adding the MCP server. It is
the shared substrate for explanations, incident triage, and tuning. It is
distinct from the existing `.hedger-journal.json` (a transaction-recovery journal
keyed by intent) and the `.hedger-runtime.json` heartbeat — those persist
transaction lifecycle and liveness, not per-cycle decision context. The bot
writes it; the MCP tools only read it.

Each record should include:

- schema version;
- timestamp and block number;
- chain, pool, owner, module kind;
- signal source, signal tick, observed time, source diagnostics;
- position ids, hedge ids, hedge count;
- positions delta, collateral delta, net delta, portfolio size;
- `H`, `H*`, drift bps, triggers, action;
- safety result and reasons;
- gas assessment and keeper balance status;
- execution result: dry run, tx hashes, opened/closed token ids, fallback flag;
- normalized error class and raw error string when present.

The journal must avoid secrets and private keys. It may contain addresses, token
ids, and tx hashes.

## Security Model

### Product MCP (local)

- The server holds no private keys and cannot execute value-moving actions. Its
  authority is exactly that of the RPC endpoint it is given (reads + `eth_call`).
- The realistic threat is **bad advice**: a plausible-but-wrong envelope a user
  signs elsewhere. Mitigations: build-then-simulate before returning any
  envelope, a human-readable `summary` and `risk` tag on every envelope, and the
  `envelopeHash` so a downstream signer signs exactly what was simulated.
- `to` addresses in envelopes are constrained to known Panoptic deployments from
  the registry; the server never emits an envelope to an arbitrary address.
- No `sendTransaction`-style tool exists at any tier of the product server.

### Local Signer (when it ships)

- stdio; holds keys; signs only product-MCP envelopes passing local guardrails;
  displays exact chain, target, value, function, and summary before approval.
  Full model in the signer spec.

### Hedger MCP

- Bind locally or behind private infrastructure only; treat it as operational
  control-plane software, not a public endpoint.
- `execute_hedge` is disabled by default and plan-id gated when enabled.
- Agents may explain and propose. Deterministic code computes plans; the
  executor/module and on-chain permissions enforce writes.
- Scope-auditor tools must verify positive and negative cases: pure width-0 loan
  dispatch passes Roles, width>0 option dispatch is blocked by Roles, router
  templates are constrained to whitelisted pools and Safe recipients.

### Hosted Product MCP (when it ships)

- Resource-bound tokens (no passthrough), origin validation, TLS, rate limits,
  per-tenant isolation, SSRF protection on user-supplied URLs. Detailed in the
  hosting spec.

## Phasing

**Product:**

1. **v0 — local stdio, read-only**: `npx @panoptic-eng/mcp` wrapping SDK reads —
   `list_pools`, `get_portfolio`, `explain_position`, `account_health`,
   `stress_test`, `liquidity_map`, `identify_address`, `decode_calldata`,
   `read_contract`.
2. **v1 — build + simulate**: explicit-leg `build_position`, `build_strategy`
   templates, `close_position`, `roll_position`, collateral builders,
   `simulate_tx` with decoded reverts, liquidation builders. All return unsigned
   envelopes.
3. **v2 — local signer**: `@panoptic-eng/mcp-signer` (separate spec) with
   envelope-hash verification and local guardrails.
4. **v3 — hosted remote**: Streamable HTTP at `mcp.panoptic.xyz/mcp`, resource-
   bound auth, indexer-backed analytics. Only if demand or indexer-only analytics
   force it.
5. **v4 — agent-native accounts**: delegated session wallets, leaves/Roles-derived
   manifests, premium analytics / payment hooks.

**Hedger:**

1. Compose `buildCycleSnapshot()` from the existing `readHedgeSnapshot` /
   `computeHedgePlan` / `assessSafety`, and fix `inspectHedge.ts` to build the
   price source from the same metadata path as `main.ts`.
2. Add the JSONL cycle journal.
3. Add read-only Hedger MCP tools.
4. Add Telegram/Slack copilot commands over the read-only tools.
5. Add scope auditor and approval auditor.
6. Add offline parameter-tuning and digest agents.
7. Consider plan-id-gated `execute_hedge` only after all of the above is stable.

## Hedger Agent Features

Recommended features, in build order:

1. **Cycle journal** — required for grounded explanations and tuning.
2. **Read-only Hedger MCP** — structured replacement for ad hoc `inspect:hedge`.
3. **Alert enrichment** — classify `formatError` / `formatSkip` alerts into
   operator actions: fund keeper, raise gas cap, rerun scope, fix approvals,
   switch signal source, inspect pending tx.
4. **Telegram/Slack copilot** — `/status`, `/plan`, `/simulate`, `/why`,
   `/scope`, `/approvals`, `/gas`, `/pause`.
5. **Pre-deploy scope auditor** — adversarial checks over actual Roles and router
   conditions before `.env` is trusted.
6. **Anomaly watchdog** — warning-only invariant checks: hedge sign opposes net
   delta, hedge size is plausible vs portfolio, CEX/pool divergence within
   tolerance, repeated fallback is not normal.
7. **Post-mortem and digest agent** — daily summary of hedge count, gas,
   deferrals, fallback frequency, error classes, and drift distribution.
8. **Parameter-tuning advisor** — replay historical ticks through the planner
   across threshold/gas/max-slot grids and report the tracking-error vs cost
   frontier. Advisory only; never auto-write config.

## Decisions Log

Recorded 2026-07-21, from a design review. These resolve items the prior draft
left open:

- **Local-first, hosting deferred.** The primary surface is a local stdio server
  via `npx`; the hosted endpoint is a later convenience layer, not designed in
  detail here. (Was: co-equal hosted + local architecture.)
- **Product MCP ships first**; Hedger MCP follows on its own track.
- **Package home decided**: a new published `packages/mcp` depending on
  `@panoptic-eng/sdk`. (Was: open — `packages/mcp` vs `@panoptic-eng/sdk/mcp`
  subpath.)
- **Package name decided**: `@panoptic-eng/mcp`, matching the `@panoptic-eng/sdk`
  scope over an unscoped `panoptic-mcp`. Published via `.github/workflows/
  publish-mcp.yml` (Nx-affected gate + OIDC trusted publishing, mirroring the SDK
  workflow). (Was: open.)
- **Signer deferred entirely** to its own spec; v0/v1 are unsigned-envelope-only.
  The `envelopeHash` field is retained now so the schema is signer-ready.
- **Named-strategy templates ship in v1** but only expand to inspectable explicit
  legs feeding the same `build_position` path — not a separate execution surface.
- **Analytics take an optional subgraph URL**; all other v0/v1 tools run on plain
  RPC.
- **One canonical client-config snippet**; all MCP clients accept the same
  command/args/env shape.
- **Hedger track confirmed**: `buildCycleSnapshot()` extraction + JSONL cycle
  journal + read-only tools; `execute_hedge` stays deferred and plan-id gated.

## Open Questions

- **Multi-chain arg convention.** One server instance per chain (chain id in
  config) vs a single instance taking `chainId` on every tool call. Leaning
  per-instance for v0 simplicity; revisit if agents need cross-chain in one
  session.
- **Event-scan window limits.** For RPC-only analytics and `find_liquidatable`,
  what default block window balances completeness against RPC provider limits?
  Must be surfaced in tool responses, never silently truncated.
- **Strategy-template catalog + defaults.** Which named strategies ship in v1,
  and what default strikes/widths — needs product approval and disclosures.
- **Monetization** (hosted only, therefore deferred): free reads vs API-key tiers
  vs per-call payments.
- **Schema sharing.** Whether Hedger MCP shares serialization/schema types with
  Product MCP without sharing server code.
