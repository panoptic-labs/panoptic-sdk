import { GraphQLClient } from 'graphql-request'
import { z } from 'zod'

const unsigned = z.string().regex(/^\d+$/).transform(BigInt)
const eventFields = {
  id: z.string().min(1),
  hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  blockNumber: unsigned,
  logIndex: unsigned,
  timestamp: unsigned,
  amount0: unsigned,
  amount1: unsigned,
}
const changeSchema = z.object({
  ...eventFields,
  eventType: z.enum(['Mint', 'Burn']),
  liquidity: unsigned,
  amountSource: z.string().nullable(),
})
const collectSchema = z.object({
  ...eventFields,
  recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
})
const pageSchema = z.object({
  _meta: z.object({
    block: z.object({
      number: z.number().int().nonnegative(),
      hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    }),
    hasIndexingErrors: z.boolean(),
  }),
  uniswapLpPosition: z
    .object({
      version: z.union([z.literal(3), z.literal(4)]),
      liquidity: unsigned,
      liquidityChanges: z.array(changeSchema),
      collects: z.array(collectSchema),
    })
    .nullable(),
})

const HISTORY_QUERY = `
  query LpPositionActivity($positionId: ID!, $block: Block_height, $changeCursor: ID!, $collectCursor: ID!, $pageSize: Int!) {
    _meta(block: $block) { block { number hash } hasIndexingErrors }
    uniswapLpPosition(id: $positionId, block: $block) {
      version
      liquidity
      liquidityChanges(first: $pageSize, where: { id_gt: $changeCursor }, orderBy: id, orderDirection: asc) {
        id hash eventType liquidity amount0 amount1 amountSource blockNumber logIndex timestamp
      }
      collects(first: $pageSize, where: { id_gt: $collectCursor }, orderBy: id, orderDirection: asc) {
        id hash amount0 amount1 blockNumber logIndex timestamp recipient
      }
    }
  }
`

export type LpPositionHistoryEvent =
  | z.infer<typeof changeSchema>
  | (z.infer<typeof collectSchema> & {
      eventType: 'Collect'
      amountSource: 'ExactEvent'
    })

/** Complete NFT activity at one indexed block, sorted by block and log index. */
export async function getLpPositionHistory({
  url,
  positionId,
  signal,
}: {
  url: string
  positionId: string
  signal?: AbortSignal
}) {
  if (!/^v[34]-\d+$/.test(positionId)) throw new RangeError('Invalid LP position id')
  const client = new GraphQLClient(url, { signal })
  const events: LpPositionHistoryEvent[] = []
  let block: { hash: string } | null = null
  let changeCursor = ''
  let collectCursor = ''
  while (true) {
    const page = pageSchema.parse(
      await client.request(HISTORY_QUERY, {
        positionId,
        block,
        changeCursor,
        collectCursor,
        pageSize: 1000,
      }),
    )
    if (page._meta.hasIndexingErrors) throw new Error('LP history indexing is incomplete')
    const position = page.uniswapLpPosition
    if (!position) throw new Error('LP position history is unavailable')
    if (position.version !== Number(positionId[1])) throw new Error('LP position version mismatch')
    if (block && block.hash !== page._meta.block.hash)
      throw new Error('LP history checkpoint changed')
    block = { hash: page._meta.block.hash }
    const changes = position.liquidityChanges
    const collects = position.collects
    events.push(
      ...changes,
      ...collects.map((event) => ({
        ...event,
        eventType: 'Collect' as const,
        amountSource: 'ExactEvent' as const,
      })),
    )
    const lastChange = changes.at(-1)
    const lastCollect = collects.at(-1)
    if (
      (lastChange && lastChange.id <= changeCursor) ||
      (lastCollect && lastCollect.id <= collectCursor)
    ) {
      throw new Error('LP history pagination did not advance')
    }
    changeCursor = lastChange?.id ?? changeCursor
    collectCursor = lastCollect?.id ?? collectCursor
    if (changes.length < 1000 && collects.length < 1000) {
      events.sort((a, b) => {
        const order = a.blockNumber - b.blockNumber || a.logIndex - b.logIndex
        return order < 0n ? -1 : order > 0n ? 1 : 0
      })
      let held = 0n
      for (const event of events) {
        if (event.eventType === 'Collect') continue
        held += event.eventType === 'Burn' ? -event.liquidity : event.liquidity
        if (held < 0n) throw new Error('LP liquidity history is incomplete')
      }
      if (held !== position.liquidity || events.length === 0)
        throw new Error('LP liquidity history is incomplete')
      return {
        events,
        positionId,
        blockHash: page._meta.block.hash,
        blockNumber: BigInt(page._meta.block.number),
        version: position.version,
      }
    }
  }
}

/** Token flows; v3 collects may include principal already recorded in removals. */
export function summarizeLpPositionHistory(events: readonly LpPositionHistoryEvent[]) {
  const totals = (eventType: LpPositionHistoryEvent['eventType']) => {
    let amount0 = 0n
    let amount1 = 0n
    let estimated = false
    for (const event of events) {
      if (event.eventType !== eventType) continue
      if (event.amountSource !== 'ExactEvent' && event.amountSource !== 'ExactSameTxSwap') {
        if (event.amountSource !== 'ApproxExtsload')
          return { amount0: null, amount1: null, estimated: false }
        estimated = true
      }
      amount0 += event.amount0
      amount1 += event.amount1
    }
    return { amount0, amount1, estimated }
  }
  return { added: totals('Mint'), removed: totals('Burn'), collected: totals('Collect') }
}
