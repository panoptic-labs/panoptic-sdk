# Panoptic v2 SDK - LLM Implementation Prompts

These prompts guide an LLM through implementing the SDK. Copy/paste as needed.

**Important**: `spec.md` is the single source of truth for all requirements. These prompts define the *process*, not the *what*.

---

## Prompt 1: Checkpoint-Gated Phase Plan

```text
You are an expert TypeScript + viem SDK engineer. Implement the "@panoptic/sdk" (Panoptic v2 SDK) MVP exactly per the spec.md in this folder.

========================
EXECUTION ENVIRONMENT
========================
If you are running in an IDE Agent (Cursor, Windsurf, Claude Code) that can execute terminal commands:
- Run `tsc --noEmit` and `vitest run` directly and report actual output.

If you are running in a Chat Interface (ChatGPT, Claude web, etc.):
- Ask the user to run commands and paste the output back.
- Do NOT hallucinate "I ran the tests and they passed."

========================
SOURCES OF TRUTH
========================
- spec.md: SDK behavior, interfaces, API design, implementation constraints
- ../../contracts/*.sol: Protocol encoding details (bit layouts, struct packing, event signatures)
  - Located at SDK root: packages/sdk/contracts/
  - Synced from panoptic-next-core-private-post-vuln (fix/c4-fixes branch)
- Generated ABIs from wagmi (after running `pnpm codegen:wagmi` or `npx wagmi generate`)
  - Output: src/generated.ts

See spec.md §Implementation Constraints for all hard constraints (type system, caching, error handling, etc.).

========================
CHECKPOINT WORKFLOW
========================
MUST follow exactly. STOP after each phase for approval. Do not continue until approval.

At each STOP, output:
1. Checkpoint summary (what was implemented)
2. Invariants validated (which checks passed, how - tests/tsc)
3. Open questions / ambiguities
4. **Context Handoff Block** (see below)

CONTEXT HANDOFF BLOCK (required at every phase end):
LLMs lose context as conversation grows. At the end of every phase, output a concise block:
```
=== CONTEXT HANDOFF (Phase N -> Phase N+1) ===
Architecture: [key decisions made]
Modules completed: [list]
Next phase focus: [what Phase N+1 will implement]
Critical invariants to maintain: [list top 5 from spec.md §Implementation Constraints]
===
```
The user will paste this into a new chat session to continue Phase N+1 if needed.

========================
PHASE 0: Plan
========================
Deliverables checklist (print):
1) Repo layout (src/*, test/*, examples/*, package.json, tsconfig, build config)
2) Module map matching spec (what lives where)
3) Public API surface: index exports list (see spec.md §Type Exports)
4) Error taxonomy list (see spec.md §Error Handling)
5) Storage schema + key format (see spec.md §Storage Keys)
6) Multicall strategy (see spec.md §Implementation Constraints → Multicall & Block Consistency)
7) Event sync strategy (see spec.md §Position Tracking)
8) Write tx lifecycle (see spec.md §Transaction Lifecycle)
9) Minimal test plan (unit + fork)
10) "Definition of done" for MVP
11) Feature coverage matrix: every public function in spec.md §API Summary mapped to implementation module
12) RPC capability assumptions: maxBlockRange for getLogs, rate limits, archive node requirements

Contract reading authorization:
- You ARE authorized to read Solidity files in ../../contracts/ (packages/sdk/contracts/) to extract:
  - Bit layouts for custom types (TokenId, LeftRight, PositionBalance, OraclePack, etc.)
  - Event signatures and parameter ordering
  - Function signatures for ABI generation verification
- Contracts are synced from panoptic-next-core-private-post-vuln (fix/c4-fixes branch)
  - Run `pnpm sync-contracts` to update if needed
  - Check contracts/sync-metadata.json for current commit
- Extract these details directly from the source; do not guess.
- Reference: spec.md §Architecture → Contract Source Files

Then: STOP and ask for approval to proceed to Phase 1.

========================
PHASE 1: Skeleton + Test Harness
========================
Create the full project skeleton with empty implementations and correct types:
- Run `pnpm codegen:wagmi` (or `npx wagmi generate`) to create typed ABIs → src/generated.ts
  - Config: wagmi.config.ts at SDK root
  - Configured for VANILLA actions/types, NOT React hooks
  - Generates 6 ABIs: collateralTracker, panopticFactory, panopticHelper, panopticPool, riskEngine, semiFungiblePositionManager
- package.json scripts (build, test, lint, typecheck)
- tsconfig(s)
- build setup (tsup or equivalent) producing ESM + CJS + types
- src/ directory with all modules and placeholder exports
- **TEST HARNESS SETUP** (required now, not Phase 10):
  - vitest.config.ts configured
  - test/ directory structure
  - anvil fork test setup (scripts to spawn anvil, fork config)
  - Example test file that runs successfully (even if just `expect(true).toBe(true)`)
- Define types/interfaces exactly as spec.md
- Implement StorageAdapter with schema versioning (see spec.md §Storage Keys)
- Implement createFileStorage/createMemoryStorage stubs
- Implement jsonSerializer (BigInt tagging) fully (see spec.md §BigInt Serialization)
- Implement error base classes + all error class shells (see spec.md §Error Handling)
- Implement react/queryKeys + mutationEffects (see spec.md §React Integration)
- Implement deepFreeze utility for config immutability (see spec.md §Implementation Constraints → Config Immutability)

Then: STOP and ask for approval.

========================
PHASE 2: Core Infra
========================
Implement:
- createConfig() + updateConfig() with deep freeze (see spec.md §Configuration)
- Address resolution (bundled addresses + overrides)
- publicClient construction from Transport
- RPC retry wrapper per config.rpc settings (see spec.md §RPC Failure Model)
- Multicall3 helper with _meta fields (see spec.md §Implementation Constraints → Multicall & Block Consistency)
- Contract instance helpers for PanopticPool, SFPM, RiskEngine, CollateralTracker, PanopticHelper

Then: STOP and ask for approval.

========================
PHASE 3: Read APIs (Pool, Utilization, Oracle, SafeMode, RiskParams, Rates, Formatters)
========================
Implement:
- getPool(), getCurrentUtilization(), getOracleState(), getSafeMode(), getRiskParameters(), getCurrentRates()
- Formatters: tickToPrice, priceToTick, formatTokenAmount, parseTokenAmount, formatBps, formatUtilization, formatWad, getTokenListId (see spec.md §Formatters)
- healthStatus computation + _meta.isStale + assertFresh/assertHealthy/assertTradeable (see spec.md §Bot Execution Extras)

Then: STOP and ask for approval.

========================
PHASE 4: TokenId Utilities + Greeks (Client-Side)
========================
Implement:
- createTokenIdBuilder(pool) with strike validation (see spec.md §TokenId Creation)
- STANDARD_TICK_WIDTHS + Timescale
- decodeTokenId(tokenId) - extract bit layout from contracts/types/TokenId.sol
- isDefinedRisk(legs) (see spec.md §Defined Risk Detection)
- Client-side greek functions: getLegValue/getLegDelta/getLegGamma exactly per formulas in spec.md §Position Greeks

Then: STOP and ask for approval.

========================
PHASE 5: Position Tracking (syncPositions, cache, history, chunks)
========================
Implement:
- Storage keys exactly per spec.md §Storage Keys
- getTrackedPositionIds(), getSyncStatus(), clearCache()
- syncPositions() with:
  - Snapshot recovery via last dispatch() calldata decode (see spec.md §Why Snapshot Recovery Works)
  - Fallback to full event reconstruction
  - Chunked getLogs via maxLogsPerQuery (see spec.md §Log Query Chunking)
  - Resumable progress checkpoints in storage
  - Reorg handling via lastSyncedBlockHash (see spec.md §Reorg Handling)
  - ProviderLagError via minBlockNumber option (see spec.md §Provider Lag Handling)
  - Optimistic pending positions (see spec.md §Optimistic Updates)
- Trade history persistence on OptionBurnt (see spec.md §Trade History)
- Chunk tracking: addTrackedChunks/removeTrackedChunks/getChunkSpreads/scanChunks
  - 1000 chunk hard limit → ChunkLimitError (see spec.md §Implementation Constraints → Chunk Tracking Limits)
  - Compute spreadWad in WAD (see spec.md §Chunk Interface)

Then: STOP and ask for approval.

========================
PHASE 6: Positions + Account Reads (Multicall Composition)
========================
Implement:
- getPosition(), getPositions() (see spec.md §Position Interface)
- getAccountCollateral() (see spec.md §Account Collateral)
- getAccountSummaryBasic()/getAccountSummaryRisk() aggregates via ONE block target (see spec.md §Account Summary)
- Guest mode behavior (see spec.md §Guest Mode)
- Network mismatch handling (see spec.md §Network Mismatch Handling)

PanopticHelper-dependent functions (stub with TODO):
- getLiquidationPrices(), getNetLiquidationValue(), estimateCollateralRequired()
- getMaxPositionSize(), getPositionGreeks(), getAccountGreeks()

For these functions:
1. Implement the full interface and types as specified
2. Check if config.addresses.helper is defined
3. If undefined, throw PanopticHelperNotDeployedError
4. If defined, implement the actual call

Then: STOP and ask for approval.

========================
PHASE 7: Writes (Tx Model, Approvals, Broadcaster, Nonce Manager)
========================
Implement:
- TxBroadcaster interface + publicBroadcaster default (see spec.md §Private Transactions)
- createNonceManager() with fill-or-kill semantics (see spec.md §Nonce Management)
- Write functions returning {hash, wait} (see spec.md §Transaction Lifecycle):
  approve, deposit/withdraw/mint/redeem (+ *AndWait), openPosition/closePosition/settleAccumulatedPremia, forceExercise, liquidate, pokeOracle, dispatch
- Preflight checks:
  - Network mismatch throws on writes (see spec.md §Network Mismatch Handling)
  - Safe mode enforcement for openPosition (see spec.md §Safe Mode)
  - slippage/spreadLimit required enforcement (see spec.md §Slippage & Spread)
- Event decoding into TxReceipt.events
- Optimistic pending position injection on openPosition

Then: STOP and ask for approval.

========================
PHASE 8: Simulations
========================
Implement:
- SimulationResult union pattern (see spec.md §SimulationResult Pattern)
- simulateOpenPosition/Close/ForceExercise/Liquidate/Settle/Deposit/Withdraw/Dispatch
- Gas estimation via separate eth_estimateGas call (see spec.md §How Simulation Works)
- Return gas estimate + typed post-trade data per spec.md

Note: Simulations that require PanopticHelper follow same stub pattern as Phase 6.

Then: STOP and ask for approval.

========================
PHASE 9: Live Events
========================
Implement:
- watchEvents() simple WebSocket (see spec.md §Event Watching)
- createEventSubscription() with reconnect + gap fill (see spec.md §Resilient Subscriptions)
- createEventPoller() HTTP polling alternative (see spec.md §Event Polling)
- Chunk auto-refresh on OptionMinted/OptionBurnt (see spec.md §Live Updates via watchEvents)

Then: STOP and ask for approval.

========================
PHASE 10: Examples + Docs Polish
========================
Implement:
- Additional integration tests (happy paths should already exist from Module Loop)
- Anvil fork tests:
  - Greek formula verification: compare client-side getLegValue/getLegDelta/getLegGamma against contract computations
  - TokenId encoding/decoding round-trip against contract
- examples/: market maker loop, delta hedging bot, analytics dashboard (minimal)
- TSDoc on all public exports

Then: STOP and ask for approval.

========================
OUTPUT STYLE
========================
At each phase checkpoint, provide:
1. What you implemented (bulleted)
2. Key design choices + invariants
3. **Invariants checklist**: which invariants from spec.md §Implementation Constraints were validated and how
4. Open questions / ambiguities (only if real)
5. **Context Handoff Block** (for session continuity)
6. Exact next actions in the next phase

Then STOP for approval exactly as workflow requires.

Begin now with PHASE 0.
```

