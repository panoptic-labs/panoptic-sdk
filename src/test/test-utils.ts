/* eslint-disable no-console -- the console message are necessary to provide human-readable output to test runners */
import { exec, execSync, spawn } from 'node:child_process'

/**
 * Converts an object of options to an array of command line arguments.
 *
 * @param options The options object.
 * @returns The command line arguments.
 */
function toArgs(
  obj: {
    [key: string]:
      | Record<string, any>
      | string
      | readonly string[]
      | boolean
      | number
      | bigint
      | undefined
  },
  options: { casing: 'kebab' | 'snake' } = { casing: 'kebab' },
) {
  const { casing } = options
  return Object.entries(obj).flatMap(([key, value]) => {
    if (value === undefined) return []

    if (Array.isArray(value)) return [toFlagCase(key), value.join(',')]

    if (typeof value === 'object' && value !== null) {
      return Object.entries(value).flatMap(([subKey, subValue]) => {
        if (subValue === undefined) return []
        const flag = toFlagCase(`${key}.${subKey}`, casing === 'kebab' ? '-' : '_')
        return [flag, Array.isArray(subValue) ? subValue.join(',') : subValue]
      })
    }

    const flag = toFlagCase(key, casing === 'kebab' ? '-' : '_')

    if (value === false) return [flag, 'false']
    if (value === true) return [flag]

    const stringified = value.toString()
    if (stringified === '') return [flag]

    return [flag, stringified]
  })
}

/** Converts to a --flag-case string. */
function toFlagCase(str: string, separator = '-') {
  const keys = []
  for (let i = 0; i < str.split('.').length; i++) {
    const key = str.split('.')[i]
    if (!key) continue
    keys.push(
      key
        .replace(/\s+/g, separator)
        .replace(/([a-z])([A-Z])/g, `$1${separator}$2`)
        .toLowerCase(),
    )
  }
  return `--${keys.join('.')}`
}

// Relevant prior work:
// https://github.com/wevm/prool/blob/7016a5be99937715da8356e4cade6de03a8496e0/src/instances/anvil.ts#L5
// https://github.com/morpho-org/sdks/blob/main/packages/test/src/anvil.ts
export const spawnAnvil = (args?: AnvilArgs) => {
  return new Promise<void>((resolve, reject) => {
    const subprocess = spawn(
      'anvil',
      toArgs({
        // Use newly generated mnemonic to avoid drainers deployed on mainnet and delegated to by default anvil accounts (https://getfoundry.sh/anvil/overview/#eip-7702-and-default-accounts)
        ...args,
      }),
      // [
      //   `--fork-url`,
      //   `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
      //   `--chain-id`,
      //   `31337`,
      //   `-vvvvv`,
      //   `--no-cors`,
      //   `--fork-block-number`,
      //   `23146780`,
      // ]
    )

    subprocess.stdout.on('data', (data) => {
      process.stdout.write(data)
      if (data.toString().includes('Listening on')) {
        process.stdout.write(data)
        console.log(data.toString())
        resolve()
      }
    })

    subprocess.stderr.on('data', (data) => {
      process.stderr.write(data)
    })

    subprocess.on('exit', (code) => {
      if (code !== 0) {
        console.error(`Child process exited with code ${code}`)
        reject(new Error(`Anvil process exited with code ${code}`))
      }
    })

    subprocess.on('error', (err) => {
      console.error('Failed to start child process:', err)
      reject(err)
    })
  })
}

export const killAnvilProcess = async (port: number) => {
  try {
    const data = execSync(`lsof -iTCP:${port} -sTCP:LISTEN -t`)

    const pids = data.toString().split('\n').slice(0, -1)

    console.debug(`Clearing ports: ${pids.join(', ')}`)

    for (const pid of pids) {
      exec(`kill -9 ${pid}`, (error) => {
        if (error) console.error(`Error while killing ${pid}: ${error}`)
      })
    }
  } catch (e) {
    console.error('Cleanup error: ', (e as any).toString())
  }
}

export const killAllAnvilProcesses = async () => {
  try {
    const data = execSync('lsof -c anvil -t')

    const pids = data.toString().split('\n').slice(0, -1)

    console.debug(`Clearing ports: ${pids.join(', ')}`)

    for (const pid of pids) {
      exec(`kill -9 ${pid}`, (error) => {
        if (error) console.error(`Error while killing ${pid}: ${error}`)
      })
    }
  } catch (e) {
    console.error('Cleanup error: ', (e as any).toString())
  }
}

