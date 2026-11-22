import type { Node } from '@xyflow/react'

import { IN_OUT_MARKER_WIDTH } from '../../../../frontend/utils/graphical/in-out-pin-rules'
import { MAX_REDUCIBLE_ELEMENTS } from '../../../../frontend/utils/PLC/xml-parser/language/series-parallel'
import type { RungLadderState } from '../../ports/types'
import { type LadderLabelSource, resolveLocationLabel } from './labels'
import { handleIdOf, handlesOf, isLegacyHandle } from './legacy/node-access'
import { textWidthPx } from './measure'
import {
  getArray,
  getBlockVariables,
  getNestedString,
  getRecord,
  getString,
  inOutVariableNames,
  isRecord,
} from './node-data'
import { type LdBlock, type LdCell, type LdElement, type LdGroup, type LdNetwork, readRungStructure } from './structure'
import { LADDER_STYLE, LADDER_TYPOGRAPHY } from './style'
import type {
  BranchFiller,
  LabelBox,
  LayoutSegment,
  NodeGeometry,
  ParallelBranchLayout,
  ParallelGroupLayout,
  RungLayout,
} from './types'

type LadderStyle = typeof LADDER_STYLE

const T = LADDER_TYPOGRAPHY
/** Height of the name line above a contact or coil. */
const NAME_LINE = T.nameSizePx * 1.25
/** Height of the location line, above a contact or coil and below a pin variable name. */
const LOCATION_LINE = T.locationSizePx * 1.3
/** Height of the instance-name line above a block. */
const INSTANCE_LINE = T.nameSizePx * 1.35
/** Distance from a text's vertical centre down to its baseline, for 12 px text centred on a wire or band. */
const CENTRED_BASELINE = T.nameSizePx * 0.36
/** Space a contact or coil keeps below its glyph. */
const CELL_BELOW = 3
/** Space between a pin variable column and the next column, beyond the stub. */
const SIDE_COLUMN_PAD = 5
/** Gap between the stub end and a pin variable's text. */
const SIDE_LABEL_GAP = 4
/** Gap between an instance name's baseline and the block box. */
const INSTANCE_GAP = 5
/** Extra room beside a block type in the header band. */
const TYPE_PAD = 10
/** Height of a pin variable's name line within its pin row. */
const PIN_NAME_LINE = T.nameSizePx * 1.2
/** Extra height a pin row takes when its pin variable shows a location. */
const LOCATED_ROW_PAD = 3
/** Rise of a contact or coil name's baseline above the bottom of its name line. */
const NAME_BASELINE_RISE = NAME_LINE * 0.24
/** Rise of a contact or coil location's baseline above the label gap. */
const LOCATION_BASELINE_RISE = T.locationSizePx * 0.28
const HANDLE_LIST_KEYS = ['handles', 'inputHandles', 'outputHandles'] as const
const CONNECTOR_KEYS = [
  'inputConnector',
  'outputConnector',
  'parallelInputConnector',
  'parallelOutputConnector',
] as const
const ELEMENT_TYPES: ReadonlySet<string> = new Set(['contact', 'coil', 'block'])

interface Extent {
  w: number
  top: number
  bot: number
}

/** What one side of a block row holds once measured. */
type SideContent =
  | { kind: 'none' }
  | { kind: 'variable'; node: Node; name: string; location: string; width: number }
  | { kind: 'network'; network: LdNetwork; extent: Extent }

interface BlockMeasure extends Extent {
  inner: number
  boxH: number
  rowY: number[]
  left: SideContent[]
  right: SideContent[]
  sideL: number
  sideR: number
  padL: number
  instance: string
  type: string
}

interface GroupMeasure extends Extent {
  branches: Extent[]
  offsets: number[]
  /** Pad before the closing junction: only when a branch ends in a nested group, so their junctions stay apart. */
  closePad: number
}

interface Placed {
  entryX: number
  exitX: number
  nodeIds: string[]
}

/** A placed series with the column each of its elements took. */
interface PlacedSeries extends Placed {
  columns: { nodeIds: string[]; x: number; width: number }[]
}

