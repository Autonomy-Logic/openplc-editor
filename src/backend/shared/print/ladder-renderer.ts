import type { RungLadderState } from '@root/middleware/shared/ports/types'
import type { Node } from '@xyflow/react'

import { edgeToDrawOp, isVisibleEdge } from './edges'
import {
  type Bounds,
  dedupeBoundaries,
  gapAlignedCuts,
  nodeBounds,
  PX_TO_PT,
  pxToPt,
  scaleToFitWidth,
  transformDrawOps,
  unionBounds,
} from './geometry'
import {
  blockInputVariables,
  blockOutputVariables,
  getBlockVariables,
  getNestedString,
  getRecord,
  getString,
  inOutVariableNames,
} from './node-data'
import {
  asCoilVariant,
  asContactVariant,
  BRAND_COLOR,
  COIL_BLOCK_HEIGHT,
  COIL_BLOCK_WIDTH,
  COIL_ICON_VIEWBOX,
  COIL_NEGATION_LINE,
  COIL_PARENTHESES_PATHS,
  COIL_VARIANT_GLYPHS,
  CONTACT_BLOCK_HEIGHT,
  CONTACT_BLOCK_WIDTH,
  CONTACT_ICON_VIEWBOX,
  CONTACT_NEGATION_LINE,
  CONTACT_VARIANT_GLYPHS,
  INK_COLOR,
} from './symbols'
import type { ContentBlock, DrawOp, PrintRenderMode } from './types'

const LABEL_SIZE_PT = 7
const BLOCK_CONNECTOR_Y = 36
const BLOCK_CONNECTOR_Y_OFFSET = 40

const HIDDEN_NODE_TYPES = new Set(['placeholder', 'parallelPlaceholder', 'mockNode'])

function centeredText(text: string, centerX: number, y: number, sizePt = LABEL_SIZE_PT, color = INK_COLOR): DrawOp {
  return { kind: 'text', text, x: centerX, y, sizePt, color, font: 'sans', align: 'center' }
}

function coilOps(node: Node): DrawOp[] {
  const variant = asCoilVariant(getString(node.data, 'variant'))
  const scale = COIL_BLOCK_HEIGHT / COIL_ICON_VIEWBOX.height
  const scaledWidth = COIL_ICON_VIEWBOX.width * scale
  const x = node.position.x - (scaledWidth - COIL_BLOCK_WIDTH) / 2
  const y = node.position.y

  const ops: DrawOp[] = COIL_PARENTHESES_PATHS.map((d) => ({ kind: 'path', d, x, y, scale, fill: INK_COLOR }))

  if (variant === 'negated') {
    ops.push({
      kind: 'line',
      x1: x + COIL_NEGATION_LINE.x1 * scale,
      y1: y + COIL_NEGATION_LINE.y1 * scale,
      x2: x + COIL_NEGATION_LINE.x2 * scale,
      y2: y + COIL_NEGATION_LINE.y2 * scale,
      color: BRAND_COLOR,
      widthPt: 2,
    })
  }

  const glyph = COIL_VARIANT_GLYPHS[variant]
  if (glyph) {
    ops.push({
      kind: 'text',
      text: glyph,
      x: node.position.x + COIL_BLOCK_WIDTH * 0.55,
      y: node.position.y + COIL_BLOCK_HEIGHT * 0.75,
      sizePt: LABEL_SIZE_PT,
      color: BRAND_COLOR,
      font: 'sansBold',
    })
  }

  const varName = getNestedString(node.data, 'variable', 'name')
  if (varName) {
    ops.push(centeredText(varName, node.position.x + COIL_BLOCK_WIDTH / 2, node.position.y - 8))
  }
  return ops
}

function contactOps(node: Node): DrawOp[] {
  const variant = asContactVariant(getString(node.data, 'variant'))
  const scale = CONTACT_BLOCK_HEIGHT / CONTACT_ICON_VIEWBOX.height
  const scaledWidth = CONTACT_ICON_VIEWBOX.width * scale
  const x = node.position.x - (scaledWidth - CONTACT_BLOCK_WIDTH) / 2
  const y = node.position.y

  const railX1 = x + 0.75 * scale
  const railX2 = x + 26.75 * scale
  const ops: DrawOp[] = [
    { kind: 'line', x1: railX1, y1: y, x2: railX1, y2: y + CONTACT_BLOCK_HEIGHT, color: INK_COLOR, widthPt: 1.5 },
    { kind: 'line', x1: railX2, y1: y, x2: railX2, y2: y + CONTACT_BLOCK_HEIGHT, color: INK_COLOR, widthPt: 1.5 },
  ]

  if (variant === 'negated') {
    ops.push({
      kind: 'line',
      x1: x + CONTACT_NEGATION_LINE.x1 * scale,
      y1: y + CONTACT_NEGATION_LINE.y1 * scale,
      x2: x + CONTACT_NEGATION_LINE.x2 * scale,
      y2: y + CONTACT_NEGATION_LINE.y2 * scale,
      color: BRAND_COLOR,
      widthPt: 1.5,
    })
  }

  const glyph = CONTACT_VARIANT_GLYPHS[variant]
  if (glyph) {
    ops.push({
      kind: 'text',
      text: glyph,
      x: node.position.x + CONTACT_BLOCK_WIDTH * 0.4,
      y: node.position.y + CONTACT_BLOCK_HEIGHT * 0.75,
      sizePt: LABEL_SIZE_PT,
      color: BRAND_COLOR,
      font: 'sansBold',
    })
  }

  const varName = getNestedString(node.data, 'variable', 'name')
  if (varName) {
    ops.push(centeredText(varName, node.position.x + CONTACT_BLOCK_WIDTH / 2, node.position.y - 8))
  }
  return ops
}