---

## Prompt 2: Module Implementation Loop

```text
Module Implementation Loop (mandatory for every module or small module-set)

Before you mark any module "complete", run this loop in order. Do not skip steps. If a step fails, fix it immediately and repeat the step until it passes.

========================
EXECUTION ENVIRONMENT
========================
If you are running in an IDE Agent (Cursor, Windsurf, Claude Code) that can execute terminal commands:
- Run `tsc --noEmit` and `vitest run` directly and report actual output.

If you are running in a Chat Interface:
- Output the commands to run.
- Ask the user to run them and paste the output back.
- Do NOT hallucinate test results.

========================
Step 1: Write
========================
- Implement the module per spec.md and current phase requirements.
- Include TSDoc for all public exports.
- Keep the module small and composable; prefer pure functions.
- Do not introduce new dependencies unless absolutely required.

========================
Step 2: Type
========================
- Run: `tsc --noEmit`
- Fix all type errors before proceeding.
- Per spec.md §Implementation Constraints: You MUST NOT use `any`, `unknown as`, `@ts-ignore`, or `// eslint-disable` to silence errors.
- If you encounter a complex generic type difficulty:
  - Do NOT resort to `any`.
  - STOP and ask for a type definition strategy, or split the type into smaller interfaces.

========================
Step 3: Test
========================
- Write unit tests (vitest) covering:
  - Happy path
  - Spec edge cases (e.g., ChunkLimitError at 1001 chunks)
  - Error throwing behavior and error class types