/** Pitch from a pin row to the next: P, or taller when the row's pin variable shows a location. */
const pinRowPitch = (s: LadderStyle, located: boolean): number =>
  located ? Math.ceil(PIN_NAME_LINE + LOCATION_LINE + LOCATED_ROW_PAD) : s.P

/** True when a pin variable on either side of the row shows a location. */
const rowLocated = (left: readonly SideContent[], right: readonly SideContent[], row: number): boolean =>
  [left[row], right[row]].some((content) => content?.kind === 'variable' && content.location !== '')

/** The variable name an element shows: `data.variable.name`, or empty. */
const nameOf = (node: Node): string => getNestedString(node.data, 'variable', 'name') ?? ''

/** The location text an element shows, or empty when its variable has none. */
function locationOf(name: string, src: LadderLabelSource): string {
  const label = resolveLocationLabel(name, src)
  return label.kind === 'none' ? '' : label.text
}

const isCoilGroup = (group: LdGroup): boolean =>
  group.branches.every(
    (branch) =>
      branch.length > 0 &&
      branch.every((element) =>
        element.kind === 'cell' ? element.node.type === 'coil' : element.kind === 'group' && isCoilGroup(element),
      ),
  )

const isTrailingOutput = (element: LdElement): boolean =>
  element.kind === 'cell' ? element.node.type === 'coil' : element.kind === 'group' && isCoilGroup(element)

/** Measures and places one rung's elements, collecting geometry, labels, groups and fillers. */
class RungLayoutBuilder {
  readonly nodes = new Map<string, NodeGeometry>()
  readonly labels = new Map<string, LabelBox[]>()
  readonly parallels: ParallelGroupLayout[] = []
  readonly fillers: BranchFiller[] = []
  readonly railHandleY = new Map<string, number>()
  private readonly cellExtents = new Map<LdCell, Extent>()
  private readonly blockMeasures = new Map<LdBlock, BlockMeasure>()
  private readonly groupMeasures = new Map<LdGroup, GroupMeasure>()
  private readonly endAligned = new Set<LdGroup>()
  private readonly cellTop: number
  private readonly cellBottom: number
  private readonly firstRow: number

  constructor(
    private readonly src: LadderLabelSource,
    private readonly s: LadderStyle,
  ) {
    this.cellTop = s.symH / 2 + s.labGap + LOCATION_LINE + NAME_LINE
    this.cellBottom = s.symH / 2 + CELL_BELOW
    this.firstRow = s.blkHead + s.P / 2
  }

  alignToEnd(group: LdGroup): void {
    this.endAligned.add(group)
    // Parallel coils share the widest coil's column, so their centred symbols and names line up vertically.
    const coils = group.branches
      .flat()
      .filter((element): element is LdCell => element.kind === 'cell' && element.node.type === 'coil')
    if (coils.length < 2) return
    const widest = Math.max(...coils.map((coil) => this.cell(coil).w))
    for (const coil of coils) this.cellExtents.set(coil, { ...this.cell(coil), w: widest })
    this.groupMeasures.clear()
  }

  /** Width and extents above and below the wire of a series; a block's pin networks clear what precedes it. */
  series(elements: readonly LdElement[]): Extent {
    let w = 0
    let top = 0
    let bot = 0
    for (const element of elements) {
      const extent = this.element(element, bot)
      w += extent.w
      top = Math.max(top, extent.top)
      bot = Math.max(bot, extent.bot)
    }
    return { w, top, bot }
  }

  element(element: LdElement, precedingBottom = 0): Extent {
    switch (element.kind) {
      case 'cell':
        return this.cell(element)
      case 'block':
        return this.block(element, precedingBottom)
      case 'group':
        return this.group(element)
      default: {
        const unreachable: never = element
        return unreachable
      }
    }
  }

  private cell(cell: LdCell): Extent {
    const cached = this.cellExtents.get(cell)
    if (cached !== undefined) return cached
    const name = nameOf(cell.node)
    const location = locationOf(name, this.src)
    const width = Math.max(textWidthPx(name, T.nameSizePx), textWidthPx(location, T.locationSizePx), this.s.sym)
    const extent = { w: width + 2 * this.s.gap, top: this.cellTop, bot: this.cellBottom }
    this.cellExtents.set(cell, extent)
    return extent
  }

