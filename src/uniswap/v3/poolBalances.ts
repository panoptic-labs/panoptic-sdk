import { type Address, type PublicClient, erc20Abi } from 'viem'

/** V3 pools custody their own tokens; balances include principal and uncollected fees. */
export async function getUniswapV3PoolBalances({
  client,
  pools,
}: {
  client: PublicClient
  pools: readonly { id: Address; token0: Address; token1: Address }[]
}) {
  const amounts = new Map<string, { amount0: bigint; amount1: bigint }>()
  if (pools.length === 0) return amounts
  const blockNumber = await client.getBlockNumber()
  const balances = await client.multicall({
    blockNumber,
    allowFailure: true,
    contracts: pools.flatMap((pool) =>
      [pool.token0, pool.token1].map((address) => ({
        address,
        abi: erc20Abi,
        functionName: 'balanceOf' as const,
        args: [pool.id] as const,
      })),
    ),
  })
  pools.forEach((pool, index) => {
    const token0 = balances[index * 2]
    const token1 = balances[index * 2 + 1]
    if (token0?.status === 'success' && token1?.status === 'success') {
      amounts.set(pool.id.toLowerCase(), { amount0: token0.result, amount1: token1.result })
    }
  })
  return amounts
}
