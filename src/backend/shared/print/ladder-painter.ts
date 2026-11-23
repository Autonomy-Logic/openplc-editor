import type { RungLadderState } from '@root/middleware/shared/ports/types'
import { layoutRungOrStored } from '@root/middleware/shared/utils/ladder-layout/layout'
import { textWidthPx } from '@root/middleware/shared/utils/ladder-layout/measure'
import { LADDER_PALETTE, LADDER_STYLE, LADDER_TYPOGRAPHY } from '@root/middleware/shared/utils/ladder-layout/style'
import { ladderSymbol, symbolKindOf } from '@root/middleware/shared/utils/ladder-layout/symbols'
import type { LabelBox, RungLayout } from '@root/middleware/shared/utils/ladder-layout/types'
import { parallelEdgeRoute, type WirePoint } from '@root/middleware/shared/utils/ladder-layout/wires'
import type { Node } from '@xyflow/react'

import { getLiteralType } from '../../../frontend/utils/keywords'
import { PX_TO_PT, transformDrawOps } from './geometry'
import {
  LD_MARKER,
  ldPouScale,
  type LdPrintRow,
  type LdPrintRung,
  ldRowCanvasWidthPx,
  planLadderPou,
} from './ladder-print-plan'
import type { ContentBlock, DrawOp, PrintPou, PrintRenderMode } from './types'

const PAPER = LADDER_PALETTE.paper
const T = LADDER_TYPOGRAPHY
const S = LADDER_STYLE

/** Stroke widths in px: rails, wires, symbols and block borders, as the screen draws them. */
const STROKE = { rail: 2.5, wire: 1.25, symbol: 1.4, block: 1.1 } as const

/** Baseline of a centred text below its centre line, per px of its size. */
const CENTRED_BASELINE = 0.36

/** Line pitch of a printed comment, per px of its size. */
const COMMENT_LINE = 1.5

/** Indent of a printed comment from the left rail, in px. */
const COMMENT_INDENT = 12

/** Height of the End row, in px. */
const END_ROW_HEIGHT = 30

/** Space before the first element of a continuation row: its start marker and gap, in px. */
const MARKER_SPACE = LD_MARKER.width + LD_MARKER.gap

type LdPrintPou = Extract<PrintPou, { kind: 'ld' }>

/** `text` broken into lines no wider than `widthPx` at the comment size, every source line kept. */
export function wrapCommentLines(text: string, widthPx: number): string[] {
  if (text.trim() === '') return []
  const fits = (line: string) => textWidthPx(line, T.commentSizePx) <= widthPx
  const lines: string[] = []
  for (const source of text.split('\n')) {
    let line = ''
    for (const word of source.split(' ')) {
      const joined = line === '' ? word : `${line} ${word}`
      if (fits(joined)) {
        line = joined
        continue
      }
      if (line !== '') lines.push(line)
      line = word
      while (!fits(line) && line.length > 1) {
        let cut = line.length - 1
        while (cut > 1 && !fits(line.slice(0, cut))) cut--
        lines.push(line.slice(0, cut))
        line = line.slice(cut)
      }
    }
    lines.push(line)
  }
  return lines
}

const commentHeightPx = (lines: readonly string[]): number =>
  lines.length === 0 ? 0 : lines.length * T.commentSizePx * COMMENT_LINE + S.topPad

/** Width a comment line may take on a canvas `canvasPx` wide: from its indent to a gap before the right rail. */
const commentWidthPx = (canvasPx: number): number => canvasPx - 2 * COMMENT_INDENT

/** A text op at a label box, in the label's face, weight and anchor. */
function labelOp(label: LabelBox, x: number, y: number, color: string): DrawOp {
  return {
    kind: 'text',
    text: label.text,
    x,
    y,
    sizePt: label.sizePx,
    color,
    font: label.weight === 600 ? 'ldMonoSemibold' : 'ldMono',
    align: label.anchor === 'start' ? 'left' : label.anchor === 'middle' ? 'center' : 'right',
  }
}

/** The paper colour of each label role; a pin variable that is a literal takes the literal colour instead. */
const LABEL_COLOUR: Readonly<Record<LabelBox['role'], string>> = {
  name: PAPER.text,
  location: PAPER.loc,
  blockType: PAPER.text,
  instance: PAPER.text,
  pinFormal: PAPER.muted,
  pinVariable: PAPER.text,
}

/** The paper colour of a label. */
const labelColour = (label: LabelBox): string =>
  label.role === 'pinVariable' && getLiteralType(label.text) !== undefined ? PAPER.literal : LABEL_COLOUR[label.role]