  private group(group: LdGroup): GroupMeasure {
    const cached = this.groupMeasures.get(group)
    if (cached !== undefined) return cached
    const branches = group.branches.map((branch) => this.series(branch))
    const offsets = [0]
    for (let index = 1; index < branches.length; index++) {
      offsets.push(offsets[index - 1] + branches[index - 1].bot + this.s.branchGap + branches[index].top)
    }
    const widest = Math.max(0, ...branches.map((branch) => branch.w))
    const last = branches.length - 1
    const closePad = group.branches.some((branch) => branch[branch.length - 1]?.kind === 'group') ? this.s.parPad : 0
    const measure: GroupMeasure = {
      // The closing junction sits at the end of the widest branch, unless a nested group closes there.
      w: widest + this.s.parPad + closePad,
      closePad,
      top: branches[0]?.top ?? 0,
      bot: (offsets[last] ?? 0) + (branches[last]?.bot ?? 0),
      branches,
      offsets,
    }
    this.groupMeasures.set(group, measure)
    return measure
  }

  /** The content of one side of a row: a pin variable box, a pin network, or nothing. */
  private sideContent(pin: LdBlock['rows'][number]['input']): SideContent {
    if (pin?.network !== undefined)
      return { kind: 'network', network: pin.network, extent: this.series(pin.network.elements) }
    if (pin?.variable === undefined) return { kind: 'none' }
    const name = nameOf(pin.variable)
    const location = locationOf(name, this.src)
    const width = Math.max(textWidthPx(name, T.nameSizePx), textWidthPx(location, T.locationSizePx))
    return { kind: 'variable', node: pin.variable, name, location, width }
  }

  /** Extent of a side content above and below its pin wire. */
  private contentExtent(content: SideContent): { top: number; bot: number } {
    switch (content.kind) {
      case 'none':
        return { top: 0, bot: 0 }
      case 'variable':
        return { top: this.s.P / 2, bot: pinRowPitch(this.s, content.location !== '') - this.s.P / 2 }
      case 'network':
        return { top: content.extent.top, bot: content.extent.bot }
      default: {
        const unreachable: never = content
        return unreachable
      }
    }
  }

  /** Width a side needs: its pin variable column, or its widest pin network and the stub to the pin. */
  private sideWidth(contents: readonly SideContent[]): number {
    let labels = -1
    let networks = 0
    for (const content of contents) {
      if (content.kind === 'variable') labels = Math.max(labels, content.width)
      if (content.kind === 'network') networks = Math.max(networks, content.extent.w + this.s.stub)
    }
    return Math.max(labels < 0 ? 0 : labels + this.s.stub + SIDE_COLUMN_PAD, networks)
  }

  /** Pin row offsets from the first row: pitch P, taller for a located row, and room for pin networks. */
  private rowOffsets(left: readonly SideContent[], right: readonly SideContent[], precedingBottom: number): number[] {
    const rowY = [0]
    const lastBottom = [0, 0]
    const networkBottom = [-Infinity, -Infinity]
    const record = (row: number): void => {
      ;[left[row], right[row]].forEach((content, side) => {
        if (content === undefined) return
        const bottom = rowY[row] + this.contentExtent(content).bot
        lastBottom[side] = Math.max(lastBottom[side], bottom)
        if (content.kind === 'network') networkBottom[side] = Math.max(networkBottom[side], bottom)
      })
    }
    record(0)
    for (let row = 1; row < left.length; row++) {
      let y = rowY[row - 1] + pinRowPitch(this.s, rowLocated(left, right, row - 1))
      ;[left[row], right[row]].forEach((content, side) => {
        if (content === undefined) return
        const { top } = this.contentExtent(content)
        if (content.kind === 'network') {
          const above = side === 0 ? Math.max(lastBottom[side], precedingBottom) : lastBottom[side]
          y = Math.max(y, above + this.s.branchGap + top)
        } else if (content.kind === 'variable' && networkBottom[side] > -Infinity) {
          y = Math.max(y, networkBottom[side] + this.s.branchGap + top)
        }
      })
      rowY.push(y)
      record(row)
    }
    return rowY
  }