- Run: `vitest run <relevant test file(s)>`
- All tests must pass.

========================
Step 4: Verify Invariants
========================
Reject the module as "complete" if ANY box fails (reference spec.md §Implementation Constraints):
- [ ] No class inheritance in public API
- [ ] All numerics are bigint (except explicitly non-bigint: ticks, bps, chainId)
- [ ] No memoization of dynamic RPC data across calls (in-flight dedupe within single call is OK)
- [ ] Errors throw (not return), except SimulationResult which returns success:false on reverts
- [ ] Storage keys include schema version + chainId + poolAddress
- [ ] Formatters require explicit precision (no hidden defaults)
- [ ] Aggregate reads pin to same block via single multicall; timestamp/hash fetched via getBlock
- [ ] Config objects are deep-frozen (test mutation throws)
- [ ] Timestamp comparisons use _meta.blockTimestamp, not Date.now()
- [ ] No circular dependencies
- [ ] No `any` types
- [ ] No "God Files" (types co-located or in dedicated types/ files)

========================
Step 4b: Regression (required from Phase 3 onward)
========================
- Run full test suite: `vitest run`
- If any previously passing test fails, fix before proceeding.

========================
Step 5: Report (checkpoint output for this module)
========================
Output:
- Files created/modified
- Commands run + results (tsc/vitest) - actual output, not hallucinated
- Test count and status
- Invariants validated (checklist with pass/fail)
- Any TODOs (must be specific, minimal, and non-blocking if possible)
- Any spec ambiguities discovered (as explicit questions to resolve)