/** A straight polyline through `points`, as line ops. */
function polylineOps(points: readonly WirePoint[]): DrawOp[] {
  const ops: DrawOp[] = []
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (a.x === b.x && a.y === b.y) continue
    ops.push({ kind: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, color: PAPER.wire, widthPt: STROKE.wire })
  }
  return ops
}

/** A marker pill with its letter, its left edge at `x` and centred on `y`. */
function markerOps(letter: string, x: number, y: number): DrawOp[] {
  const { width: w, height: h } = LD_MARKER
  const r = h / 2
  const d = `M${r} 0 H${w - r} A${r} ${r} 0 0 1 ${w - r} ${h} H${r} A${r} ${r} 0 0 1 ${r} 0 Z`
  return [
    { kind: 'path', d, x, y: y - h / 2, scale: 1, stroke: PAPER.wire, strokeWidthPt: STROKE.wire, fill: PAPER.bg },
    {
      kind: 'text',
      text: letter,
      x: x + w / 2,
      y: y + 9 * CENTRED_BASELINE,
      sizePt: 9,
      color: PAPER.text,
      font: 'ldMonoSemibold',
      align: 'center',
    },
  ]
}

/** How far a wire runs on into a contact's or coil's symbol; 0 for any other node. */
function insetOf(rung: RungLadderState, nodeId: string): number {
  const node = rung.nodes.find((candidate) => candidate.id === nodeId)
  const variant: unknown = node?.data.variant
  const kind = symbolKindOf(node?.type ?? '', typeof variant === 'string' ? variant : undefined)
  return kind === undefined ? 0 : ladderSymbol(kind).wireInset
}

/** A handle's position in rung canvas coordinates, shifted by `dx`; the node's first handle when the id is unknown. */
function handleAt(layout: RungLayout, nodeId: string, handleId: string | null | undefined, dx: number): WirePoint {
  const geometry = layout.nodes.get(nodeId)
  const handle = geometry?.handles.find((candidate) => candidate.id === handleId) ?? geometry?.handles[0]
  return {
    x: (geometry?.position.x ?? 0) + (handle?.x ?? 0) + dx,
    y: (geometry?.position.y ?? 0) + (handle?.y ?? 0),
  }
}

/** The draw ops of one node: a contact or coil symbol, a block box, and every label the layout gives it. */
function nodeOps(node: Node, layout: RungLayout, dx: number): DrawOp[] {
  const nodeId = node.id
  const geometry = layout.nodes.get(nodeId) ?? { position: node.position, width: 0, height: 0, handles: [] }
  const x = geometry.position.x + dx
  const y = geometry.position.y
  const ops: DrawOp[] = []
  const variant: unknown = node.data.variant
  const kind = symbolKindOf(node.type ?? '', typeof variant === 'string' ? variant : undefined)
  if (kind !== undefined) {
    const symbol = ladderSymbol(kind)
    for (const d of symbol.paths) {
      ops.push({ kind: 'path', d, x, y, scale: 1, stroke: PAPER.wire, strokeWidthPt: STROKE.symbol })
    }
    for (const line of symbol.lines) {
      ops.push({
        kind: 'line',
        x1: x + line.x1,
        y1: y + line.y1,
        x2: x + line.x2,
        y2: y + line.y2,
        color: PAPER.wire,
        widthPt: STROKE.symbol,
      })
    }
    if (symbol.glyphText !== undefined) {
      ops.push({
        kind: 'text',
        text: symbol.glyphText.text,
        x: x + symbol.width / 2,
        y: y + symbol.height / 2 + symbol.glyphText.sizePx * CENTRED_BASELINE,
        sizePt: symbol.glyphText.sizePx,
        color: PAPER.wire,
        font: 'ldMonoSemibold',
        align: 'center',
      })
    }
  }
  if (node.type === 'block') {
    ops.push(
      {
        kind: 'rect',
        x,
        y,
        width: geometry.width,
        height: geometry.height,
        stroke: PAPER.wire,
        strokeWidthPt: STROKE.block,
        fill: PAPER.blockFill,
      },
      { kind: 'rect', x: x + 1, y: y + 1, width: geometry.width - 2, height: S.blkHead - 1, fill: PAPER.blockHeader },
    )
  }
  for (const label of layout.labels.get(nodeId) ?? []) {
    if (label.text === '') continue
    ops.push(labelOp(label, label.x + dx, label.y, labelColour(label)))
  }
  return ops
}

/** The node ids of the segments of a row. */
const rowNodeIds = (layout: RungLayout, row: LdPrintRow): Set<string> =>
  new Set(row.segmentIndexes.flatMap((index) => layout.segments[index]?.nodeIds ?? []))