  private block(block: LdBlock, precedingBottom: number): BlockMeasure {
    const cached = this.blockMeasures.get(block)
    if (cached !== undefined) return cached
    const { node } = block
    const s = this.s
    const inOut = inOutVariableNames(getBlockVariables(node.data))
    const formalWidth = (pin: string, side: 'in' | 'out'): number =>
      textWidthPx(pin, T.pinFormalSizePx) + (side === 'in' && inOut.has(pin) ? IN_OUT_MARKER_WIDTH : 0)
    const inputs = block.rows.flatMap((row) => (row.input === undefined ? [] : [row.input.handleId]))
    const outputs = block.rows.flatMap((row) => (row.output === undefined ? [] : [row.output.handleId]))
    const inW = Math.max(0, ...inputs.map((pin) => formalWidth(pin, 'in')))
    const outW = Math.max(0, ...outputs.map((pin) => formalWidth(pin, 'out')))
    const type = getNestedString(node.data, 'variant', 'name') ?? ''
    const instance = nameOf(node)
    const inner = Math.max(
      2 * s.blkPad + inW + s.blkMid + outW,
      textWidthPx(type, T.nameSizePx) + 2 * s.blkPad + TYPE_PAD,
    )
    const left = block.rows.map((row) => this.sideContent(row.input))
    const right = block.rows.map((row) => this.sideContent(row.output))
    const rowY = this.rowOffsets(left, right, precedingBottom)
    const last = rowY.length - 1
    const boxH = s.blkHead + s.P / 2 + rowY[last] + (pinRowPitch(s, rowLocated(left, right, last)) - s.P / 2) + s.blkBot
    const sideL = this.sideWidth(left)
    const sideR = this.sideWidth(right)
    const half = textWidthPx(instance, T.nameSizePx) / 2
    const padL = Math.max(0, half - (sideL + inner / 2))
    const padR = Math.max(0, half - (inner / 2 + sideR))
    let bot = boxH - this.firstRow
    for (let row = 0; row <= last; row++) {
      for (const content of [left[row], right[row]]) bot = Math.max(bot, rowY[row] + this.contentExtent(content).bot)
    }
    const measure: BlockMeasure = {
      w: 2 * s.gapBlk + padL + sideL + inner + sideR + padR,
      top: (instance === '' ? 0 : INSTANCE_LINE) + this.firstRow,
      bot,
      inner,
      boxH,
      rowY,
      left,
      right,
      sideL,
      sideR,
      padL,
      instance,
      type,
    }
    this.blockMeasures.set(block, measure)
    return measure
  }

  private label(nodeId: string, box: LabelBox): void {
    this.labels.set(nodeId, [...(this.labels.get(nodeId) ?? []), box])
  }

  /** Places a series from `x` on the wire at `y`; returns where its wire enters and leaves, its node ids and columns. */
  placeSeries(elements: readonly LdElement[], x: number, y: number, depth: number): PlacedSeries {
    const nodeIds: string[] = []
    const columns: PlacedSeries['columns'] = []
    let cursor = x
    let entryX = x
    let exitX = x
    let precedingBottom = 0
    elements.forEach((element, index) => {
      const extent = this.element(element, precedingBottom)
      const placed = this.placeElement(element, cursor, y, depth, precedingBottom)
      if (index === 0) entryX = placed.entryX
      exitX = placed.exitX
      nodeIds.push(...placed.nodeIds)
      columns.push({ nodeIds: placed.nodeIds, x: cursor, width: extent.w })
      cursor += extent.w
      precedingBottom = Math.max(precedingBottom, extent.bot)
    })
    return { entryX, exitX, nodeIds, columns }
  }

  placeElement(element: LdElement, x: number, y: number, depth: number, precedingBottom = 0): Placed {
    switch (element.kind) {
      case 'cell':
        return this.placeCell(element, x, y)
      case 'block':
        return this.placeBlock(element, x, y, depth, precedingBottom)
      case 'group':
        return this.placeGroup(element, x, y, depth)
      default: {
        const unreachable: never = element
        return unreachable
      }
    }
  }

