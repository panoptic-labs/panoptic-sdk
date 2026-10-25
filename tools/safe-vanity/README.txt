Safe vanity miner and Ethereum deployment records

Start here

  pnpm --dir packages/sdk/tools/safe-vanity records
  pnpm --dir packages/sdk/tools/safe-vanity records:check

The registry at records/ethereum-mainnet/deployments.json is the authoritative
index of the five final Safes: addresses, mining nonces, source checkpoints,
deployment transactions, blocks, and the latest on-chain verification snapshot.
A verification snapshot describes state at its recorded block, not perpetual
ownership. Re-run the read-only verifier before relying on current settings.

Layout

  records/ethereum-mainnet/deployments.json   Final Safe deployment registry
  records/ethereum-mainnet/configs/          Frozen production mining configs
  records/ethereum-mainnet/checkpoints/      Original final Vast checkpoint files
  records/file-moves.json                    Original paths and SHA-256 checksums
  archive/seven-digit/                       Earlier seven-digit config/results
  archive/local-config.json                 Preserved former working config
  config.example.json                       Placeholder-owner development config
  cli.mjs, src/main.rs, cuda.cu              Reference, CPU and CUDA miners
  records.mjs                               Offline and read-only on-chain checks
  proxy*.json                               Pinned official Safe creation bytecode
  VAST.txt, pack-vast.mjs, standalone-lock.yaml  Reproducible remote bundle
  target/                                   Ignored binaries and generated bundle

The archived seven-digit addresses are not the final deployment list. Original
checkpoints/configs are immutable evidence: do not resume mining into these files.
Copy a config and use a new ignored checkpoint filename for a new search. All
recorded configuration, calldata and addresses are public; no signing keys,
provider credentials, generated binaries or editor swap files belong in git.

Verification and updates

Offline check (also part of pnpm test) recomputes every address and deployment
transaction, checks registry consistency, and verifies original file hashes:

  pnpm --dir packages/sdk/tools/safe-vanity records:check

To refresh on-chain evidence, configure RPC_URL_1 or a supported provider through
@panoptic-eng/sdk/rpc (see docs/rpc.md). The command accepts an optional absolute
env-file path and never signs or broadcasts:

  SAFE_VANITY_ENV_FILE=/absolute/path/to/rpc.env pnpm --dir packages/sdk/tools/safe-vanity records:onchain

For initially recording another set, supply the deployment transaction hashes as
arguments to records:onchain after adding its verified run and registry entries.
The verifier matches transactions by decoded saltNonce, checks successful receipts,
factory events, exact calldata, sender, zero ETH value, and the factory's creation
bytecode. At a single mainnet block it reads owners, threshold, Safe version,
singleton, and fallback handler. All checks must pass before the registry is saved.
Review the registry diff and commit refreshed snapshots intentionally. An on-chain
check does not audit modules, guards, balances or subsequent wallet activity.

Each final run can also be checked separately:

  pnpm --dir packages/sdk/tools/safe-vanity verify records/ethereum-mainnet/checkpoints/vanity.json records/ethereum-mainnet/configs/vanity.json
  pnpm --dir packages/sdk/tools/safe-vanity verify records/ethereum-mainnet/checkpoints/defi.json records/ethereum-mainnet/configs/defi.json

Development and mining

Run from the monorepo root with its existing pnpm dependencies installed:

  pnpm --dir packages/sdk/tools/safe-vanity build
  pnpm --dir packages/sdk/tools/safe-vanity test
  pnpm --dir packages/sdk/tools/safe-vanity bench
  pnpm --dir packages/sdk/tools/safe-vanity mine

The last command searches the four requested seven-digit prefixes with EXPLICIT
PLACEHOLDER OWNERS. These addresses are development artifacts. Do not fund them.
No keys, RPC access, or transactions are used. CUDA/Vast.ai instructions are in VAST.txt. The Apple GPU is not used.
The CUDA kernel has host validation; actual NVIDIA validation is still required.

Configuration and production

Copy config.example.json to config.json inside this directory. Before production
mining, confirm the final owners (including order), threshold, Safe version and
chain with the requesting user. Set development=false only for finalized inputs.
After that confirmation, the command is:

  pnpm --dir packages/sdk/tools/safe-vanity mine config.json checkpoint-production.json --production

