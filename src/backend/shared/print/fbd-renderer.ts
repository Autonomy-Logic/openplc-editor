import type { FBDRungState } from '@root/middleware/shared/ports/types'
import type { Node } from '@xyflow/react'

import { edgeToDrawOp, isVisibleEdge } from './edges'
import {
  type Bounds,
  dedupeBoundaries,
  gapAlignedCuts,
  nodeBounds,
  PX_TO_PT,
  pxToPt,
  scaleToFitBothAxes,
  transformDrawOps,
  unionBounds,
} from './geometry'
import {
  blockInputVariables,
  blockOutputVariables,
  getBlockVariables,
  getBoolean,
  getNestedString,
  getRecord,
  getString,
  inOutVariableNames,
} from './node-data'
import {
  CONNECTION_FILL_COLOR,
  CONNECTION_ICON_VIEWBOX,
  CONNECTION_STROKE_COLOR,
  CONNECTOR_PATH,
  CONTINUATION_PATH,
  INK_COLOR,
} from './symbols'
import type { ContentBlock, DrawOp, PrintRenderMode } from './types'

const LABEL_SIZE_PT = 7
const BLOCK_CONNECTOR_Y = 48
const BLOCK_CONNECTOR_Y_OFFSET = 48

function centeredText(text: string, centerX: number, y: number, sizePt = LABEL_SIZE_PT, color = INK_COLOR): DrawOp {
  return { kind: 'text', text, x: centerX, y, sizePt, color, font: 'sans', align: 'center' }
}

function negationCircle(cx: number, cy: number, r: number): DrawOp {
  const d = `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0`
  return { kind: 'path', d, x: 0, y: 0, scale: 1, fill: '#FFFFFF', stroke: INK_COLOR, strokeWidthPt: 0.75 }
}

function blockOps(node: Node): DrawOp[] {
  const box = nodeBounds(node)
  const variant = getRecord(node.data, 'variant')
  const vars = getBlockVariables(node.data)
  const inputs = blockInputVariables(vars).map((v) => v.name)
  const outputs = blockOutputVariables(vars).map((v) => v.name)
  const inOuts = inOutVariableNames(vars)

  const ops: DrawOp[] = [
    { kind: 'rect', x: box.x, y: box.y, width: box.width, height: box.height, stroke: INK_COLOR, strokeWidthPt: 1 },
    centeredText(getString(variant, 'name') ?? '???', box.x + box.width / 2, box.y + 14, LABEL_SIZE_PT + 1, INK_COLOR),
  ]

  inputs.forEach((name, i) => {
    const label = inOuts.has(name) ? `<-> ${name}` : name
    ops.push({
      kind: 'text',
      text: label,
      x: box.x + 4,
      y: box.y + BLOCK_CONNECTOR_Y + i * BLOCK_CONNECTOR_Y_OFFSET,
      sizePt: LABEL_SIZE_PT,
      color: INK_COLOR,
      font: 'sans',
      align: 'left',
    })
  })
  outputs.forEach((name, i) => {
    ops.push({
      kind: 'text',
      text: name,
      x: box.x + box.width - 4,
      y: box.y + BLOCK_CONNECTOR_Y + i * BLOCK_CONNECTOR_Y_OFFSET,
      sizePt: LABEL_SIZE_PT,
      color: INK_COLOR,
      font: 'sans',
      align: 'right',
    })
  })

  const variantType = getString(variant, 'type')
  const instanceName = getNestedString(node.data, 'variable', 'name')
  if (variantType !== 'function' && variantType !== 'generic' && instanceName) {
    ops.push(centeredText(instanceName, box.x + box.width / 2, box.y - 6))
  }
  return ops
}

function variableOps(node: Node): DrawOp[] {
  const box = nodeBounds(node)
  const name = getNestedString(node.data, 'variable', 'name') ?? ''
  const negated = getBoolean(node.data, 'negated') ?? false
  const variant = getString(node.data, 'variant')

  const ops: DrawOp[] = [
    { kind: 'rect', x: box.x, y: box.y, width: box.width, height: box.height, stroke: INK_COLOR, strokeWidthPt: 0.75 },
    centeredText(name, box.x + box.width / 2, box.y + box.height / 2 + 3),
  ]

  if (negated) {
    const r = 4
    const cx = variant === 'output-variable' ? box.x + box.width + r : box.x - r
    ops.push(negationCircle(cx, box.y + box.height / 2, r))
  }
  return ops
}