  private placeCell(cell: LdCell, x: number, y: number): Placed {
    const s = this.s
    const { node } = cell
    const extent = this.cell(cell)
    const glyphX = x + extent.w / 2 - s.sym / 2
    const centreX = glyphX + s.sym / 2
    const input = getRecord(node.data, 'inputConnector')?.id
    this.nodes.set(node.id, {
      position: { x: glyphX, y: y - s.symH / 2 },
      width: s.sym,
      height: s.symH,
      handles: storedHandles(node).map((handle) => ({
        id: handle.id,
        x: handle.id === input || handle.side === 'left' ? 0 : s.sym,
        y: s.symH / 2,
      })),
    })
    const name = nameOf(node)
    const location = locationOf(name, this.src)
    const glyphTop = y - s.symH / 2
    this.label(node.id, {
      text: name,
      x: centreX,
      y: glyphTop - s.labGap - LOCATION_LINE - NAME_BASELINE_RISE,
      sizePx: T.nameSizePx,
      weight: 400,
      anchor: 'middle',
      role: 'name',
    })
    if (location !== '') {
      this.label(node.id, {
        text: location,
        x: centreX,
        y: glyphTop - s.labGap - LOCATION_BASELINE_RISE,
        sizePx: T.locationSizePx,
        weight: 400,
        anchor: 'middle',
        role: 'location',
      })
    }
    return { entryX: glyphX, exitX: glyphX + s.sym, nodeIds: [node.id] }
  }

  private placeBlock(block: LdBlock, x: number, y: number, depth: number, precedingBottom: number): Placed {
    const s = this.s
    const m = this.block(block, precedingBottom)
    const { node } = block
    const x0 = x + s.gapBlk + m.padL + m.sideL
    const x1 = x0 + m.inner
    const top = y - this.firstRow
    const rowOf = new Map<string, number>()
    block.rows.forEach((row, index) => {
      if (row.input !== undefined) rowOf.set(`in\u0000${row.input.handleId}`, index)
      if (row.output !== undefined) rowOf.set(`out\u0000${row.output.handleId}`, index)
    })
    this.nodes.set(node.id, {
      position: { x: x0, y: top },
      width: m.inner,
      height: m.boxH,
      handles: storedHandles(node).map((handle) => {
        const output = rowOf.get(`out\u0000${handle.id}`)
        const input = rowOf.get(`in\u0000${handle.id}`)
        if (output !== undefined) return { id: handle.id, x: m.inner, y: this.firstRow + m.rowY[output] }
        return { id: handle.id, x: 0, y: this.firstRow + m.rowY[input ?? 0] }
      }),
    })
    const nodeIds = [node.id]
    if (m.instance !== '') {
      this.label(node.id, {
        text: m.instance,
        x: x0 + m.inner / 2,
        y: top - INSTANCE_GAP,
        sizePx: T.nameSizePx,
        weight: 400,
        anchor: 'middle',
        role: 'instance',
      })
    }
    this.label(node.id, {
      text: m.type,
      x: x0 + s.blkPad,
      y: top + s.blkHead / 2 + CENTRED_BASELINE,
      sizePx: T.nameSizePx,
      weight: 600,
      anchor: 'start',
      role: 'blockType',
    })
    block.rows.forEach((row, index) => {
      const pinY = y + m.rowY[index]
      for (const [pin, anchor, formalX] of [
        [row.input, 'start', x0 + s.blkPad],
        [row.output, 'end', x1 - s.blkPad],
      ] as const) {
        if (pin === undefined) continue
        this.label(node.id, {
          text: pin.handleId,
          x: formalX,
          y: pinY + CENTRED_BASELINE,
          sizePx: T.pinFormalSizePx,
          weight: 400,
          anchor,
          role: 'pinFormal',
        })
      }
      nodeIds.push(...this.placeSide(m.left[index], 'left', x0, pinY, m.sideL, depth))
      nodeIds.push(...this.placeSide(m.right[index], 'right', x1, pinY, m.sideR, depth))
    })
    return { entryX: x0, exitX: x1, nodeIds }
  }

