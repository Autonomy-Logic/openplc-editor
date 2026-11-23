import { LADDER_STYLE } from '@root/middleware/shared/utils/ladder-layout/style'
import type { RungLayout } from '@root/middleware/shared/utils/ladder-layout/types'

import type { PrintRenderMode } from './types'

/** Lowest scale a whole LD POU is printed at in Normal mode before its rungs wrap. */
export const LD_MIN_POU_SCALE = 0.8

/** A continuation marker pill: its size and the gap to the wire it ends or starts, in px. */
export const LD_MARKER = { width: 22, height: 14, gap: 6 } as const

/** Width a marker takes at the end or start of a row, its gap included. */
const MARKER_SPACE = LD_MARKER.width + LD_MARKER.gap

/** One printed row of a rung: the segments it holds and the markers that join it to the rows around it. */
export interface LdPrintRow {
  segmentIndexes: readonly number[]
  startMarker?: string
  endMarker?: string
}

/** How one rung prints: its scale, its rows and its printed height in px (header at the POU scale, rows at its own). */
export interface LdPrintRung {
  rungId: string
  scale: number
  rows: readonly LdPrintRow[]
  heightPx: number
}

/** How an LD POU prints: the scale most rungs share and each rung's plan. */
export interface LdPrintPlan {
  pouScale: number
  rungs: readonly LdPrintRung[]
}

/** One rung to plan: its layout and the height of what is drawn above it (its comment), unscaled. */
export interface LdPlanInput {
  layout: RungLayout
  headerPx: number
}

/** The marker name of the `index`-th break of a rung: A to Z, then AA, AB and on. */
export function markerLetter(index: number): string {
  let rest = index
  let letters = ''
  do {
    letters = String.fromCharCode(65 + (rest % 26)) + letters
    rest = Math.floor(rest / 26) - 1
  } while (rest >= 0)
  return letters
}

/** Width a rung takes on paper at scale 1: gutter, its natural width and the space after the right rail. */
export const ldPrintedWidthPx = (layout: RungLayout): number =>
  LADDER_STYLE.gutter + layout.size.width + LADDER_STYLE.padR

/**
 * The canvas width of a row drawn at `scale` in a content box `contentWidthPx` wide, its gutter and right margin at
 * `pouScale`: where its right rail goes, so every rung's rails meet whatever its own scale.
 */
export const ldRowCanvasWidthPx = (contentWidthPx: number, scale: number, pouScale: number = scale): number =>
  (contentWidthPx - (LADDER_STYLE.gutter + LADDER_STYLE.padR) * pouScale) / scale

/** Width of segments `from` to `to` of a layout, both included. */
function spanWidth(layout: RungLayout, from: number, to: number): number {
  const first = layout.segments[from]
  const last = layout.segments[to]
  return last.x + last.width - first.x
}

/** The rows of a rung on a canvas `canvasPx` wide: whole segments, greedily, a marker at each break. */
function wrapRows(layout: RungLayout, canvasPx: number): LdPrintRow[] {
  const count = layout.segments.length
  if (count === 0 || layout.size.width <= canvasPx) return [{ segmentIndexes: layout.segments.map((_, i) => i) }]
  const rows: LdPrintRow[] = []
  let from = 0
  while (from < count) {
    const start = rows.length > 0 ? MARKER_SPACE : 0
    let to = from
    if (spanWidth(layout, from, count - 1) + start <= canvasPx) to = count - 1
    else {
      while (to + 1 < count - 1 && spanWidth(layout, from, to + 1) + start + MARKER_SPACE <= canvasPx) to++
    }
    const indexes = Array.from({ length: to - from + 1 }, (_, i) => from + i)
    const startMarker = rows.length > 0 ? markerLetter(rows.length - 1) : undefined
    const endMarker = to < count - 1 ? markerLetter(rows.length) : undefined
    rows.push({ segmentIndexes: indexes, ...(startMarker && { startMarker }), ...(endMarker && { endMarker }) })
    from = to + 1
  }
  return rows
}

/** The scale at which `widthPx` of canvas fits one row whose gutter and margin are at `pouScale`. */
const fitScale = (widthPx: number, contentWidthPx: number, pouScale: number): number =>
  ldRowCanvasWidthPx(contentWidthPx, 1, pouScale) / Math.max(1, widthPx)

/** The plan of one rung at `scale` or below: wrapped at that scale, scaled alone when a part or its height does not fit. */
function planRung(
  input: LdPlanInput,
  pouScale: number,
  wrap: boolean,
  contentWidthPx: number,
  contentHeightPx: number,
): LdPrintRung {
  const { layout, headerPx } = input
  let rungScale = pouScale
  const fitsWhole = layout.size.width <= ldRowCanvasWidthPx(contentWidthPx, rungScale, pouScale)
  if (!fitsWhole && (!wrap || layout.segments.length <= 1)) {
    rungScale = Math.min(rungScale, fitScale(layout.size.width, contentWidthPx, pouScale))
  } else if (!fitsWhole) {
    const widest = Math.max(0, ...layout.segments.map((segment) => segment.width))
    rungScale = Math.min(rungScale, fitScale(widest + 2 * MARKER_SPACE, contentWidthPx, pouScale))
  }
  const headerHeight = headerPx * pouScale
  let rows: LdPrintRow[] = []
  for (let attempt = 0; attempt < 3; attempt++) {
    rows = wrapRows(layout, wrap ? ldRowCanvasWidthPx(contentWidthPx, rungScale, pouScale) : Infinity)
    const rowsHeight = rows.length * layout.size.height
    if (headerHeight + rowsHeight * rungScale <= contentHeightPx || rowsHeight <= 0) break
    rungScale = Math.max(0.05, (contentHeightPx - headerHeight) / rowsHeight)
  }
  return {
    rungId: layout.rungId,
    scale: rungScale,
    rows,
    heightPx: headerHeight + rows.length * layout.size.height * rungScale,
  }
}

/**
 * How an LD POU prints in a content box (px). Normal: one scale for every rung, 1 when the widest rung fits, else down
 * to 0.8; a rung still too wide wraps between top-level segments onto lettered rows. Scale to fit: one scale fitting the
 * widest rung, no floor, no wrap. In both, a rung with a part too wide for a row, or taller than the page, is scaled
 * alone.
 */
export function planLadderPou(
  rungs: readonly LdPlanInput[],
  contentWidthPx: number,
  contentHeightPx: number,
  mode: PrintRenderMode,
): LdPrintPlan {
  const widest = Math.max(0, ...rungs.map((rung) => ldPrintedWidthPx(rung.layout)))
  const fit = widest <= 0 ? 1 : Math.min(1, contentWidthPx / widest)
  const pouScale = mode === 'scale-to-fit' ? fit : Math.max(LD_MIN_POU_SCALE, fit)
  const wrap = mode !== 'scale-to-fit'
  return {
    pouScale,
    rungs: rungs.map((rung) => planRung(rung, pouScale, wrap, contentWidthPx, contentHeightPx)),
  }
}