Paths are relative to this tool directory (absolute paths also work). Safe versions
1.4.1 and 1.5.0 select their corresponding pinned official proxy artifacts. Other
versions require a matching official proxy artifact and fresh validation. Factory/singleton overrides are possible but
must be verified on the target network before deployment. Standard EVM CREATE2
only: this implementation does not cover zkSync's different deployment mechanism.
All setup fields are exposed. The example uses no setup delegatecall or payment.
Do not add arbitrary setup delegatecalls without reviewing what they execute.

Resume by repeating the identical command. Checkpoints contain configuration,
initializer, proxy creation bytecode, next nonce, and one result per target with
nonce, predicted address and unsigned createProxyWithNonce transaction calldata.
Configuration changes require a new checkpoint. Ctrl-C safely stops at a batch
boundary; a forcibly killed incomplete batch is replayed. If SIGKILL leaves a
.lockfile, remove it only after confirming that its process is no longer running.
Never share a checkpoint between simultaneous processes. Disjoint start/count
ranges and separate checkpoint filenames support independent mining jobs.
The Rust worker searches uint64 nonces, ABI-encoded as uint256; the JS predictor
uses bigint. This range is ample for these prefixes. Counts/nonces are strings in
JSON to avoid rounding. Mining stops after one hour by default (SAFE_VANITY_MAX_SECONDS overrides this).
Eight CPU threads default to the M2 Max performance cores.

Correctness

Official source reviewed:
https://github.com/safe-global/safe-smart-account/blob/v1.4.1/contracts/proxies/SafeProxyFactory.sol

  initializerHash = keccak256(initializer)
  initCodeHash = keccak256(proxyCreationCode || leftPad32(singleton))
  salt = keccak256(initializerHash || uint256_be(saltNonce))
  address = last20(keccak256(0xff || factory || salt || initCodeHash))

The initializer encodes setup(owners,threshold,to,data,fallbackHandler,paymentToken,
payment,paymentReceiver). Every byte, including owner order, matters. Chain ID is
metadata for createProxyWithNonce, not part of this formula. The distinct
createChainSpecificProxyWithNonce entry point includes chain ID and is unsupported.
Version labels also do not enter the hash; the actual addresses and bytecode do.

proxy.json and proxy-1.5.0.json contain unmodified creation bytecode from the
official @safe-global/safe-contracts@1.4.1 and
@safe-global/safe-smart-account@1.5.0 npm artifacts named in their source fields. Tests
check the Ethereum Keccak empty-string vector, EIP-1014 example 0, independent
Rust/viem address agreement across nonce boundaries including 2^63, and chain ID
independence. A short-prefix smoke run also verified four matches and resumption.
The mining self-tests are source/artifact validation. records:onchain separately
checks deployed mainnet contracts; it does not perform a fork deployment.
No Solidity tests were run.

Before deploying real results

1. Resolve the selected chain's RPC through @panoptic-eng/sdk/rpc. Verify its chain
   ID and the deployed factory/singleton code against official Safe deployments.
2. Read factory.proxyCreationCode() and compare byte-for-byte with the selected version's proxy artifact.
3. Simulate the saved transaction using eth_call/createProxyWithNonce and confirm
   the returned address equals the prediction. It must succeed with these exact
   initializer bytes. Check that the address is not already deployed.
4. Deploy on a fork and read getOwners(), getThreshold(), VERSION(), and the proxy
   masterCopy() value. Verify the owners, threshold and singleton, plus any custom
   setup configuration. records:onchain checks the deployed state after broadcast.
5. After those checks, review each saved unsigned transaction on your trusted
   signing machine and submit to the correct chain. No mainnet broadcast is
   automatic. Verify the same state after inclusion before funding the Safes.

Performance

The hot loop performs two Keccak-256 hashes per candidate with invariant inputs
precomputed, fixed-size stack buffers, and no per-candidate allocation. All four
prefixes share each candidate computation. Matches are independently recomputed
by viem before persistence. Progress reports candidates/s per batch.
The benchmark measures 100 million attempts, including worker startup. With rate R,
each seven-digit prefix has expected time 16^7/R. All four disjoint seven-digit
prefixes have expected time (1 + 1/2 + 1/3 + 1/4)*16^7/R; a roughly 95% completion
budget is 4.363*16^7/R. These are statistical estimates, not guaranteed runtimes.