  /** Places what one side of a pin row holds, against the box edge `edgeX`; returns the node ids it placed. */
  private placeSide(
    content: SideContent,
    side: 'left' | 'right',
    edgeX: number,
    pinY: number,
    sideWidth: number,
    depth: number,
  ): string[] {
    const s = this.s
    switch (content.kind) {
      case 'none':
        return []
      case 'network': {
        const startX = side === 'left' ? edgeX - s.stub - content.extent.w : edgeX + s.stub
        const placed = this.placeSeries(content.network.elements, startX, pinY, depth)
        if (content.network.railHandleId !== undefined) this.railHandleY.set(content.network.railHandleId, pinY)
        return placed.nodeIds
      }
      case 'variable': {
        const width = sideWidth - s.stub
        const height = pinRowPitch(s, content.location !== '')
        const boxX = side === 'left' ? edgeX - sideWidth : edgeX + s.stub
        this.nodes.set(content.node.id, {
          position: { x: boxX, y: pinY - s.P / 2 },
          width,
          height,
          handles: storedHandles(content.node).map((handle) => ({
            id: handle.id,
            x: side === 'left' ? width : 0,
            y: s.P / 2,
          })),
        })
        const textX = side === 'left' ? edgeX - s.stub - SIDE_LABEL_GAP : edgeX + s.stub + SIDE_LABEL_GAP
        const anchor = side === 'left' ? 'end' : 'start'
        this.label(content.node.id, {
          text: content.name,
          x: textX,
          y: pinY + CENTRED_BASELINE,
          sizePx: T.nameSizePx,
          weight: 400,
          anchor,
          role: 'pinVariable',
        })
        if (content.location !== '') {
          this.label(content.node.id, {
            text: content.location,
            x: textX,
            y: pinY + CENTRED_BASELINE + LOCATION_LINE,
            sizePx: T.locationSizePx,
            weight: 400,
            anchor,
            role: 'location',
          })
        }
        return [content.node.id]
      }
      default: {
        const unreachable: never = content
        return unreachable
      }
    }
  }

  private placeGroup(group: LdGroup, x: number, y: number, depth: number): Placed {
    const s = this.s
    const m = this.group(group)
    const alignment = this.endAligned.has(group) ? 'end' : 'start'
    const openX = x
    const closeX = x + m.w
    const branchY = m.offsets.map((offset) => y + offset)
    const branches: ParallelBranchLayout[] = []
    const layout: ParallelGroupLayout = {
      openNodeIds: group.opens.map((node) => node.id),
      closeNodeIds: group.closes.map((node) => node.id),
      openX,
      closeX,
      yTop: branchY[0],
      yBottom: branchY[branchY.length - 1],
      depth,
      alignment,
      branches,
    }
    this.parallels.push(layout)
    const nodeIds = group.opens.map((node) => node.id)
    group.opens.forEach((node, index) => this.placeJunction(node, openX, branchY[index]))
    group.closes.forEach((node, index) => this.placeJunction(node, closeX, branchY[index]))
    group.branches.forEach((branch, index) => {
      const startX = alignment === 'end' ? closeX - m.closePad - m.branches[index].w : openX + s.parPad
      const placed = this.placeSeries(branch, startX, branchY[index], depth + 1)
      const endX = branch.length === 0 ? startX : placed.exitX
      branches.push({ nodeIds: placed.nodeIds, y: branchY[index], startX, endX })
      nodeIds.push(...placed.nodeIds)
      const closeNodeId = group.closes[Math.min(index, group.closes.length - 1)].id
      this.fillers.push(
        alignment === 'end'
          ? {
              closeNodeId,
              branchIndex: index,
              side: 'before',
              y: branchY[index],
              x1: openX,
              x2: branch.length === 0 ? startX : placed.entryX,
            }
          : { closeNodeId, branchIndex: index, side: 'after', y: branchY[index], x1: endX, x2: closeX },
      )
    })
    nodeIds.push(...group.closes.map((node) => node.id))
    return { entryX: openX, exitX: closeX, nodeIds }
  }

  /** A parallel node is a point on its junction line, at its top branch's wire. */
  private placeJunction(node: Node, x: number, y: number): void {
    this.nodes.set(node.id, {
      position: { x, y },
      width: 0,
      height: 0,
      handles: storedHandles(node).map((handle) => ({ id: handle.id, x: 0, y: 0 })),
    })
  }
}