function variableOps(node: Node): DrawOp[] {
  const box = nodeBounds(node)
  const name = getNestedString(node.data, 'variable', 'name')
  const blockVariableType = getRecord(getRecord(node.data, 'block'), 'variableType')
  const placeholderType = getString(getRecord(blockVariableType, 'type'), 'value')
  const variant = getString(node.data, 'variant')
  const text = name || (placeholderType ? `(*${placeholderType}*)` : '')
  const align = variant === 'input' ? 'right' : variant === 'output' ? 'left' : 'center'
  const x = align === 'right' ? box.x + box.width - 2 : align === 'left' ? box.x + 2 : box.x + box.width / 2

  return [
    { kind: 'rect', x: box.x, y: box.y, width: box.width, height: box.height, stroke: INK_COLOR, strokeWidthPt: 0.75 },
    {
      kind: 'text',
      text,
      x,
      y: box.y + box.height / 2 + 3,
      sizePt: LABEL_SIZE_PT,
      color: INK_COLOR,
      font: 'sans',
      align,
    },
  ]
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

function powerRailOps(node: Node): DrawOp[] {
  const box = nodeBounds(node)
  return [{ kind: 'rect', x: box.x, y: box.y, width: box.width, height: box.height, fill: INK_COLOR }]
}

function nodeOps(node: Node): DrawOp[] {
  switch (node.type) {
    case 'block':
      return blockOps(node)
    case 'coil':
      return coilOps(node)
    case 'contact':
      return contactOps(node)
    case 'variable':
      return variableOps(node)
    case 'powerRail':
      return powerRailOps(node)
    default:
      return []
  }
}

/**
 * One node's (or edge's) draw ops, tagged with the x-range that decides
 * which band(s) it belongs to. A node is a single point (`spanStart ===
 * spanEnd`) — `gapAlignedCuts` never bisects its own box, so point
 * membership is exact. A wire's span is its full source-to-target range: a
 * cut IS allowed to fall inside it (only node boxes are off-limits), and
 * including the wire in every band its span overlaps — each clipped to that
 * band's own rect — is what makes it visually continue on the next band
 * instead of vanishing on one side of the cut.
 */
type PlacedOps = { spanStart: number; spanEnd: number; isPowerRail: boolean; ops: DrawOp[] }

type RenderedRung = { placed: PlacedOps[]; bounds: Bounds; elementBoxes: Bounds[] }

function renderRung(rung: RungLadderState): RenderedRung {
  const nodesById = new Map(rung.nodes.map((n) => [n.id, n]))
  const visibleNodes = rung.nodes.filter((n) => !HIDDEN_NODE_TYPES.has(n.type ?? ''))

  const placed: PlacedOps[] = []
  const elementBoxes: Bounds[] = []
  for (const node of visibleNodes) {
    const box = nodeBounds(node)
    elementBoxes.push(box)
    placed.push({ spanStart: box.x, spanEnd: box.x, isPowerRail: node.type === 'powerRail', ops: nodeOps(node) })
  }
  for (const edge of rung.edges) {
    if (!isVisibleEdge(nodesById, edge)) continue
    const op = edgeToDrawOp(nodesById, edge, INK_COLOR, 1)
    const source = nodesById.get(edge.source)
    const target = nodesById.get(edge.target)
    if (!op || !source || !target) continue
    placed.push({
      spanStart: Math.min(source.position.x, target.position.x),
      spanEnd: Math.max(source.position.x, target.position.x),
      isPowerRail: false,
      ops: [op],
    })
  }

  return { placed, bounds: unionBounds(elementBoxes), elementBoxes }
}

const bandOverlaps = (p: PlacedOps, start: number, end: number) => p.spanStart < end && p.spanEnd >= start

/**
 * The right (closing) power rail sits close to a rung's last real element —
 * a band split there normally carries the wire leading into it too (see
 * `bandOverlaps`), but if a rail is ever wired to nothing, coalesce its
 * content-less band into a neighboring one instead of letting it stand
 * alone, preferring the previous band (a closing rail visually belongs with
 * the rung before it) and only merging forward for a content-less leading band.
 */
function mergeRailOnlyBands(rawBoundaries: number[], placed: PlacedOps[]): number[] {
  const hasRealContent = (start: number, end: number) =>
    placed.some((p) => bandOverlaps(p, start, end) && !p.isPowerRail)

  const bands: { start: number; end: number }[] = []
  for (let i = 0; i < rawBoundaries.length - 1; i++) {
    const start = rawBoundaries[i]
    const end = rawBoundaries[i + 1]
    if (bands.length > 0 && !hasRealContent(start, end)) {
      bands[bands.length - 1].end = end
    } else {
      bands.push({ start, end })
    }
  }
  while (bands.length > 1 && !hasRealContent(bands[0].start, bands[0].end)) {
    bands[1].start = bands[0].start
    bands.shift()
  }

  return [bands[0]?.start ?? rawBoundaries[0], ...bands.map((b) => b.end)]
}

function commentBlock(comment: string, widthPt: number): ContentBlock {
  return {
    widthPt,
    heightPt: 12,
    ops: [{ kind: 'text', text: comment, x: 0, y: 8, sizePt: 8, color: INK_COLOR, font: 'sans', align: 'left' }],
  }
}

function flatten(placed: PlacedOps[]): DrawOp[] {
  return placed.flatMap((p) => p.ops)
}

function rungToBlocks(
  rendered: RenderedRung,
  mode: PrintRenderMode,
  contentWidthPt: number,
  contentHeightPt: number,
  modeScale: number,
): ContentBlock[] {
  const { bounds } = rendered
  // A rung's elements sit on one horizontal line — unlike an FBD diagram,
  // there's no sensible way to split one across pages. If it's still taller
  // than the page even at `modeScale`, shrink it further so the whole rung
  // stays visible instead of drawing past the page edge and getting clipped.
  const heightAtModeScale = pxToPt(bounds.height) * modeScale
  const heightSafetyScale = heightAtModeScale > contentHeightPt ? contentHeightPt / heightAtModeScale : 1
  const scale = modeScale * heightSafetyScale
  const contentWidthPx = contentWidthPt / (PX_TO_PT * scale)

  if (mode === 'scale-to-fit' || bounds.width <= contentWidthPx) {
    const allOps = flatten(rendered.placed)
    const shiftToOrigin = transformDrawOps(allOps, { dx: -bounds.x, dy: -bounds.y, scale: 1 })
    return [
      {
        widthPt: contentWidthPt,
        heightPt: pxToPt(bounds.height) * scale,
        ops: transformDrawOps(shiftToOrigin, { dx: 0, dy: 0, scale: PX_TO_PT * scale }),
      },
    ]
  }

  const cuts = gapAlignedCuts(rendered.elementBoxes, contentWidthPx)
  const rawBoundaries = dedupeBoundaries([bounds.x, ...cuts, bounds.x + bounds.width])
  const boundaries = mergeRailOnlyBands(rawBoundaries, rendered.placed)

  // A cut is only ever forced to overflow its own band when elements truly
  // have no gap between them at all (touching or overlapping node boxes) —
  // `gapAlignedCuts` otherwise always finds a node-free point to cut at, wire
  // or no wire. That's rare enough that reaching for a further shrink here,
  // on top of the split that already happened, is a reasonable last resort.
  const maxBandWidthPt = pxToPt(Math.max(...boundaries.slice(1).map((end, i) => end - boundaries[i]))) * scale
  const widthSafetyScale = maxBandWidthPt > contentWidthPt ? contentWidthPt / maxBandWidthPt : 1
  const finalScale = scale * widthSafetyScale

  const blocks: ContentBlock[] = []
  for (let i = 0; i < boundaries.length - 1; i++) {
    const xStart = boundaries[i]
    const xEnd = boundaries[i + 1]
    const bandOps = flatten(rendered.placed.filter((p) => bandOverlaps(p, xStart, xEnd)))
    blocks.push({
      widthPt: contentWidthPt,
      heightPt: pxToPt(bounds.height) * finalScale,
      ops: [
        {
          kind: 'clipPush',
          x: 0,
          y: 0,
          width: pxToPt(xEnd - xStart) * finalScale,
          height: pxToPt(bounds.height) * finalScale,
        },
        ...transformDrawOps(bandOps, {
          dx: -finalScale * pxToPt(xStart),
          dy: -finalScale * pxToPt(bounds.y),
          scale: PX_TO_PT * finalScale,
        }),
        { kind: 'clipPop' },
      ],
    })
  }
  return blocks
}

/** `rungs -> ContentBlock[]`, one or more blocks per rung depending on render mode. */
export function renderLadderPou(
  rungs: RungLadderState[],
  mode: PrintRenderMode,
  contentWidthPt: number,
  contentHeightPt: number,
): ContentBlock[] {
  const rendered = rungs.map(renderRung)

  let modeScale = 1
  if (mode === 'scale-to-fit') {
    const maxWidthPx = Math.max(0, ...rendered.map((r) => r.bounds.width))
    modeScale = scaleToFitWidth(maxWidthPx, contentWidthPt / PX_TO_PT)
  }

  const blocks: ContentBlock[] = []
  rungs.forEach((rung, i) => {
    if (rung.comment) blocks.push(commentBlock(rung.comment, contentWidthPt))
    blocks.push(...rungToBlocks(rendered[i], mode, contentWidthPt, contentHeightPt, modeScale))
  })
  return blocks
}
