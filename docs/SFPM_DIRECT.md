# Direct SFPM usage: LP positions and swaps

Any account can call the SemiFungiblePositionManager (SFPM) directly, without a
PanopticPool. The SDK supports this on **Uniswap v3** through two modules
exported from `@panoptic-eng/sdk/v2`:

- `sfpmLp`: hold Uniswap liquidity as an SFPM token ID.
- `sfpmSwap`: swap in a Uniswap v3 pool with an atomic mint + burn.

Uniswap v4 is not supported. See [V4 status](#v4-status).

## Setup

1. Resolve the SFPM poolId with `fetchSfpmV3PoolId`, or `ensureSfpmV3PoolInitialized`
   to also register the pool. Do not encode the poolId offline.
2. Approve the SFPM for both pool tokens with `approve`. The SFPM pulls tokens
   from the caller in the Uniswap callbacks.
3. A contract account must accept ERC-1155 tokens (`onERC1155Received`), because
   every mint issues the token ID to the caller.

## Direct LP

A direct-LP position is a token ID with one to four legs, each a
liquidity-adding range. Build it from ranges:

```ts
const tokenId = buildSfpmLpTokenId({
  poolId,
  ranges: [
    { tickLower: 199_900n, tickUpper: 200_100n, asset: 0n },
    { tickLower: 199_500n, tickUpper: 200_050n, asset: 1n },
  ],
})
```

`positionSize` counts contracts. For each range it is an amount of that range's
`asset` (token0 or token1), multiplied by `optionRatio`. One size applies to all
ranges of a token ID, so put ranges with different size scales in separate token IDs.

| Operation | Write | Action for `prepareSfpmLpCall` / `simulateSfpmLp` |
| --- | --- | --- |
| Create | `createSfpmLpPosition` | `{ kind: 'increase', positionSize }` |
| Increase | `increaseSfpmLpPosition` | `{ kind: 'increase', positionSize }` |
| Decrease | `decreaseSfpmLpPosition` | `{ kind: 'decrease', positionSize }` |
| Close | `closeSfpmLpPosition` | `{ kind: 'close' }` |
| Collect fees | `collectSfpmLpFees` | `{ kind: 'collect' }` |

- `prepareSfpmLpCall` returns `{ to, data }` for a Safe or another executor.
- `simulateSfpmLp` runs the call as `account` and returns the net token flows,
  the fees paid out, and the final tick.
- `getSfpmLpPosition` reads the balance, liquidity and pending fees.
- React: `useSfpmLpPosition`, `useSimulateSfpmLp`, and one mutation hook per write.

Every action is one `SFPM.multicall`, so it is atomic. `tickLimitLow` and
`tickLimitHigh` bound the pool tick after the action (open interval) and must be
in ascending order. The SDK rejects inverted limits, because the SFPM reads them
as a request to swap the position into one token.

### Fees

The SFPM tracks fees per **chunk**: (pool, account, token type, tick range).
It does not track them per token ID.

- **Chunk level (exact):** `legs[i].chunk.pendingFees0/1` is what the next touch
  of that chunk pays out. The read rounds down by dust.
- **Token-ID level (estimate):** `legs[i].attributedFees0/1` is the token ID's
  pro-rata share by liquidity. When two token IDs of one account share a chunk,
  the first one touched receives the fees of both.

**Collection flow.** A mint or burn that touches a chunk with existing liquidity
pays all of that chunk's pending fees to the caller. So increase, decrease and
close all collect. There is no fee-only call: the SFPM rejects zero-liquidity
operations. `collectSfpmLpFees` therefore mints and burns the smallest size that
holds liquidity, in one multicall. The caller needs that small amount of both
tokens and loses at most a few wei to rounding.

### Closing after several increases

Liquidity is rounded down on every mint. A position built from several
increases can hold slightly less liquidity than one burn of its full size
removes, and the SFPM reverts that burn (`NotEnoughLiquidityInChunk`). Decrease
and close split the burn so that no call over-draws a chunk. A remainder too
small to hold liquidity cannot be burned. It is reported as `unburnableSize`
on the prepared call, the simulation, and the result of `decreaseSfpmLpPosition`
and `closeSfpmLpPosition`. It is worth less than the minimum position size.

### Vegoid and shared accounting

A token ID includes the vegoid (inside the poolId). The SFPM's liquidity and
premium keys do not. An account that uses two vegoids on one Uniswap pool
therefore shares one set of chunk accounting between them, and each premium
update uses the vegoid of the position that triggered it.

This is a source-level concern, not a reproduced exploit. The direct-LP API
keeps clear of it in two ways:

- Legs only add liquidity. The vegoid only enters the premium formulas through
  removed (long) liquidity, which a direct-LP account never has.
- One `poolId` (one vegoid) per underlying pool per account. Pass the same
  `poolId` to every `buildSfpmLpTokenId` call for that pool.

The SDK cannot prevent other calls to the SFPM from the same account. Do not
mix direct-LP positions with long legs or a second vegoid on the same account.

## Direct swaps

```ts
const plan = buildSfpmSwapPlan({ sfpmAddress, poolAddress, poolId, kind, zeroForOne, amount, currentTick, slippageBps })
const quote = await quoteSfpmSwap({ client, plan, account })
const tx = await executeSfpmSwap({ client, walletClient, account, plan })
```

`executeSfpmSwap` sends the plan as one atomic `multicall([mint, burn])`. It
supports exact-input and exact-output in both directions. React:
`useQuoteSfpmSwap`, `useExecuteSfpmSwap`.

### Slippage protection

The only on-chain check is on the pool's **final tick**, which must lie inside
the plan's band. There is no `minAmountOut` or `maxAmountIn`.

- The band does bound the price: the average execution price is never worse
  than the price at the band edge, less the pool fee.
- It does not bound the amount exactly. If the pool moves before the
  transaction but stays inside the band, the fill can differ from the quote by
  up to the band width.
- An exact amount guarantee needs contract support: either a check in the SFPM
  or a wrapper contract that compares balances around the multicall. Until
  then, keep `slippageBps` tight and quote immediately before sending.

## V4 status

Not supported. The points below come from reading the contract source. None
has been exercised on a fork or a live network.

- **Settlement.** `SemiFungiblePositionManagerV4` settles in PoolManager
  ERC-6909 claims. It burns the caller's claims for tokens owed and mints
  claims for tokens and fees due. An ERC-20 approval to the SFPM has no effect.
- **Claim allowance.** The SFPM burns claims from the caller, so the caller
  must first call `PoolManager.setOperator(sfpm, true)` or
  `PoolManager.approve(sfpm, currencyId, amount)`.
- **Funding and redemption.** Claims are minted and burned only while the
  PoolManager is unlocked. Turning wallet tokens into claims (sync, transfer,
  settle, mint) and back (burn, take) needs a contract that implements
  `unlockCallback`. No such contract for end users was found in this repository.
- **Unlock composition.** The SFPM opens its own `PoolManager.unlock` for each
  mint or burn. A second unlock inside an open one reverts, so an adapter cannot
  fund claims and call the SFPM in one unlock. It can run them as consecutive
  unlocks in one transaction.
- **Position ownership.** The SFPM records liquidity and the ERC-1155 token
  against `msg.sender`. An adapter that calls the SFPM becomes the owner, so an
  atomic wallet-token flow needs an adapter that holds positions for its users.
  Without one, the user sends three steps: fund claims, call the SFPM, redeem claims.
- **Hooks.** The SFPM passes empty hook data to `modifyLiquidity` and `swap`.
  Pools whose hooks need hook data, or that change the caller's deltas on
  liquidity or swap calls, are likely incompatible.
- **LP and swap mechanics.** Mint, increase, decrease, close and the atomic
  mint + burn swap use the same token-ID logic as v3. Only settlement differs.

Open questions before SDK support: confirm the claim-allowance flow on a fork,
decide between a custodial adapter and the three-step flow, and list which
hook-enabled pools the SFPM accepts.

## Verification

- Unit tests: `pnpm --filter @panoptic-eng/sdk test`
- Fork test (v3 SFPM on a mainnet fork):
  `anvil --fork-url <mainnet RPC> --port 8546`, then
  `SFPM_FORK_RPC=http://127.0.0.1:8546 pnpm --filter @panoptic-eng/sdk test:fork sfpm-direct-lp`
