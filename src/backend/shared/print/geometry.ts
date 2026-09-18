import type { DrawOp, PageMarginsPt, PaperSize, PrintPageSetup } from './types'

// ---------------------------------------------------------------------------
// Unit conversion — the flow canvas is laid out in CSS pixels (96 px/in),
// PDF space is points (72 pt/in).
// ---------------------------------------------------------------------------

export const PX_TO_PT = 72 / 96

export function pxToPt(px: number): number {
  return px * PX_TO_PT
}

// ---------------------------------------------------------------------------
// Font metrics — measured directly from the embedded Noto Sans / Noto Sans
// Mono files (both share identical vertical metrics; Mono's advance width is
// a true monospace 0.6em, same as the classic Courier metric the layout math
// below is modelled on).
// ---------------------------------------------------------------------------

export const FONT_ASCENT_RATIO = 1.069
export const FONT_DESCENT_RATIO = 0.293
export const MONO_ADVANCE_WIDTH_RATIO = 0.6

export function textAscentPt(sizePt: number): number {
  return sizePt * FONT_ASCENT_RATIO
}

export function textDescentPt(sizePt: number): number {
  return sizePt * FONT_DESCENT_RATIO
}

export function lineHeightPt(sizePt: number): number {
  return textAscentPt(sizePt) + textDescentPt(sizePt)
}

export function monoCharWidthPt(sizePt: number): number {
  return sizePt * MONO_ADVANCE_WIDTH_RATIO
}

// ---------------------------------------------------------------------------
// Page box
// ---------------------------------------------------------------------------

const PAPER_SIZES_PT: Record<PaperSize, { widthPt: number; heightPt: number }> = {
  a4: { widthPt: 595.28, heightPt: 841.89 },
  a3: { widthPt: 841.89, heightPt: 1190.55 },
  letter: { widthPt: 612, heightPt: 792 },
  legal: { widthPt: 612, heightPt: 1008 },
}

export type PageBox = {
  widthPt: number
  heightPt: number
  marginsPt: PageMarginsPt
  contentWidthPt: number
  contentHeightPt: number
}

export function resolvePageBox(page: PrintPageSetup): PageBox {
  const base = PAPER_SIZES_PT[page.size]
  const [widthPt, heightPt] =
    page.orientation === 'landscape' ? [base.heightPt, base.widthPt] : [base.widthPt, base.heightPt]
  const { marginsPt } = page
  return {
    widthPt,
    heightPt,
    marginsPt,
    contentWidthPt: widthPt - marginsPt.left - marginsPt.right,
    contentHeightPt: heightPt - marginsPt.top - marginsPt.bottom,
  }
}

// ---------------------------------------------------------------------------
// Node bounds
// ---------------------------------------------------------------------------

export type SizedNode = {
  position: { x: number; y: number }
  width?: number
  height?: number
  measured?: { width?: number; height?: number }
}

export type Bounds = { x: number; y: number; width: number; height: number }

const DEFAULT_NODE_WIDTH_PX = 100
const DEFAULT_NODE_HEIGHT_PX = 40

export function nodeBounds(node: SizedNode): Bounds {
  const width = node.measured?.width ?? node.width ?? DEFAULT_NODE_WIDTH_PX
  const height = node.measured?.height ?? node.height ?? DEFAULT_NODE_HEIGHT_PX
  return { x: node.position.x, y: node.position.y, width, height }
}

export function unionBounds(boxes: Bounds[]): Bounds {
  if (boxes.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
  const minX = Math.min(...boxes.map((b) => b.x))
  const minY = Math.min(...boxes.map((b) => b.y))
  const maxX = Math.max(...boxes.map((b) => b.x + b.width))
  const maxY = Math.max(...boxes.map((b) => b.y + b.height))
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

// ---------------------------------------------------------------------------
// Render-mode math
// ---------------------------------------------------------------------------

type Interval = { start: number; end: number }

function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start)
  const merged: Interval[] = []
  for (const interval of sorted) {
    const last = merged[merged.length - 1]
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end)
    } else {
      merged.push({ ...interval })
    }
  }
  return merged
}

/**
 * Horizontal cut positions (absolute x, same space as `boxes`) that split
 * content wider than `stripWidth` into `stripWidth`-wide bands without ever
 * bisecting a node — cuts only land on a node's left/right edge. A single
 * node wider than `stripWidth` overflows its own band rather than being cut.
 */
