import type { Address, PublicClient } from 'viem'

import { panopticPoolV2Abi, riskEngineAbi } from '../../../generated'
import { decodeTokenId } from '../tokenId'
import { getPoolMetadata } from './pool'
import { riskEngineMulticall } from './riskEngineDeployment'

export async function getAccountLegCapacity({
  client,
  poolAddress,
  account,
  positionIds,
  blockNumber,
}: {
  client: PublicClient
  poolAddress: Address
  account: Address
  positionIds: readonly bigint[]
  blockNumber: bigint
}) {
  if (new Set(positionIds).size !== positionIds.length) {
    throw new Error('Leg capacity requires distinct open positions')
  }
  const metadata = await getPoolMetadata({ client, poolAddress })
  const [maximumLegs, currentLegs, full] = await riskEngineMulticall(client, {
    contracts: [
      { address: metadata.riskEngineAddress, abi: riskEngineAbi, functionName: 'MAX_OPEN_LEGS' },
      {
        address: poolAddress,
        abi: panopticPoolV2Abi,
        functionName: 'numberOfLegs',
        args: [account],
      },
      {
        address: poolAddress,
        abi: panopticPoolV2Abi,
        functionName: 'getFullPositionsData',
        args: [account, false, positionIds],
      },
    ],
    allowFailure: false,
    blockNumber,
  })
  const decodedLegs = positionIds.reduce(
    (sum, id) => sum + BigInt(decodeTokenId(id).legs.length),
    0n,
  )
  if (
    decodedLegs !== currentLegs ||
    full[2].length !== positionIds.length ||
    full[2].some((balance) => (balance & ((1n << 128n) - 1n)) === 0n)
  ) {
    throw new Error('Account leg snapshot does not match the complete open position list')
  }
  return {
    maximumLegs: BigInt(maximumLegs),
    currentLegs: BigInt(currentLegs),
    positionIds,
    blockNumber,
  }
}

/** Validate peak active legs in dispatch order, including existing-position resizes. */
export function fitsAccountLegCapacity({
  capacity,
  tokenIds,
  positionSizes,
}: {
  capacity: Pick<
    Awaited<ReturnType<typeof getAccountLegCapacity>>,
    'maximumLegs' | 'currentLegs' | 'positionIds'
  >
  tokenIds: readonly bigint[]
  positionSizes: readonly bigint[]
}) {
  if (tokenIds.length !== positionSizes.length) return false
  const active = new Set(capacity.positionIds)
  let count = capacity.currentLegs
  if (count > capacity.maximumLegs) return false
  for (let i = 0; i < tokenIds.length; i += 1) {
    const id = tokenIds[i]
    const size = positionSizes[i]
    if (id === undefined || size === undefined || size < 0n) return false
    const legs = BigInt(decodeTokenId(id).legs.length)
    if (legs === 0n) return false
    if (size === 0n && active.delete(id)) count -= legs
    if (size > 0n && !active.has(id)) {
      active.add(id)
      count += legs
    }
    if (count > capacity.maximumLegs) return false
  }
  return true
}