Only after Step 5 may you proceed to the next module.

========================
Usage
========================
Option A (embed): Include this loop inside the main prompt and state: "In every phase, implement modules using the Module Implementation Loop."

Option B (refresh): At the start of a phase or when context gets heavy, paste this loop again, then specify the next module(s) explicitly, e.g.:
"Continuing Phase 3. For each module, follow the Module Implementation Loop. Begin with src/storage/memory.ts."
```

---

## Prompt 3: Protocol Integrity Guardrail

```text
Protocol Integrity Guardrail (mandatory, always in effect)

AUTHORIZED SOURCES (you MAY extract details from these):
- spec.md: SDK behavior, interfaces, formulas, API design, implementation constraints
- ../../contracts/*.sol: Protocol encoding details (bit layouts, struct packing, event signatures)
  - Located at: packages/sdk/contracts/ (SDK root)
  - Synced from panoptic-next-core-private-post-vuln (fix/c4-fixes branch)
- ../../contracts/types/*.sol: Custom type definitions (TokenId, LeftRight, PositionBalance, OraclePack, etc.)
- ../../contracts/libraries/*.sol: Math libraries (PanopticMath, Math, FeesCalc)
- Generated ABIs from wagmi (after running `pnpm codegen:wagmi`)
  - Output: src/generated.ts

When extracting from contracts:
- Read the actual Solidity source to understand bit layouts
- Contracts location: packages/sdk/contracts/ (relative to SDK root: ../../contracts/)
- Check contracts/sync-metadata.json for current sync status
- Cross-reference spec.md line number references (e.g., "see contracts/PanopticPool.sol:434")
- Do not guess or infer - extract directly

You MUST NOT guess, infer, or "fill in" any of the following if NOT found in authorized sources:
- Protocol math not defined in spec.md or contracts
- Safe-mode thresholds or margin coefficients not in RiskEngine
- Any ABI function or event signature not in contracts or generated ABIs

If an implementation requires a detail and it is missing from ALL authorized sources, you MUST:

1. Hard-fail deterministically at runtime with a clearly named error, e.g.:
   - `MissingProtocolDetailError("liquidation bonus formula not found in spec or contracts")`
   - `UnsupportedProtocolDetailError("feature X requires PanopticHelper which is not deployed")`

2. Add a TODO comment that:
   - Names the exact missing element
   - Lists which sources were checked (spec.md, contracts/X.sol, etc.)
   - States what is required to complete it
   - Does NOT include guessed values

3. Surface the ambiguity at the next checkpoint under "Open questions / ambiguities".

4. Do NOT add config injection hooks or extension points unless spec.md explicitly defines them.
   - Adding `config.protocolMath.X` or similar violates API stability discipline.
   - The correct response to missing details is: fail fast + surface at checkpoint + wait for spec clarification.

PanopticHelper special case:
- PanopticHelper contract is planned but not yet deployed (see spec.md §Architecture)
- Functions depending on it should:
  - Implement full interface and types
  - Throw PanopticHelperNotDeployedError if config.addresses.helper is undefined
  - Work correctly when helper address IS provided (future-proofing)

You are NOT allowed to:
- Use placeholder constants that "seem reasonable"
- Copy layouts from memory or similar protocols
- Comment out logic to "make it compile"
- Implement partial logic that silently produces incorrect values

Failing loudly is correct behavior.

Success criteria:
- Any missing protocol detail causes an immediate, explicit, and explainable failure
- The SDK cannot return incorrect data silently
- All guessed logic is structurally impossible
- Protocol details extracted from contracts are verifiably correct

This guardrail overrides convenience, optimism, and completeness.
```

---

## Prompt 4: API Stability Discipline (Optional - Use After Phase 6)

```text
API Stability Discipline (use after Phase 6 when public surface is solidifying)

Before adding, removing, or renaming any public export:

1. Check if it's in spec.md §API Summary
   - If yes: implement exactly as specified
   - If no: surface at checkpoint for approval before adding

2. For any public type/interface change:
   - Document the change in checkpoint output
   - Explain why it deviates from spec (if it does)
   - Get explicit approval before proceeding

3. Forbidden without explicit approval:
   - Removing a public export that's in the spec
   - Renaming a public function/type
   - Changing function signatures (parameter order, required vs optional)
   - Adding new required config fields

4. Allowed without approval:
   - Adding optional parameters with sensible defaults
   - Adding new error types (extend PanopticError)
   - Internal refactoring that doesn't change public API

The spec's API Summary is the contract with users. Deviations require justification.
```

---

## Prompt 5: Context Refresh (For Long Sessions or New Chats)

```text
CONTEXT REFRESH - Paste this at the start of a new session or when context is heavy.

You are implementing the @panoptic/sdk (Panoptic v2 SDK). Here are the critical constraints from spec.md §Implementation Constraints:

HARD CONSTRAINTS (never violate):
1. Flat function API only - NO classes, NO inheritance in public API
2. All numerics are bigint (except ticks, bps, chainId which are number)
3. NO memoization of dynamic RPC data across calls (in-flight dedupe OK)
4. All errors throw (except SimulationResult returns success:false for reverts)
5. Config objects are deep-frozen and immutable
6. Storage keys: `panoptic-v2-sdk:v{SCHEMA}:chain{chainId}:pool{address}:{entity}:{id}`
7. Aggregate reads: ONE multicall + ONE getBlock for timestamp/hash
8. Timestamp checks use _meta.blockTimestamp, NEVER Date.now()
9. No `any` types - ask for help with complex generics instead

CURRENT STATE:
[Paste the Context Handoff Block from the previous phase here]

Continue with [Phase X / Module Y] following the Module Implementation Loop.
```