/** A node's stored handles with string ids and the side they face. */
function storedHandles(node: Node): { id: string; side: string | undefined }[] {
  return handlesOf(node.data, 'handles').flatMap((handle) => {
    const id = handleIdOf(handle)
    return id === undefined ? [] : [{ id, side: getString(handle, 'position') }]
  })
}

/** The geometry a node already has, for a node the layout does not reach. */
function currentGeometry(node: Node): NodeGeometry {
  const handles = getArray(node.data, 'handles') ?? []
  return {
    position: { x: node.position?.x ?? 0, y: node.position?.y ?? 0 },
    width: node.width ?? node.measured?.width ?? 0,
    height: node.height ?? node.measured?.height ?? 0,
    handles: handles.flatMap((handle) => {
      if (!isLegacyHandle(handle)) return []
      const id = handleIdOf(handle)
      if (id === undefined) return []
      const rel = getRecord(handle, 'relPosition')
      return [
        {
          id,
          x: typeof rel?.x === 'number' ? rel.x : handle.glbPosition.x - (node.position?.x ?? 0),
          y: typeof rel?.y === 'number' ? rel.y : handle.glbPosition.y - (node.position?.y ?? 0),
        },
      ]
    }),
  }
}

/**
 * Lays a rung out with the compact LD geometry: label-aware columns, location lines, block pin rows and parallel
 * groups whose branches span the widest branch. Pure and deterministic.
 */
export function layoutRung(
  rung: RungLadderState,
  src: LadderLabelSource,
  style: LadderStyle = LADDER_STYLE,
): RungLayout {
  const structure = readRungStructure(rung)
  const builder = new RungLayoutBuilder(src, style)
  const { main } = structure
  let trailingFrom = main.length
  while (trailingFrom > 0 && isTrailingOutput(main[trailingFrom - 1])) trailingFrom--
  for (const element of main.slice(trailingFrom)) if (element.kind === 'group') builder.alignToEnd(element)

  const extent = builder.series(main)
  const mainWireY = style.padT + extent.top
  const width = extent.w
  const height = style.padT + extent.top + extent.bot + style.padB

  const { columns } = builder.placeSeries(main, 0, mainWireY, 0)
  const trailing = columns.slice(trailingFrom)
  const trailingOutputIds = trailing.flatMap((column) => column.nodeIds)
  const segments: LayoutSegment[] = columns.slice(0, trailingFrom)
  if (trailing.length > 0) {
    segments.push({
      nodeIds: trailingOutputIds,
      x: trailing[0].x,
      width: trailing.reduce((sum, column) => sum + column.width, 0),
    })
  }

  const nodes = new Map<string, NodeGeometry>()
  for (const node of rung.nodes) {
    const placed = builder.nodes.get(node.id)
    if (placed !== undefined) {
      nodes.set(node.id, placed)
      continue
    }
    if (node === structure.leftRail || node === structure.rightRail) {
      nodes.set(node.id, {
        position: { x: node === structure.leftRail ? 0 : width, y: 0 },
        width: 0,
        height,
        handles: storedHandles(node).map((handle) => ({
          id: handle.id,
          x: 0,
          y: builder.railHandleY.get(handle.id) ?? mainWireY,
        })),
      })
      continue
    }
    nodes.set(node.id, currentGeometry(node))
  }

  const elementCount = rung.nodes.filter((node) => ELEMENT_TYPES.has(node.type ?? '')).length
  return {
    rungId: rung.id,
    nodes,
    labels: builder.labels,
    size: { width, height },
    mainWireY,
    rightRailId: structure.rightRail?.id,
    trailingOutputIds,
    segments:
      elementCount > MAX_REDUCIBLE_ELEMENTS ? [{ nodeIds: rung.nodes.map((node) => node.id), x: 0, width }] : segments,
    parallels: builder.parallels,
    branchFillers: builder.fillers,
  }
}

