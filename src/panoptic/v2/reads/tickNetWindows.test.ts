/**
 * Tests for stitched getTickNets windows.
 * @module v2/reads/tickNetWindows.test
 */

import { describe, expect, it, vi } from 'vitest'

import { readTickNetWindows, stitchTickNetWindows } from './tickNetWindows'

// A pool with liquidityNet +5 at every tick below 0 and −5 at every tick from 0 up, and 1000
// active at tick 0, read the way PanopticQuery does: a running sum from each window's first tick,
// rescaled only in the window holding the current tick (0).
const liquidityNet = (tick: number) => (tick < 0 ? 5n : -5n)
function trueActive(tick: number) {
  let active = 1000n
  for (let u = 10; u <= tick; u += 10) active += liquidityNet(u)
  for (let u = 0; u > tick; u -= 10) active -= liquidityNet(u)
  return active
}
function contractWindow(startTick: number, nTicks: number, spacing: number) {
  const center = Math.trunc(startTick / spacing) * spacing
  const ticks: bigint[] = []
  const nets: bigint[] = []
  let running = 0n
  for (let i = -nTicks; i <= nTicks; i++) {
    const tick = center + i * spacing
    running += liquidityNet(tick)
    ticks.push(BigInt(tick))
    nets.push(running)
  }
  const current = ticks.indexOf(0n)
  if (current >= 0) {
    const delta = trueActive(0) - nets[current]
    return { ticks, liquidityNets: nets.map((value) => value + delta) }
  }
  return { ticks, liquidityNets: nets }
}

describe('stitchTickNetWindows', () => {
  it('offsets each neighbour to agree on the shared edge tick', () => {
    const windows = [-40, 0, 40].map((center) => contractWindow(center, 2, 10))
    const { ticks, liquidityNets } = stitchTickNetWindows(windows, 1)
    expect(ticks).toEqual([-60, -50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50, 60].map(BigInt))
    expect(liquidityNets).toEqual(ticks.map((tick) => trueActive(Number(tick))))
  })

  it('stops at a window that does not share an edge', () => {
    const windows = [contractWindow(0, 2, 10), contractWindow(100, 2, 10)]
    expect(stitchTickNetWindows(windows, 0).ticks).toEqual([-20n, -10n, 0n, 10n, 20n])
  })
})

describe('readTickNetWindows', () => {
  it('reads edge-sharing windows around the start and stitches them', async () => {
    const read = vi.fn(async (center: number, nTicks: bigint) =>
      contractWindow(center, Number(nTicks), 10),
    )
    const result = await readTickNetWindows({
      startTick: 7,
      mainNTicks: 2n,
      nTicks: 2n,
      tickSpacing: 10,
      windowsPerSide: 2,
      read,
    })
    expect(read.mock.calls.map(([center]) => center)).toEqual([-80, -40, 7, 40, 80])
    expect(result.ticks[0]).toBe(-100n)
    expect(result.ticks.at(-1)).toBe(100n)
    expect(result.liquidityNets).toEqual(result.ticks.map((tick) => trueActive(Number(tick))))
  })

  it('skips side windows past the tick bounds', async () => {
    const read = vi.fn(async (center: number, nTicks: bigint) =>
      contractWindow(center, Number(nTicks), 10),
    )
    await readTickNetWindows({
      startTick: 887_000,
      mainNTicks: 20n,
      nTicks: 20n,
      tickSpacing: 10,
      windowsPerSide: 1,
      read,
    })
    expect(read.mock.calls.map(([center]) => center)).toEqual([886_600, 887_000])
  })
})