type AnvilArgs = {
  /**
   * Number of dev accounts to generate and configure.
   *
   * @defaultValue 10
   */
  accounts?: number | undefined
  /**
   * Set the Access-Control-Allow-Origin response header (CORS).
   *
   * @defaultValue *
   */
  allowOrigin?: string | undefined
  /**
   * Enable autoImpersonate on startup
   */
  autoImpersonate?: boolean | undefined
  /**
   * The balance of every dev account in Ether.
   *
   * @defaultValue 10000
   */
  balance?: number | bigint | undefined
  /**
   * The base fee in a block.
   */
  blockBaseFeePerGas?: number | bigint | undefined
  /**
   * Block time in seconds for interval mining.
   */
  blockTime?: number | undefined
  /**
   * Path or alias to the Anvil binary.
   */
  binary?: string | undefined
  /**
   * The chain id.
   */
  chainId?: number | undefined
  /**
   * EIP-170: Contract code size limit in bytes. Useful to increase this because of tests.
   *
   * @defaultValue 0x6000 (~25kb)
   */
  codeSizeLimit?: number | undefined
  /**
   * Sets the number of assumed available compute units per second for this fork provider.
   *
   * @defaultValue 350
   * @see https://github.com/alchemyplatform/alchemy-docs/blob/master/documentation/compute-units.md#rate-limits-cups
   */
  computeUnitsPerSecond?: number | undefined
  /**
   * Writes output of `anvil` as json to user-specified file.
   */
  configOut?: string | undefined
  /**
   * Sets the derivation path of the child key to be derived.
   *
   * @defaultValue m/44'/60'/0'/0/
   */
  derivationPath?: string | undefined
  /**
   * Disable the `call.gas_limit <= block.gas_limit` constraint.
   */
  disableBlockGasLimit?: boolean | undefined
  /**
   * Dump the state of chain on exit to the given file. If the value is a directory, the state will be
   * written to `<VALUE>/state.json`.
   */
  dumpState?: string | undefined
  /**
   * Fetch state over a remote endpoint instead of starting from an empty state.
   *
   * If you want to fetch state from a specific block number, add a block number like `http://localhost:8545@1400000`
   * or use the `forkBlockNumber` option.
   */
  forkUrl?: string | undefined
  /**
   * Fetch state from a specific block number over a remote endpoint.
   *
   * Requires `forkUrl` to be set.
   */
  forkBlockNumber?: number | bigint | undefined
  /**
   * Specify chain id to skip fetching it from remote endpoint. This enables offline-start mode.
   *
   * You still must pass both `forkUrl` and `forkBlockNumber`, and already have your required state cached
   * on disk, anything missing locally would be fetched from the remote.
   */
  forkChainId?: number | undefined
  /**
   * Specify headers to send along with any request to the remote JSON-RPC server in forking mode.
   *
   * e.g. "User-Agent: test-agent"
   *
   * Requires `forkUrl` to be set.
   */
  forkHeader?: Record<string, string> | undefined
  /**
   * Initial retry backoff on encountering errors.
   */
  forkRetryBackoff?: number | undefined
  /**
   * The block gas limit.
   */
  gasLimit?: number | bigint | undefined
  /**
   * The gas price.
   */
  gasPrice?: number | bigint | undefined
  /**
   * The EVM hardfork to use.
   */
  hardfork?:
    | 'Frontier'
    | 'Homestead'
    | 'Dao'
    | 'Tangerine'
    | 'SpuriousDragon'
    | 'Byzantium'
    | 'Constantinople'
    | 'Petersburg'
    | 'Istanbul'
    | 'Muirglacier'
    | 'Berlin'
    | 'London'
    | 'ArrowGlacier'
    | 'GrayGlacier'
    | 'Paris'
    | 'Shanghai'
    | 'Cancun'
    | 'Prague'
    | 'Latest'
    | undefined
  /**
   * The host the server will listen on.
   */
  host?: string | undefined
  /**
   * Initialize the genesis block with the given `genesis.json` file.
   */
  init?: string | undefined
  /**
   * Launch an ipc server at the given path or default path = `/tmp/anvil.ipc`.
   */
  ipc?: string | undefined
  /**
   * Initialize the chain from a previously saved state snapshot.
   */
  loadState?: string | undefined
  /**
   * BIP39 mnemonic phrase used for generating accounts.
   */
  mnemonic?: string | undefined
  /**
   * Automatically generates a BIP39 mnemonic phrase, and derives accounts from it.
   */
  mnemonicRandom?: boolean | undefined
  /**
   * Disable CORS.
   */
  noCors?: boolean | undefined
  /**
   * Disable auto and interval mining, and mine on demand instead.
   */
  noMining?: boolean | undefined
  /**
   * Disables rate limiting for this node's provider.
   *
   * @defaultValue false
   * @see https://github.com/alchemyplatform/alchemy-docs/blob/master/documentation/compute-units.md#rate-limits-cups
   */
  noRateLimit?: boolean | undefined
  /**
   * Explicitly disables the use of RPC caching.
   *
   * All storage slots are read entirely from the endpoint.
   */
  noStorageCaching?: boolean | undefined
  /**
   * How transactions are sorted in the mempool.
   *
   * @defaultValue fees
   */
  order?: string | undefined
  /**
   * Run an Optimism chain.
   */
  optimism?: boolean | undefined
  /**
   * Port number to listen on.
   *
   * @defaultValue 8545
   */
  port?: number | undefined
  /**
   * Don't keep full chain history. If a number argument is specified, at most this number of states is kept in memory.
   */
  pruneHistory?: number | undefined | boolean
  /**
   * Number of retry requests for spurious networks (timed out requests).
   *
   * @defaultValue 5
   */
  retries?: number | undefined
  /**
   * Don't print anything on startup and don't print logs.
   */
  silent?: boolean | undefined
  /**
   * Slots in an epoch.
   */
  slotsInAnEpoch?: number | undefined
  /**
   * Enable steps tracing used for debug calls returning geth-style traces.
   */
  stepsTracing?: boolean | undefined
  /**
   * Interval in seconds at which the status is to be dumped to disk.
   */
  stateInterval?: number | undefined
  /**
   * This is an alias for both `loadState` and `dumpState`. It initializes the chain with the state stored at the
   * file, if it exists, and dumps the chain's state on exit
   */
  state?: string | undefined
  /**
   * Timeout in ms for requests sent to remote JSON-RPC server in forking mode.
   *
   * @defaultValue 45000
   */
  timeout?: number | undefined
  /**
   * The timestamp of the genesis block.
   */
  timestamp?: number | bigint | undefined
  /**
   * Number of blocks with transactions to keep in memory.
   */
  transactionBlockKeeper?: number | undefined
}