/** A stored handle entry moved to the layout's position for its id; entries the layout has no position for are kept. */
function movedHandle(
  entry: unknown,
  geometry: NodeGeometry,
  byId: ReadonlyMap<string, { x: number; y: number }>,
): unknown {
  if (!isRecord(entry) || typeof entry.id !== 'string') return entry
  const handle = byId.get(entry.id)
  if (handle === undefined) return entry
  return {
    ...entry,
    glbPosition: { x: geometry.position.x + handle.x, y: geometry.position.y + handle.y },
    relPosition: { x: handle.x, y: handle.y },
  }
}

/** `node.data` with every stored handle and connector at the layout's handle positions. */
function dataWithHandles(data: Record<string, unknown>, geometry: NodeGeometry): Record<string, unknown> {
  const byId = new Map(geometry.handles.map((handle) => [handle.id, { x: handle.x, y: handle.y }]))
  const next: Record<string, unknown> = { ...data }
  for (const key of HANDLE_LIST_KEYS) {
    const list = getArray(data, key)
    if (list !== undefined) next[key] = list.map((entry) => movedHandle(entry, geometry, byId))
  }
  for (const key of CONNECTOR_KEYS) {
    if (key in data) next[key] = movedHandle(data[key], geometry, byId)
  }
  return next
}

/**
 * The rung with the layout stored: node positions, sizes (and xyflow's `measured`), handle positions, and the natural
 * size as `defaultBounds` and `reactFlowViewport`. Ids, node and edge order, edges and every other field are kept.
 */
export function applyRungLayout(rung: RungLadderState, layout: RungLayout): RungLadderState {
  return {
    ...rung,
    defaultBounds: [layout.size.width, layout.size.height],
    reactFlowViewport: [layout.size.width, layout.size.height],
    nodes: rung.nodes.map((node) => {
      const geometry = layout.nodes.get(node.id)
      if (geometry === undefined) return node
      return {
        ...node,
        position: { x: geometry.position.x, y: geometry.position.y },
        width: geometry.width,
        height: geometry.height,
        measured: { width: geometry.width, height: geometry.height },
        data: dataWithHandles(node.data, geometry),
      }
    }),
  }
}

const near = (a: unknown, b: number, tolPx: number): boolean => typeof a === 'number' && Math.abs(a - b) <= tolPx

/** True when a stored point is missing or more than `tolPx` from `x`, `y` on either axis. */
function pointDiffers(point: unknown, x: number, y: number, tolPx: number): boolean {
  return !isRecord(point) || !near(point.x, x, tolPx) || !near(point.y, y, tolPx)
}

/** True when any stored handle entry of a node is away from the layout's position for its id. */
function handlesDiffer(node: Node, geometry: NodeGeometry, tolPx: number): boolean {
  const entries: unknown[] = [
    ...HANDLE_LIST_KEYS.flatMap((key) => getArray(node.data, key) ?? []),
    ...CONNECTOR_KEYS.map((key) => node.data[key]),
  ]
  return geometry.handles.some((handle) =>
    entries.some(
      (entry) =>
        isRecord(entry) &&
        entry.id === handle.id &&
        (pointDiffers(entry.relPosition, handle.x, handle.y, tolPx) ||
          pointDiffers(entry.glbPosition, geometry.position.x + handle.x, geometry.position.y + handle.y, tolPx)),
    ),
  )
}

/**
 * True when the stored rung is away from the layout by more than `tolPx`: a node's position, width, height or handle
 * position, the saved height in `reactFlowViewport`, or `defaultBounds`.
 */
export function rungLayoutDiffers(rung: RungLadderState, layout: RungLayout, tolPx = 0.5): boolean {
  if (!near(rung.reactFlowViewport[1], layout.size.height, tolPx)) return true
  if (!near(rung.defaultBounds[0], layout.size.width, tolPx) || !near(rung.defaultBounds[1], layout.size.height, tolPx))
    return true
  return rung.nodes.some((node) => {
    const geometry = layout.nodes.get(node.id)
    if (geometry === undefined) return true
    return (
      pointDiffers(node.position, geometry.position.x, geometry.position.y, tolPx) ||
      !near(node.width, geometry.width, tolPx) ||
      !near(node.height, geometry.height, tolPx) ||
      handlesDiffer(node, geometry, tolPx)
    )
  })
}