/** The row a node is printed on, or undefined for the rails and nodes in no segment. */
function rowOfNode(layout: RungLayout, rows: readonly LdPrintRow[]): Map<string, number> {
  const rowOf = new Map<string, number>()
  rows.forEach((row, index) => rowNodeIds(layout, row).forEach((id) => rowOf.set(id, index)))
  return rowOf
}

/** The draw ops of one row of a rung, in rung canvas coordinates (x from the left rail, y from the row top). */
function rowOps(
  rung: RungLadderState,
  layout: RungLayout,
  rows: readonly LdPrintRow[],
  rowIndex: number,
  railX: number,
): DrawOp[] {
  const row = rows[rowIndex]
  const rowOf = rowOfNode(layout, rows)
  const first = layout.segments[row.segmentIndexes[0] ?? -1]
  const rowShift = (row.startMarker !== undefined ? MARKER_SPACE : 0) - (first?.x ?? 0)
  const railShift = railX - layout.size.width
  const trailing = new Set(layout.trailingOutputIds)
  const dxOf = (id: string): number => {
    if (id === layout.rightRailId || (trailing.has(id) && rowOf.get(id) === rowIndex)) return railShift
    return rowOf.has(id) ? rowShift : 0
  }
  const onRow = (id: string): boolean => rowOf.get(id) === rowIndex
  const isRail = (id: string): boolean => !rowOf.has(id) && layout.nodes.has(id)

  const ops: DrawOp[] = []
  const mainY = layout.mainWireY
  for (const edge of rung.edges) {
    const sourceHere = onRow(edge.source) || (isRail(edge.source) && (onRow(edge.target) || isRail(edge.target)))
    const targetHere = onRow(edge.target) || (isRail(edge.target) && (onRow(edge.source) || isRail(edge.source)))
    const crossesOut = onRow(edge.source) && (rowOf.get(edge.target) ?? rowIndex) > rowIndex
    const crossesIn = onRow(edge.target) && (rowOf.get(edge.source) ?? rowIndex) < rowIndex && !isRail(edge.source)
    if (!(sourceHere && targetHere) && !crossesOut && !crossesIn) continue
    const sourceInset = insetOf(rung, edge.source)
    const targetInset = insetOf(rung, edge.target)
    const routed = sourceHere && targetHere ? parallelEdgeRoute(layout, edge, dxOf) : undefined
    const source = crossesIn
      ? { x: MARKER_SPACE, y: mainY }
      : handleAt(layout, edge.source, edge.sourceHandle, dxOf(edge.source))
    const target = crossesOut
      ? { x: railX - MARKER_SPACE, y: mainY }
      : handleAt(layout, edge.target, edge.targetHandle, dxOf(edge.target))
    const path = routed ?? [{ x: Math.min(source.x, target.x), y: source.y }, { x: target.x, y: source.y }, target]
    const start = path[0]
    const end = path[path.length - 1]
    ops.push(
      ...polylineOps([
        ...(sourceInset > 0 && !crossesIn ? [{ x: start.x - sourceInset, y: start.y }] : []),
        ...path,
        ...(targetInset > 0 && !crossesOut ? [{ x: end.x + targetInset, y: end.y }] : []),
      ]),
    )
  }
  const here = rowNodeIds(layout, row)
  for (const node of rung.nodes) if (here.has(node.id)) ops.push(...nodeOps(node, layout, dxOf(node.id)))
  if (row.startMarker !== undefined) ops.push(...markerOps(row.startMarker, LD_MARKER.gap / 2, mainY))
  if (row.endMarker !== undefined) {
    ops.push(...markerOps(row.endMarker, railX - MARKER_SPACE + LD_MARKER.gap / 2, mainY))
  }
  return ops
}

/** The two power rails at `leftPt` and `rightPt`, from `topPt` over `heightPt`, `widthPt` thick. */
function railOps(leftPt: number, rightPt: number, topPt: number, heightPt: number, widthPt: number): DrawOp[] {
  return [leftPt, rightPt].map((x) => ({
    kind: 'line',
    x1: x,
    y1: topPt,
    x2: x,
    y2: topPt + heightPt,
    color: PAPER.rail,
    widthPt,
  }))
}

/** `ops` in px scaled by `scale` (pt per px) and moved by `dxPt`, `dyPt`. */
const placed = (ops: DrawOp[], dxPt: number, dyPt: number, scale: number): DrawOp[] =>
  transformDrawOps(ops, { dx: dxPt, dy: dyPt, scale })

/** Where the rails of every rung of a POU printed at `pouScale` go, in pt. */
function railsPt(contentWidthPt: number, pouScale: number): { leftPt: number; rightPt: number } {
  const k = PX_TO_PT * pouScale
  return { leftPt: S.gutter * k, rightPt: contentWidthPt - S.padR * k }
}