export function gapAlignedCuts(boxes: Bounds[], stripWidth: number): number[] {
  if (boxes.length === 0) return []
  const merged = mergeIntervals(boxes.map((b) => ({ start: b.x, end: b.x + b.width })))
  const minX = merged[0].start
  const maxX = merged[merged.length - 1].end
  if (maxX - minX <= stripWidth) return []

  // The free zones between elements — a cut may land anywhere inside one.
  const gaps: Interval[] = []
  for (let i = 0; i < merged.length - 1; i++) {
    gaps.push({ start: merged[i].end, end: merged[i + 1].start })
  }

  const cuts: number[] = []
  let segStart = minX
  while (true) {
    const idealCut = segStart + stripWidth
    if (idealCut >= maxX) break

    // The rightmost point at-or-before `idealCut` that still lies in a gap —
    // maximizes band utilization without ever bisecting an element.
    let chosen: number | undefined
    for (const gap of gaps) {
      if (gap.start > idealCut) break
      chosen = Math.min(gap.end, idealCut)
    }

    if (chosen === undefined || chosen <= segStart) {
      // No usable gap before the budget runs out — the next element alone is
      // wider than the strip; let it overflow its own band instead of cutting it.
      chosen = gaps.find((gap) => gap.end > segStart)?.end ?? maxX
    }
    cuts.push(chosen)
    segStart = chosen
  }
  return cuts
}

/** Drops consecutive duplicates from an ascending list of band boundaries (a trailing cut can coincide with `maxX`). */
export function dedupeBoundaries(values: number[]): number[] {
  return values.filter((v, i) => i === 0 || v !== values[i - 1])
}

/** Width-only scale factor (LD scale-to-fit — row height is never rescaled). */
export function scaleToFitWidth(contentWidth: number, stripWidth: number): number {
  if (contentWidth <= 0) return 1
  return Math.min(1, stripWidth / contentWidth)
}

/** Both-axis scale factor (FBD scale-to-fit — whole-diagram bounds). */
export function scaleToFitBothAxes(
  contentWidth: number,
  contentHeight: number,
  stripWidth: number,
  stripHeight: number,
): number {
  if (contentWidth <= 0 || contentHeight <= 0) return 1
  return Math.min(1, stripWidth / contentWidth, stripHeight / contentHeight)
}

// ---------------------------------------------------------------------------
// DrawOp transforms — every op lives in a top-down (y grows downward) space;
// composing (dx, dy, scale) here always stays in that space. pdf-writer.ts is
// the only place that flips into pdf-lib's bottom-up page space, once, at the
// very end.
// ---------------------------------------------------------------------------

export type AffineTransform = { dx: number; dy: number; scale: number }

export function composeTransforms(outer: AffineTransform, inner: AffineTransform): AffineTransform {
  return {
    dx: outer.dx + outer.scale * inner.dx,
    dy: outer.dy + outer.scale * inner.dy,
    scale: outer.scale * inner.scale,
  }
}

export function transformDrawOp(op: DrawOp, t: AffineTransform): DrawOp {
  const { dx, dy, scale } = t
  switch (op.kind) {
    case 'line':
      return {
        ...op,
        x1: dx + scale * op.x1,
        y1: dy + scale * op.y1,
        x2: dx + scale * op.x2,
        y2: dy + scale * op.y2,
        widthPt: scale * op.widthPt,
      }
    case 'rect':
      return {
        ...op,
        x: dx + scale * op.x,
        y: dy + scale * op.y,
        width: scale * op.width,
        height: scale * op.height,
        strokeWidthPt: op.strokeWidthPt === undefined ? undefined : scale * op.strokeWidthPt,
      }
    case 'path':
      return {
        ...op,
        x: dx + scale * op.x,
        y: dy + scale * op.y,
        scale: scale * (op.scale ?? 1),
        strokeWidthPt: op.strokeWidthPt === undefined ? undefined : scale * op.strokeWidthPt,
      }
    case 'text':
      return {
        ...op,
        x: dx + scale * op.x,
        y: dy + scale * op.y,
        sizePt: scale * op.sizePt,
      }
    case 'clipPush':
      return {
        ...op,
        x: dx + scale * op.x,
        y: dy + scale * op.y,
        width: scale * op.width,
        height: scale * op.height,
      }
    case 'clipPop':
      return op
    default: {
      const exhaustive: never = op
      return exhaustive
    }
  }
}

export function transformDrawOps(ops: DrawOp[], t: AffineTransform): DrawOp[] {
  return ops.map((op) => transformDrawOp(op, t))
}