function connectionOps(node: Node): DrawOp[] {
  const box = nodeBounds(node)
  const variant = getString(node.data, 'variant')
  const name = getNestedString(node.data, 'variable', 'name') ?? ''
  const scale = box.height / CONNECTION_ICON_VIEWBOX.height
  const d = variant === 'continuation' ? CONTINUATION_PATH : CONNECTOR_PATH

  return [
    {
      kind: 'path',
      d,
      x: box.x,
      y: box.y,
      scale,
      fill: CONNECTION_FILL_COLOR,
      stroke: CONNECTION_STROKE_COLOR,
      strokeWidthPt: 1,
    },
    centeredText(name, box.x + box.width / 2, box.y + box.height / 2 + 3),
  ]
}

function commentOps(node: Node): DrawOp[] {
  const box = nodeBounds(node)
  const content = getString(node.data, 'content') ?? getString(node.data, 'comment') ?? ''
  return [
    { kind: 'rect', x: box.x, y: box.y, width: box.width, height: box.height, stroke: INK_COLOR, strokeWidthPt: 0.5 },
    {
      kind: 'text',
      text: content,
      x: box.x + box.width / 2,
      y: box.y + 12,
      sizePt: LABEL_SIZE_PT,
      color: INK_COLOR,
      font: 'sans',
      align: 'center',
    },
  ]
}

function nodeOps(node: Node): DrawOp[] {
  switch (node.type) {
    case 'block':
      return blockOps(node)
    case 'input-variable':
    case 'output-variable':
    case 'inout-variable':
      return variableOps(node)
    case 'connector':
    case 'continuation':
      return connectionOps(node)
    case 'comment':
      return commentOps(node)
    default:
      return []
  }
}

type PlacedOps = { box: Bounds; ops: DrawOp[] }
type RenderedFbd = { placed: PlacedOps[]; bounds: Bounds; elementBoxes: Bounds[]; edgeSpans: Bounds[] }

function renderFbdRung(rung: FBDRungState): RenderedFbd {
  const nodesById = new Map(rung.nodes.map((n) => [n.id, n]))

  const placed: PlacedOps[] = []
  const elementBoxes: Bounds[] = []
  for (const node of rung.nodes) {
    const box = nodeBounds(node)
    elementBoxes.push(box)
    placed.push({ box, ops: nodeOps(node) })
  }
  // A wire's own span (e.g. two blocks connected across an otherwise-empty
  // gap) doesn't show up in either node's own bounding box, so without this
  // `gapAlignedCuts` sees a "gap" a cut can freely land in on either axis —
  // even though a wire actually runs through it — clipping it in two at the
  // tile boundary, with the far side never drawn at all.
  const edgeSpans: Bounds[] = []
  for (const edge of rung.edges) {
    if (!isVisibleEdge(nodesById, edge)) continue
    const op = edgeToDrawOp(nodesById, edge, INK_COLOR, 1)
    const source = nodesById.get(edge.source)
    const target = nodesById.get(edge.target)
    if (op && source) placed.push({ box: nodeBounds(source), ops: [op] })
    if (source && target) {
      const x1 = source.position.x
      const x2 = target.position.x
      const y1 = source.position.y
      const y2 = target.position.y
      edgeSpans.push({ x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) })
    }
  }

  return { placed, bounds: unionBounds(elementBoxes), elementBoxes, edgeSpans }
}

function flatten(placed: PlacedOps[]): DrawOp[] {
  return placed.flatMap((p) => p.ops)
}

/** Swaps x/width with y/height so `gapAlignedCuts` (an x-axis algorithm) can cut along y too. */
function transposeBounds(boxes: Bounds[]): Bounds[] {
  return boxes.map((b) => ({ x: b.y, y: b.x, width: b.height, height: b.width }))
}

