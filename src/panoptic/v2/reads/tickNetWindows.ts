/**
 * Wide liquidity distributions from several adjacent `getTickNets*` windows.
 *
 * @module v2/reads/tickNetWindows
 */

/** Absolute Uniswap V3/V4 tick bounds. */
const TICK_MIN = -887272
const TICK_MAX = 887272

/** One `getTickNets*` result: ascending ticks with the running liquidity at each. */
export interface TickNetWindow {
  ticks: readonly bigint[]
  liquidityNets: readonly bigint[]
}

/**
 * Join ascending, edge-sharing windows into one distribution anchored to `windows[mainIndex]`.
 *
 * Each `getTickNets*` window is a running sum of liquidityNet from its own first tick (only the
 * window holding the current tick is rescaled to the pool's liquidity), so a neighbour's values
 * are off by a constant. Adjacent windows share their edge tick; the offset that makes that tick
 * agree is applied to the whole neighbour. Stitching stops at the first window that does not share
 * an edge with the one before it.
 */
export function stitchTickNetWindows(
  windows: readonly TickNetWindow[],
  mainIndex: number,
): { ticks: bigint[]; liquidityNets: bigint[] } {
  const main = windows[mainIndex]
  if (!main) return { ticks: [], liquidityNets: [] }
  const ticks = [...main.ticks]
  const nets = [...main.liquidityNets]

  for (let i = mainIndex + 1; i < windows.length; i++) {
    const window = windows[i]
    const edge = ticks.length - 1
    if (!window.ticks.length || window.ticks[0] !== ticks[edge]) break
    const offset = nets[edge] - window.liquidityNets[0]
    ticks.push(...window.ticks.slice(1))
    nets.push(...window.liquidityNets.slice(1).map((value) => value + offset))
  }
  for (let i = mainIndex - 1; i >= 0; i--) {
    const window = windows[i]
    const last = window.ticks.length - 1
    if (last < 0 || window.ticks[last] !== ticks[0]) break
    const offset = nets[0] - window.liquidityNets[last]
    ticks.unshift(...window.ticks.slice(0, last))
    nets.unshift(...window.liquidityNets.slice(0, last).map((value) => value + offset))
  }
  return { ticks, liquidityNets: nets }
}

/**
 * Read the main window around `startTick` plus up to `windowsPerSide` windows of `nTicks` on each
 * side, in parallel, and stitch them. Side windows that would cross the tick bounds are skipped.
 */
export async function readTickNetWindows({
  startTick,
  mainNTicks,
  nTicks,
  tickSpacing,
  windowsPerSide,
  read,
}: {
  startTick: number
  /** Half-width of the main window (possibly clamped by the caller). */
  mainNTicks: bigint
  /** Half-width of each side window. */
  nTicks: bigint
  tickSpacing: number
  windowsPerSide: number
  read: (centerTick: number, nTicks: bigint) => Promise<TickNetWindow>
}): Promise<{ ticks: bigint[]; liquidityNets: bigint[] }> {
  // PanopticQuery centers each window on trunc(startTick / tickSpacing) · tickSpacing.
  const center = Math.trunc(startTick / tickSpacing) * tickSpacing
  const half = Number(nTicks) * tickSpacing
  const mainHalf = Number(mainNTicks) * tickSpacing
  const sideCenters = (direction: 1 | -1) =>
    Array.from(
      { length: windowsPerSide },
      (_, k) => center + direction * (mainHalf + half + 2 * half * k),
    ).filter((side) => side - half >= TICK_MIN && side + half <= TICK_MAX)
  const below = sideCenters(-1).reverse()
  const above = sideCenters(1)
  const windows = await Promise.all([
    ...below.map((side) => read(side, nTicks)),
    read(startTick, mainNTicks),
    ...above.map((side) => read(side, nTicks)),
  ])
  return stitchTickNetWindows(windows, below.length)
}
