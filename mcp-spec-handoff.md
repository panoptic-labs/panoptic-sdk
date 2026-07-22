# Handoff: Iterate the Panoptic MCP Spec

## Your job
Produce a comprehensive, improved version of the Panoptic MCP specification at:
`packages/sdk/mcp-spec.md`

Do NOT rewrite it blind. The existing draft is solid but there are open
decisions and a strategic reframing (below) that need MY input. **Interview me
first, then iterate on the file with me in the loop.** Treat this as
collaborative editing, not a one-shot rewrite.

## Start here
1. Read `packages/sdk/mcp-spec.md` in full (it's the current draft, ~340 lines).
2. Skim the SDK it wraps: `packages/sdk` (package `panoptic-v2-sdk`, imported as
   `@panoptic-eng/sdk/v2`), especially read/build/simulate helpers and the
   TokenId decoder.
3. Skim `apps/hedger-bot/src/hedgerBot.ts` and `scripts/inspectHedge.ts` — the
   spec proposes extracting a shared `buildCycleSnapshot()` and a JSONL cycle
   journal; understand the current code before speccing changes.

## Context: what the spec covers today
- Two surfaces: **Product MCP** (public, keyless, read/build/simulate) and
  **Hedger MCP** (internal operator tool for the bot). They share conventions
  but are separate servers.
- Distributed today as a local stdio server, `npx @panoptic-eng/mcp` (zero
  infra, zero auth, no keys, runs against the user's own RPC). Hosting is
  deferred — no hosted endpoint ships yet. Write-like tools (future) return
  unsigned tx envelopes; the server never signs — signing is left to the caller's
  own local tooling.
- Tool catalogs, a 5-phase product rollout, a 7-step hedger rollout, security
  model, and an Open Questions section.

## Strategic reframing to fold in (came out of a design discussion — validate with me)
The overarching goal is: **let anyone running any agent framework (Claude Code,
Cursor, Hermes, OpenClaw, …) interface with Panoptic with near-zero friction.**
Against that goal, my current leanings — CONFIRM or CHALLENGE these with me:
- The **hosted `mcp.panoptic.xyz` endpoint is likely overkill as a first move.**
  Reach comes from a **local stdio server distributed via `npx @panoptic/mcp`**
  (zero infra, zero auth, no keys, runs against the user's own RPC). Hosting is
  a later *convenience* layer, not the enabler, and mainly justified when
  indexer-only analytics can't run on a user's plain RPC.
- **The moat is the tool catalog, not the transport** — agent-shaped, decode-
  heavy tools (`explain_position`, `simulate_tx` with decoded reverts,
  `account_health`, `build_position` returning summarized unsigned envelopes).
- Recommended build order: v0 local read-only → v1 local build+simulate
  (unsigned envelopes) → v2 local signer → hosting only if/when demand or
  indexer analytics forces it.
- Hosting platform is UNDECIDED (Railway/Cloudflare/etc. — spec doesn't name
  one). Multi-chain routing (one endpoint + `chainId` arg vs per-chain
  endpoints) is still open.

## Interview me before major edits
Ask focused, batched questions (not a wall of text) covering at least:
1. **Priority & scope** — Which surface first: Product MCP, Hedger MCP, or both?
   How aggressively should the spec de-emphasize hosting in favor of local npx?
2. **Distribution** — npm package name(s), the `packages/mcp` vs
   `@panoptic-eng/sdk/mcp` subpath split, versioning/release story.
3. **Tool catalog** — Which tools are must-have in v0/v1? Any missing? How much
   high-level strategy language (e.g. `build_strategy("short strangle")`)
   belongs in v1 vs a later advisory layer?
4. **Analytics** — Which tools can run on plain RPC vs require the internal
   indexer/subgraph? (This decides what's even possible locally.)
5. **Signer & security** — Guardrail defaults, envelope-hash scheme, whether
   HTTP signer is ever allowed.
6. **Hedger MCP** — Is `buildCycleSnapshot()` extraction + JSONL journal agreed?
   Should `execute_hedge` ever ship, and under what gating?
7. **Monetization / auth** — Free reads vs API-key tiers vs per-call; only
   relevant once hosted.
8. **Audience** — Concretely, which agent frameworks must work day one, and do
   we ship client-config quickstarts for each?

## Deliverable
Update `packages/sdk/mcp-spec.md` in place so it is:
- **Comprehensive**: architecture, both tool catalogs, security model, phasing,
  data-serialization conventions, and a decisions log.
- **Opinionated & sequenced**: a clear "start local via npx, earn hosting later"
  recommendation, with rationale, reflecting my answers.
- **Actionable**: concrete first-milestone tool list + an example client-config
  snippet (e.g. `.mcp.json` for Claude Code) and an example tool-call flow.
- **Honest about unknowns**: keep/refresh an Open Questions section; don't paper
  over undecided items — surface them for me to resolve.

## Working rules
- Bigint fields serialize as decimal strings; tx outputs are unsigned envelopes,
  never free-form calldata — preserve these invariants.
- Reuse existing SDK helpers; the server depends on the SDK, never the reverse.
- Show me diffs / proposed sections before committing large rewrites, and keep
  editing iterative — propose, get my reaction, refine.