function renderTile(
  rendered: RenderedFbd,
  xStart: number,
  xEnd: number,
  yStart: number,
  yEnd: number,
  contentWidthPt: number,
  /** Forced page height for a real tile split — `undefined` sizes the block to its own content (no split occurred). */
  forcedHeightPt: number | undefined,
): ContentBlock {
  const tileOps = flatten(
    rendered.placed.filter((p) => p.box.x >= xStart && p.box.x < xEnd && p.box.y >= yStart && p.box.y < yEnd),
  )
  const naturalWidthPt = pxToPt(xEnd - xStart)
  const naturalHeightPt = pxToPt(yEnd - yStart)
  // `gapAlignedCuts` lets a chain of connected nodes it can't cleanly split
  // overflow its own band rather than bisect it — that can leave a tile
  // wider or taller than the page. Scale the whole tile down to fit instead
  // of letting the overflow draw past the page edge and get silently clipped.
  const widthScale = naturalWidthPt > contentWidthPt ? contentWidthPt / naturalWidthPt : 1
  const heightScale =
    forcedHeightPt !== undefined && naturalHeightPt > forcedHeightPt ? forcedHeightPt / naturalHeightPt : 1
  const scale = Math.min(widthScale, heightScale)
  const transform = { dx: -scale * pxToPt(xStart), dy: -scale * pxToPt(yStart), scale: PX_TO_PT * scale }
  return {
    widthPt: contentWidthPt,
    heightPt: forcedHeightPt ?? naturalHeightPt * scale,
    ops: [
      { kind: 'clipPush', x: 0, y: 0, width: naturalWidthPt * scale, height: naturalHeightPt * scale },
      ...transformDrawOps(tileOps, transform),
      { kind: 'clipPop' },
    ],
  }
}

/**
 * A diagram that fits without splitting yields one block sized to its actual
 * content (so short POUs can still share a page under `may-share-page`). Once
 * splitting actually happens, each resulting tile claims a full page — "one
 * tile per page", no continuation marker between tiles.
 */
function normalModeTiles(rendered: RenderedFbd, contentWidthPt: number, contentHeightPt: number): ContentBlock[] {
  const { bounds } = rendered
  const stripWidthPx = contentWidthPt / PX_TO_PT
  const stripHeightPx = contentHeightPt / PX_TO_PT

  const cutCandidates = [...rendered.elementBoxes, ...rendered.edgeSpans]
  const xCuts = gapAlignedCuts(cutCandidates, stripWidthPx)
  const yCutsTransposed = gapAlignedCuts(transposeBounds(cutCandidates), stripHeightPx)

  if (xCuts.length === 0 && yCutsTransposed.length === 0) {
    return [
      renderTile(
        rendered,
        bounds.x,
        bounds.x + bounds.width,
        bounds.y,
        bounds.y + bounds.height,
        contentWidthPt,
        undefined,
      ),
    ]
  }

  const xBoundaries = dedupeBoundaries([bounds.x, ...xCuts, bounds.x + bounds.width])
  const yBoundaries = dedupeBoundaries([bounds.y, ...yCutsTransposed, bounds.y + bounds.height])

  const tiles: ContentBlock[] = []
  for (let row = 0; row < yBoundaries.length - 1; row++) {
    for (let col = 0; col < xBoundaries.length - 1; col++) {
      tiles.push(
        renderTile(
          rendered,
          xBoundaries[col],
          xBoundaries[col + 1],
          yBoundaries[row],
          yBoundaries[row + 1],
          contentWidthPt,
          contentHeightPt,
        ),
      )
    }
  }
  return tiles
}

function scaleToFitBlock(rendered: RenderedFbd, contentWidthPt: number, contentHeightPt: number): ContentBlock {
  const { bounds } = rendered
  const scale = scaleToFitBothAxes(bounds.width, bounds.height, contentWidthPt / PX_TO_PT, contentHeightPt / PX_TO_PT)
  const allOps = flatten(rendered.placed)
  const shiftToOrigin = transformDrawOps(allOps, { dx: -bounds.x, dy: -bounds.y, scale: 1 })
  return {
    widthPt: contentWidthPt,
    heightPt: pxToPt(bounds.height) * scale,
    ops: transformDrawOps(shiftToOrigin, { dx: 0, dy: 0, scale: PX_TO_PT * scale }),
  }
}

/** `rung -> ContentBlock[]` — Normal mode tiles x&y (one tile per page); Scale-to-fit yields one block. */
export function renderFbdPou(
  rung: FBDRungState,
  mode: PrintRenderMode,
  contentWidthPt: number,
  contentHeightPt: number,
): ContentBlock[] {
  const rendered = renderFbdRung(rung)
  if (rendered.elementBoxes.length === 0) return []

  if (mode === 'scale-to-fit') {
    return [scaleToFitBlock(rendered, contentWidthPt, contentHeightPt)]
  }
  return normalModeTiles(rendered, contentWidthPt, contentHeightPt)
}