/**
 * The block of one rung: comment lines, number, gutter and rails at the POU scale, its rows at its own scale between
 * the rails, so the rails of every rung meet.
 */
function rungBlock(
  rung: RungLadderState,
  layout: RungLayout,
  plan: LdPrintRung,
  pouScale: number,
  number: number,
  contentWidthPx: number,
  contentWidthPt: number,
): ContentBlock {
  const kPou = PX_TO_PT * pouScale
  const kRung = PX_TO_PT * plan.scale
  const { leftPt, rightPt } = railsPt(contentWidthPt, pouScale)
  const railX = ldRowCanvasWidthPx(contentWidthPx, plan.scale, pouScale)
  const comment = wrapCommentLines(rung.comment, commentWidthPx(ldRowCanvasWidthPx(contentWidthPx, pouScale)))
  const headerPt = commentHeightPx(comment) * kPou
  const rowHeightPt = layout.size.height * kRung
  const heightPt = headerPt + plan.rows.length * rowHeightPt
  const header: DrawOp[] = comment.map((line, index) => ({
    kind: 'text',
    text: line,
    x: S.gutter + COMMENT_INDENT,
    y: S.topPad + (index + 0.75) * T.commentSizePx * COMMENT_LINE,
    sizePt: T.commentSizePx,
    color: PAPER.muted,
    font: 'ldMono',
    align: 'left',
  }))
  const ops: DrawOp[] = [
    ...railOps(leftPt, rightPt, 0, heightPt, STROKE.rail * kPou),
    ...placed(header, 0, 0, kPou),
    {
      kind: 'text',
      text: String(number),
      x: (S.gutter - 10) * kPou,
      y: headerPt + layout.mainWireY * kRung + T.nameSizePx * CENTRED_BASELINE * kPou,
      sizePt: T.nameSizePx * kPou,
      color: PAPER.muted,
      font: 'ldMono',
      align: 'right',
    },
  ]
  plan.rows.forEach((_, index) => {
    ops.push(...placed(rowOps(rung, layout, plan.rows, index, railX), leftPt, headerPt + index * rowHeightPt, kRung))
  })
  return { widthPt: contentWidthPt, heightPt, gapAfterPt: 0, ops }
}

/** The End row: the rails, one wire across and "End" in the gutter, at the POU scale. */
function endBlock(contentWidthPt: number, pouScale: number): ContentBlock {
  const k = PX_TO_PT * pouScale
  const { leftPt, rightPt } = railsPt(contentWidthPt, pouScale)
  const y = (END_ROW_HEIGHT / 2) * k
  return {
    widthPt: contentWidthPt,
    heightPt: END_ROW_HEIGHT * k,
    ops: [
      ...railOps(leftPt, rightPt, 0, END_ROW_HEIGHT * k, STROKE.rail * k),
      { kind: 'line', x1: leftPt, y1: y, x2: rightPt, y2: y, color: PAPER.wire, widthPt: STROKE.wire * k },
      {
        kind: 'text',
        text: 'End',
        x: (S.gutter - 10) * k,
        y: y + T.nameSizePx * CENTRED_BASELINE * k,
        sizePt: T.nameSizePx * k,
        color: PAPER.muted,
        font: 'ldMono',
        align: 'right',
      },
    ],
  }
}

/**
 * An LD POU as content blocks: one per rung (comment, rows, rails), so pages break only between rungs, then the End
 * row. Drawn from the layout engine with the POU's labels, in the paper palette, with no screen-only state.
 */
export function renderLadderPou(
  pou: LdPrintPou,
  mode: PrintRenderMode,
  contentWidthPt: number,
  contentHeightPt: number,
): ContentBlock[] {
  const contentWidthPx = contentWidthPt / PX_TO_PT
  const contentHeightPx = contentHeightPt / PX_TO_PT
  const layouts = pou.rungs.map((rung) => layoutRungOrStored(rung, pou.labels))
  const commentWidth = commentWidthPx(ldRowCanvasWidthPx(contentWidthPx, ldPouScale(layouts, contentWidthPx, mode)))
  const inputs = pou.rungs.map((rung, index) => ({
    layout: layouts[index],
    headerPx: commentHeightPx(wrapCommentLines(rung.comment, commentWidth)),
  }))
  const plan = planLadderPou(inputs, contentWidthPx, contentHeightPx, mode)
  const blocks = pou.rungs.map((rung, index) =>
    rungBlock(rung, layouts[index], plan.rungs[index], plan.pouScale, index + 1, contentWidthPx, contentWidthPt),
  )
  return [...blocks, endBlock(contentWidthPt, plan.pouScale)]
}
