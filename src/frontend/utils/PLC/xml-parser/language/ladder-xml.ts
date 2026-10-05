import {
  defaultCustomNodesStyles,
  nodesBuilder,
} from '@root/frontend/components/_atoms/graphical-editor/ladder/node-builders'
import {
  BlockNode,
  BlockVariant,
  CoilNode,
  ContactNode,
  LadderBlockConnectedVariables,
  ParallelNode,
  PowerRailNode,
  VariableNode,
} from '@root/frontend/components/_atoms/graphical-editor/ladder/utils/types'
import { buildEdge } from '@root/frontend/components/_molecules/graphical-editor/ladder/rung/ladder-utils/edges'
import { updateDiagramElementsPosition } from '@root/frontend/components/_molecules/graphical-editor/ladder/rung/ladder-utils/elements/diagram'
import { LadderFlowType, RungLadderState } from '@root/frontend/store/slices'
import { newUuid } from '@root/frontend/utils/new-uuid'
import {
  classifyBlockVariables,
  rebuildVariablesForInputCount,
} from '@root/frontend/utils/PLC/extensible-block-variables'
import { Edge, Position } from '@xyflow/react'

import type { BlockSignature, BlockSignatureResolver } from '../block-signatures'
import { asArray, asRecord, asString } from '../xml-node'
import { makeHandle, parsePositionXml, toNumber } from './geometry'
import { reduceSeriesParallel, SeriesParallel, SeriesParallelWire, SINK, SOURCE } from './series-parallel'

type LadderParsedNode = PowerRailNode | ContactNode | CoilNode | BlockNode<BlockVariant> | VariableNode

// Reverse of xml-generator/old-editor/language/ladder-xml.ts. Greenfield (no
// PLCopen import reference existed anywhere before this) — reconstructed by
// reading that generator's findConnections/blockToXml/etc. in full.
//
// Handle ids are literal and stable in this dialect (unlike FBD's invented
// sentinels): power rails use "left-rail"/"right-rail", contacts/coils/leaf
// variable nodes use "input"/"output", blocks use their formal parameter
// names — confirmed directly from the generator (leftRailToXML/
// contactToXML/coilToXml never derive these from anything else).
const RAIL_OUTPUT_HANDLE = 'left-rail'
const RAIL_INPUT_HANDLE = 'right-rail'
const LEAF_INPUT_HANDLE = 'input'
const LEAF_OUTPUT_HANDLE = 'output'

// A plain function's single unnamed return pin has the domain handle id
// 'OUT', which the generator's findConnections collapses to an empty
// `@formalParameter` string on export (`sourceHandle === 'OUT' ? '' : ...`,
// ladder-xml.ts) — reversed here. `@formalParameter` is otherwise always
// present on a <connection> built by findConnections (rightPowerRail/
// contact/coil/block); it is omitted entirely only on the one bespoke path
// where a block's input pin is wired directly to a named <inVariable> node
// (blockToXml's "connected to an existing variable node" branch) — that
// case has no attribute to read at all, so its source handle defaults to
// the leaf output handle below.
const UNNAMED_FUNCTION_RETURN_HANDLE = 'OUT'

// A contact's/coil's own `<variable>Name</variable>` text child shares its
// tag name with the interface/block-pin `<variable>` LISTS the shared
// parser config (parse-xml-document.ts) always force-arrays — so it arrives
// here wrapped in a one-item array, not a plain string. Unwrap defensively.
function parseBoundVariableName(value: unknown): string {
  // Array.isArray narrows `unknown` to `any[]`, not `unknown[]` — re-widen
  // explicitly so the extracted element stays type-safe.
  const first: unknown = Array.isArray(value) ? (value as unknown[])[0] : value
  return asString(first)
}

// A block's <connection> (or contact/coil/rail's) may reference a node that
// appears later in the XML, so all nodes are built first and edges are
// resolved in a second pass against this pending list.
interface PendingEdge {
  targetNumericId: string
  targetHandle: string
  sourceRefLocalId: string
  sourceFormalParameter: string | undefined
}

function parseConnectionXml(connXml: unknown, targetNumericId: string, targetHandle: string): PendingEdge {
  const conn = asRecord(connXml)
  const hasFormalParameter = '@formalParameter' in conn
  const raw = asString(conn['@formalParameter'])
  return {
    targetNumericId,
    targetHandle,
    sourceRefLocalId: asString(conn['@refLocalId']),
    sourceFormalParameter: hasFormalParameter ? (raw === '' ? UNNAMED_FUNCTION_RETURN_HANDLE : raw) : undefined,
  }
}

function parseLeftRailXml(entry: Record<string, unknown>): PowerRailNode {
  const numericId = asString(entry['@localId'])
  const position = parsePositionXml(entry.position)
  const outputHandle = makeHandle(
    RAIL_OUTPUT_HANDLE,
    'source',
    Position.Right,
    position,
    asRecord(entry.connectionPointOut).relPosition,
  )

  return {
    id: `LEFT-POWER-RAIL-${numericId}`,
    type: 'powerRail',
    position,
    width: toNumber(entry['@width']),
    height: toNumber(entry['@height']),
    draggable: true,
    selectable: true,
    data: {
      handles: [outputHandle],
      inputHandles: [],
      outputHandles: [outputHandle],
      inputConnector: undefined,
      outputConnector: outputHandle,
      numericId,
      variable: { name: '' },
      executionOrder: 0,
      draggable: true,
      selectable: true,
      deletable: true,
      variant: 'left',
    },
  }
}

function parseRightRailXml(entry: Record<string, unknown>): { node: PowerRailNode; pendingEdges: PendingEdge[] } {
  const numericId = asString(entry['@localId'])
  const position = parsePositionXml(entry.position)
  const connIn = asRecord(entry.connectionPointIn)
  const inputHandle = makeHandle(RAIL_INPUT_HANDLE, 'target', Position.Left, position, connIn.relPosition)
  const pendingEdges = asArray(connIn.connection).map((connRaw) =>
    parseConnectionXml(connRaw, numericId, RAIL_INPUT_HANDLE),
  )

  const node: PowerRailNode = {
    id: `RIGHT-POWER-RAIL-${numericId}`,
    type: 'powerRail',
    position,
    width: toNumber(entry['@width']),
    height: toNumber(entry['@height']),
    draggable: true,
    selectable: true,
    data: {
      handles: [inputHandle],
      inputHandles: [inputHandle],
      outputHandles: [],
      inputConnector: inputHandle,
      outputConnector: undefined,
      numericId,
      variable: { name: '' },
      executionOrder: 0,
      draggable: true,
      selectable: true,
      deletable: true,
      variant: 'right',
    },
  }

  return { node, pendingEdges }
}

// @negated/@edge(/@storage for coils) are independent XML attributes mapped
// onto one mutually-exclusive domain variant enum; the generator only ever
// emits one of them at a time (its own ternary chains enforce that), but
// nothing in the XML shape prevents a foreign document from setting more
// than one — priority storage > negated > edge is an arbitrary, documented
// call for that (currently unseen-in-fixtures) case.
function parseCoilVariant(
  entry: Record<string, unknown>,
): 'default' | 'negated' | 'risingEdge' | 'fallingEdge' | 'set' | 'reset' {
  const storage = entry['@storage']
  if (storage === 'set') return 'set'
  if (storage === 'reset') return 'reset'
  if (asString(entry['@negated']) === 'true') return 'negated'
  if (entry['@edge'] === 'rising') return 'risingEdge'
  if (entry['@edge'] === 'falling') return 'fallingEdge'
  return 'default'
}

function parseContactVariant(entry: Record<string, unknown>): 'default' | 'negated' | 'risingEdge' | 'fallingEdge' {
  if (asString(entry['@negated']) === 'true') return 'negated'
  if (entry['@edge'] === 'rising') return 'risingEdge'
  if (entry['@edge'] === 'falling') return 'fallingEdge'
  return 'default'
}

function parseContactXml(entry: Record<string, unknown>): { node: ContactNode; pendingEdges: PendingEdge[] } {
  const numericId = asString(entry['@localId'])
  const position = parsePositionXml(entry.position)
  const connIn = asRecord(entry.connectionPointIn)
  const inputHandle = makeHandle(LEAF_INPUT_HANDLE, 'target', Position.Left, position, connIn.relPosition)
  const outputHandle = makeHandle(
    LEAF_OUTPUT_HANDLE,
    'source',
    Position.Right,
    position,
    asRecord(entry.connectionPointOut).relPosition,
  )
  const pendingEdges = asArray(connIn.connection).map((connRaw) =>
    parseConnectionXml(connRaw, numericId, LEAF_INPUT_HANDLE),
  )

  const node: ContactNode = {
    id: `CONTACT-${numericId}`,
    type: 'contact',
    position,
    width: toNumber(entry['@width']),
    height: toNumber(entry['@height']),
    draggable: true,
    selectable: true,
    data: {
      handles: [inputHandle, outputHandle],
      inputHandles: [inputHandle],
      outputHandles: [outputHandle],
      inputConnector: inputHandle,
      outputConnector: outputHandle,
      numericId,
      variable: { name: parseBoundVariableName(entry.variable) },
      executionOrder: 0,
      draggable: true,
      selectable: true,
      deletable: true,
      variant: parseContactVariant(entry),
    },
  }

  return { node, pendingEdges }
}

function parseCoilXml(entry: Record<string, unknown>): { node: CoilNode; pendingEdges: PendingEdge[] } {
  const numericId = asString(entry['@localId'])
  const position = parsePositionXml(entry.position)
  const connIn = asRecord(entry.connectionPointIn)
  const inputHandle = makeHandle(LEAF_INPUT_HANDLE, 'target', Position.Left, position, connIn.relPosition)
  const outputHandle = makeHandle(
    LEAF_OUTPUT_HANDLE,
    'source',
    Position.Right,
    position,
    asRecord(entry.connectionPointOut).relPosition,
  )
  const pendingEdges = asArray(connIn.connection).map((connRaw) =>
    parseConnectionXml(connRaw, numericId, LEAF_INPUT_HANDLE),
  )

  const node: CoilNode = {
    id: `COIL-${numericId}`,
    type: 'coil',
    position,
    width: toNumber(entry['@width']),
    height: toNumber(entry['@height']),
    draggable: true,
    selectable: true,
    data: {
      handles: [inputHandle, outputHandle],
      inputHandles: [inputHandle],
      outputHandles: [outputHandle],
      inputConnector: inputHandle,
      outputConnector: outputHandle,
      numericId,
      variable: { name: parseBoundVariableName(entry.variable) },
      executionOrder: 0,
      draggable: true,
      selectable: true,
      deletable: true,
      variant: parseCoilVariant(entry),
    },
  }

  return { node, pendingEdges }
}

// One <variable formalParameter="X"> per declared pin (never duplicated
// per-edge the way FBD's block inputs are — findConnections nests every
// matching <connection> inside that single variable's connectionPointIn),
// so — unlike fbd-xml.ts — no formalParameter-grouping/dedup is needed here.
function parseBlockXml(entry: Record<string, unknown>): { node: BlockNode<BlockVariant>; pendingEdges: PendingEdge[] } {
  const numericId = asString(entry['@localId'])
  const position = parsePositionXml(entry.position)
  const instanceName = entry['@instanceName']
  const isFunctionBlock = typeof instanceName === 'string'
  const typeName = asString(entry['@typeName'])

  const inputHandles: BlockNode<BlockVariant>['data']['inputHandles'] = []
  const pendingEdges: PendingEdge[] = []

  for (const varRaw of asArray(asRecord(entry.inputVariables).variable)) {
    const v = asRecord(varRaw)
    const formalParameter = asString(v['@formalParameter'])
    const connIn = asRecord(v.connectionPointIn)
    inputHandles.push(makeHandle(formalParameter, 'target', Position.Left, position, connIn.relPosition))
    for (const connRaw of asArray(connIn.connection)) {
      pendingEdges.push(parseConnectionXml(connRaw, numericId, formalParameter))
    }
  }

  // A plain function's unnamed return pin is declared here as formalParameter=""
  // (see UNNAMED_FUNCTION_RETURN_HANDLE) — translate its own handle id the
  // same way other nodes' connections referencing it will expect.
  const outputHandles: BlockNode<BlockVariant>['data']['outputHandles'] = asArray(
    asRecord(entry.outputVariables).variable,
  ).map((varRaw) => {
    const v = asRecord(varRaw)
    const raw = asString(v['@formalParameter'])
    const handleId = raw === '' ? UNNAMED_FUNCTION_RETURN_HANDLE : raw
    const connOut = asRecord(v.connectionPointOut)
    return makeHandle(handleId, 'source', Position.Right, position, connOut.relPosition)
  })

  const variableName = isFunctionBlock ? asString(instanceName) : typeName

  const node: BlockNode<BlockVariant> = {
    id: `BLOCK-${numericId}`,
    type: 'block',
    position,
    width: toNumber(entry['@width']),
    height: toNumber(entry['@height']),
    draggable: true,
    selectable: true,
    data: {
      handles: [...inputHandles, ...outputHandles],
      inputHandles,
      outputHandles,
      inputConnector: inputHandles[0],
      outputConnector: outputHandles[0],
      numericId,
      variable: { name: variableName },
      executionOrder: toNumber(entry['@executionOrderId']),
      draggable: true,
      selectable: true,
      deletable: true,
      // Full class/type per pin can't be recovered from the LD XML alone
      // (it only ever names pins, never their IEC class/type) — an honest
      // documented gap, same as the FBD importer's block variant.
      variant: {
        name: typeName,
        type: isFunctionBlock ? 'function-block' : 'function',
        variables: [],
        documentation: '',
        extensible: false,
      },
      executionControl: false,
      lockExecutionControl: false,
      connectedVariables: [],
    },
  }

  return { node, pendingEdges }
}

function parseInVariableXml(entry: Record<string, unknown>): VariableNode {
  const numericId = asString(entry['@localId'])
  const position = parsePositionXml(entry.position)
  const outputHandle = makeHandle(
    LEAF_OUTPUT_HANDLE,
    'source',
    Position.Right,
    position,
    asRecord(entry.connectionPointOut).relPosition,
  )

  return {
    id: `INPUT-VARIABLE-${numericId}`,
    type: 'variable',
    position,
    width: toNumber(entry['@width']),
    height: toNumber(entry['@height']),
    draggable: true,
    selectable: true,
    data: {
      handles: [outputHandle],
      inputHandles: [],
      outputHandles: [outputHandle],
      inputConnector: undefined,
      outputConnector: outputHandle,
      numericId,
      variable: { name: asString(entry.expression) },
      executionOrder: 0,
      draggable: true,
      selectable: true,
      deletable: true,
      variant: 'input',
      // Which block/pin this literal feeds can't be recovered here (only
      // the block's own <inputVariables> entry names its source by
      // refLocalId, not the reverse) — left as an honest placeholder; the
      // edge built from that block's connection is the source of truth.
      block: {
        id: '',
        handleId: '',
        variableType: { name: '', class: '', type: { definition: 'base-type', value: '' } },
      },
    },
  }
}

function parseOutVariableXml(entry: Record<string, unknown>): { node: VariableNode; pendingEdges: PendingEdge[] } {
  const numericId = asString(entry['@localId'])
  const position = parsePositionXml(entry.position)
  const connIn = asRecord(entry.connectionPointIn)
  const inputHandle = makeHandle(LEAF_INPUT_HANDLE, 'target', Position.Left, position, connIn.relPosition)
  const connections = asArray(connIn.connection)
  const pendingEdges = connections.map((connRaw) => parseConnectionXml(connRaw, numericId, LEAF_INPUT_HANDLE))

  // outVariableToXML always emits exactly one connection, built directly
  // from data.block.{id,handleId} rather than through findConnections — the
  // one place the generator trusts that bookkeeping over the edge graph.
  // Reversed here: refLocalId/formalParameter identify the source block by
  // numericId, but `block.id` wants the block's own xyflow id, which isn't
  // known until the second pass — left blank and not otherwise relied upon
  // (the edge itself is the source of truth for wiring).
  const firstConnection = asRecord(connections[0])
  const blockHandleId = asString(firstConnection['@formalParameter'])

  return {
    node: {
      id: `OUTPUT-VARIABLE-${numericId}`,
      type: 'variable',
      position,
      width: toNumber(entry['@width']),
      height: toNumber(entry['@height']),
      draggable: true,
      selectable: true,
      data: {
        handles: [inputHandle],
        inputHandles: [inputHandle],
        outputHandles: [],
        inputConnector: inputHandle,
        outputConnector: undefined,
        numericId,
        variable: { name: asString(entry.expression) },
        executionOrder: 0,
        draggable: true,
        selectable: true,
        deletable: true,
        variant: 'output',
        block: {
          id: '',
          handleId: blockHandleId,
          variableType: { name: '', class: '', type: { definition: 'base-type', value: '' } },
        },
      },
    },
    pendingEdges,
  }
}

// Simple union-find for grouping the flat XML's nodes back into rungs (see
// parseLadderXml below for why this is necessary rather than a positional
// grouping).
class UnionFind {
  private readonly parent = new Map<string, string>()

  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x)
    let root = x
    while (this.parent.get(root) !== root) root = this.parent.get(root) as string
    let cur = x
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur) as string
      this.parent.set(cur, root)
      cur = next
    }
    return root
  }

  union(a: string, b: string): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(ra, rb)
  }
}

export interface LadderParseContext {
  resolveBlock: BlockSignatureResolver
}

const NO_SIGNATURES: LadderParseContext = { resolveBlock: () => undefined }

// Bounds the editor gives a new rung (ladder/index.tsx, handleAddNewRung).
const NEW_RUNG_BOUNDS: [number, number] = [300, 100]

const EXECUTION_CONTROL_PINS = new Set(['EN', 'ENO'])

type NativeElement = ContactNode | CoilNode | BlockNode<BlockVariant>
type RailNode = ReturnType<typeof nodesBuilder.powerRail>
type NativeNode = NativeElement | RailNode | ParallelNode

interface Endpoint {
  node: NativeNode
  handle: string
}

type RebuildResult = { ok: true; rung: RungLadderState } | { ok: false; reason: string }

interface ImportedLink {
  edge: Edge
  source: LadderParsedNode
  target: LadderParsedNode
}

const isParallel = (node: NativeNode): node is ParallelNode => node.type === 'parallel'
const isBlock = (node: LadderParsedNode): node is BlockNode<BlockVariant> => node.type === 'block'
const isRail = (node: LadderParsedNode): node is PowerRailNode => node.type === 'powerRail'
const isVariable = (node: LadderParsedNode): node is VariableNode => node.type === 'variable'
const isContact = (node: LadderParsedNode): node is ContactNode => node.type === 'contact'
const isCoil = (node: LadderParsedNode): node is CoilNode => node.type === 'coil'

// The XML only names the pins it wired, so an undefined type keeps whatever pins it did name.
function signatureFromXmlPins(block: BlockNode<BlockVariant>): BlockSignature {
  const pins = (handles: { id?: string | null }[], pinClass: string) =>
    handles
      .map((handle) => handle.id ?? '')
      .filter((id) => id !== '' && !EXECUTION_CONTROL_PINS.has(id.toUpperCase()))
      .map((id) => ({ name: id, class: pinClass, type: { definition: 'generic-type', value: 'ANY' } }))
  return {
    name: block.data.variant.name,
    type: block.data.variant.type,
    variables: [...pins(block.data.inputHandles, 'input'), ...pins(block.data.outputHandles, 'output')],
    documentation: '',
    extensible: false,
  }
}

// A library signature only declares the default inputs of an extensible block (IN1, IN2 for ADD).
function fitExtensibleInputs(signature: BlockSignature, imported: BlockNode<BlockVariant>): BlockSignature {
  if (!signature.extensible) return signature
  const xmlInputs = imported.data.inputHandles.map((handle) => ({
    name: (handle.id ?? '').toUpperCase(),
    class: 'input',
    type: { definition: 'generic-type', value: 'ANY' },
  }))
  const xmlCount = classifyBlockVariables(xmlInputs).extensibleInputs.length
  const { fixedInputs, extensibleInputs } = classifyBlockVariables(signature.variables)
  if (xmlCount <= extensibleInputs.length) return signature
  return { ...signature, variables: rebuildVariablesForInputCount(signature.variables, fixedInputs.length + xmlCount) }
}

function buildNativeBlock(
  pouName: string,
  imported: BlockNode<BlockVariant>,
  context: LadderParseContext,
  warnings: string[],
): BlockNode<BlockVariant> {
  let signature = context.resolveBlock(imported.data.variant.name)
  if (!signature) {
    warnings.push(
      `POU "${pouName}": block type "${imported.data.variant.name}" is not defined in the project or its libraries, its pins were taken from the XML`,
    )
    signature = signatureFromXmlPins(imported)
  }
  signature = fitExtensibleInputs(signature, imported)
  const block: BlockNode<BlockVariant> = nodesBuilder.block({
    id: imported.id,
    posX: 0,
    posY: 0,
    handleX: 0,
    handleY: 0,
    variant: signature,
    executionControl: imported.data.inputHandles.some((handle) => handle.id?.toUpperCase() === 'EN'),
  })
  return {
    ...block,
    selected: false,
    data: {
      ...block.data,
      numericId: imported.data.numericId,
      executionOrder: imported.data.executionOrder,
      variable: { name: imported.data.variant.type === 'function-block' ? imported.data.variable.name : '' },
    },
  }
}

function buildNativeContact(imported: ContactNode): ContactNode {
  const node = nodesBuilder.contact({
    id: imported.id,
    posX: 0,
    posY: 0,
    handleX: 0,
    handleY: 0,
    variant: imported.data.variant,
  })
  return { ...node, data: { ...node.data, numericId: imported.data.numericId, variable: imported.data.variable } }
}

function buildNativeCoil(imported: CoilNode): CoilNode {
  const node = nodesBuilder.coil({
    id: imported.id,
    posX: 0,
    posY: 0,
    handleX: 0,
    handleY: 0,
    variant: imported.data.variant,
  })
  return { ...node, data: { ...node.data, numericId: imported.data.numericId, variable: imported.data.variable } }
}

// XML pin names are matched case-insensitively (IEC identifiers are), then spelled as the block spells them.
function findPin(handles: { id?: string | null }[], xmlPin: string | null | undefined): string | undefined {
  const wanted = (xmlPin ?? '').toUpperCase()
  return handles.find((handle) => handle.id?.toUpperCase() === wanted)?.id ?? undefined
}

// Mirrors the handle overrides startParallelConnection applies to a parallel nested at the start or end of a
// parallel path: there the inner OPEN receives on its top handle and the inner CLOSE sends from its top handle.
function connectEndpoint(edges: Edge[], from: Endpoint, to: NativeNode, targetHandle: string): void {
  let sourceHandle = from.handle
  let handle = targetHandle
  const source = from.node
  if (isParallel(source) && isParallel(to)) {
    if (
      source.data.type === 'open' &&
      to.data.type === 'open' &&
      from.handle === source.data.parallelOutputConnector?.id
    ) {
      handle = to.data.parallelInputConnector?.id ?? handle
    }
    if (
      source.data.type === 'close' &&
      to.data.type === 'close' &&
      targetHandle === to.data.parallelInputConnector?.id
    ) {
      sourceHandle = source.data.parallelOutputConnector?.id ?? sourceHandle
    }
  }
  edges.push(buildEdge(source.id, to.id, { sourceHandle, targetHandle: handle }))
}

function buildParallelPair(): { open: ParallelNode; close: ParallelNode } {
  const origin = { posX: 0, posY: 0, handleX: 0, handleY: 0 }
  const open = nodesBuilder.parallel({ id: `PARALLEL_OPEN_${newUuid()}`, type: 'open', ...origin })
  const close = nodesBuilder.parallel({ id: `PARALLEL_CLOSE_${newUuid()}`, type: 'close', ...origin })
  open.data.parallelCloseReference = close.id
  close.data.parallelOpenReference = open.id
  return { open, close }
}

// Emits nodes in the order the editor's own insertions leave them (OPEN, serial path, parallel path, CLOSE): the
// layout walks the array and positions each node from predecessors it has already placed.
function emitSeriesParallel(
  expr: SeriesParallel<NativeElement>,
  from: Endpoint,
  nodes: NativeNode[],
  edges: Edge[],
): Endpoint {
  switch (expr.kind) {
    case 'wire':
      return from
    case 'leaf': {
      const node = expr.value
      nodes.push(node)
      connectEndpoint(edges, from, node, node.data.inputConnector?.id ?? LEAF_INPUT_HANDLE)
      return { node, handle: node.data.outputConnector?.id ?? LEAF_OUTPUT_HANDLE }
    }
    case 'series':
      return expr.items.reduce((endpoint, item) => emitSeriesParallel(item, endpoint, nodes, edges), from)
    case 'parallel': {
      const [serialBranch, ...parallelBranches] = expr.branches
      const { open, close } = buildParallelPair()
      nodes.push(open)
      connectEndpoint(edges, from, open, open.data.inputConnector?.id ?? LEAF_INPUT_HANDLE)
      const serialEnd = emitSeriesParallel(
        serialBranch,
        { node: open, handle: open.data.outputConnector?.id ?? '' },
        nodes,
        edges,
      )
      // More than two branches nest, as they do when a branch is added under a parallel path in the editor.
      const parallelEnd = emitSeriesParallel(
        parallelBranches.length === 1 ? parallelBranches[0] : { kind: 'parallel', branches: parallelBranches },
        { node: open, handle: open.data.parallelOutputConnector?.id ?? '' },
        nodes,
        edges,
      )
      nodes.push(close)
      connectEndpoint(edges, serialEnd, close, close.data.inputConnector?.id ?? '')
      connectEndpoint(edges, parallelEnd, close, close.data.parallelInputConnector?.id ?? '')
      return { node: close, handle: close.data.outputConnector?.id ?? '' }
    }
  }
}

function buildNativeRails(rungId: string): { left: RailNode; right: RailNode } {
  const [width, height] = NEW_RUNG_BOUNDS
  const { powerRail } = defaultCustomNodesStyles
  const left = nodesBuilder.powerRail({
    id: `left-rail-${rungId}`,
    posX: 0,
    posY: height / 2 - powerRail.height / 2,
    connector: 'right',
    handleX: powerRail.width,
    handleY: height / 2,
  })
  const right = nodesBuilder.powerRail({
    id: `right-rail-${rungId}`,
    posX: width,
    posY: height / 2 - powerRail.height / 2,
    connector: 'left',
    handleX: width - powerRail.width,
    handleY: height / 2,
  })
  return { left, right }
}

/**
 * Rebuild one imported rung as the editor itself would have drawn it: blocks carry their real signature, the
 * literals and variables wired to their secondary pins become connected variables, fan-out/fan-in becomes
 * OPEN/CLOSE parallels, and every position comes from the editor's own layout rather than the XML's.
 */
function rebuildRung(
  pouName: string,
  rungId: string,
  imported: { nodes: LadderParsedNode[]; links: ImportedLink[] },
  context: LadderParseContext,
  warnings: string[],
): RebuildResult {
  const leftRails = imported.nodes.filter((node) => isRail(node) && node.data.variant === 'left')
  const rightRails = imported.nodes.filter((node) => isRail(node) && node.data.variant === 'right')
  if (leftRails.length !== 1 || rightRails.length !== 1) {
    return { ok: false, reason: 'it does not have exactly one left and one right power rail' }
  }
  const [leftRailId, rightRailId] = [leftRails[0].id, rightRails[0].id]

  const elements = new Map<string, NativeElement>()
  const blockWarnings: string[] = []
  for (const node of imported.nodes) {
    if (isBlock(node)) elements.set(node.id, buildNativeBlock(pouName, node, context, blockWarnings))
    else if (isContact(node)) elements.set(node.id, buildNativeContact(node))
    else if (isCoil(node)) elements.set(node.id, buildNativeCoil(node))
  }

  const wires: SeriesParallelWire[] = []
  const connectedVariables = new Map<string, LadderBlockConnectedVariables>()
  const addConnectedVariable = (blockId: string, entry: LadderBlockConnectedVariables[number]) => {
    connectedVariables.set(blockId, [...(connectedVariables.get(blockId) ?? []), entry])
  }

  for (const { edge, source, target } of imported.links) {
    if (isVariable(source) || isVariable(target)) {
      const direction = isVariable(source) ? 'input' : 'output'
      const variableNode = direction === 'input' ? source : target
      const block = elements.get(direction === 'input' ? target.id : source.id)
      if (!isVariable(variableNode) || !block || !isBlock(block)) {
        return { ok: false, reason: 'a variable box is wired to something other than a block pin' }
      }
      const handles = direction === 'input' ? block.data.inputHandles : block.data.outputHandles
      const mainPin = direction === 'input' ? block.data.inputConnector?.id : block.data.outputConnector?.id
      const pin = findPin(handles, direction === 'input' ? edge.targetHandle : edge.sourceHandle)
      if (!pin) {
        const xmlPin = (direction === 'input' ? edge.targetHandle : edge.sourceHandle) ?? ''
        return { ok: false, reason: `block "${block.data.variant.name}" has no pin "${xmlPin}"` }
      }
      if (pin === mainPin) {
        return {
          ok: false,
          reason: `block "${block.data.variant.name}" has a variable box on the pin the rung runs through`,
        }
      }
      const { name } = variableNode.data.variable
      if (name !== '') {
        addConnectedVariable(block.id, {
          handleId: pin,
          handleTableId: block.data.variant.variables.find((variable) => variable.name === pin)?.id,
          type: direction,
          variable: { name },
        })
      }
      continue
    }

    const endpointOf = (node: LadderParsedNode) =>
      node.id === leftRailId ? SOURCE : node.id === rightRailId ? SINK : elements.get(node.id)
    const from = endpointOf(source)
    const to = endpointOf(target)
    if (!from || !to || from === SINK || to === SOURCE) {
      return { ok: false, reason: 'a connection runs into a power rail from the wrong side' }
    }
    if (
      from !== SOURCE &&
      isBlock(from) &&
      edge.sourceHandle !== LEAF_OUTPUT_HANDLE &&
      findPin(from.data.outputHandles, edge.sourceHandle) !== from.data.outputConnector?.id
    ) {
      return {
        ok: false,
        reason: `elements are wired to the secondary output "${edge.sourceHandle}" of block "${from.data.variant.name}"`,
      }
    }
    if (to !== SINK && isBlock(to) && findPin(to.data.inputHandles, edge.targetHandle) !== to.data.inputConnector?.id) {
      return {
        ok: false,
        reason: `elements are wired to the secondary input "${edge.targetHandle}" of block "${to.data.variant.name}"`,
      }
    }
    wires.push({ from: from === SOURCE ? SOURCE : from.id, to: to === SINK ? SINK : to.id })
  }

  const positionOf = new Map(imported.nodes.map((node) => [node.id, node.position]))
  const reduced = reduceSeriesParallel(
    [...elements.values()].map((element) => ({ id: element.id, value: element })),
    wires,
    (element) => {
      const position = positionOf.get(element.id) ?? { x: 0, y: 0 }
      return position.y * 1e6 + position.x
    },
  )
  if (!reduced.ok) return reduced

  for (const [blockId, entries] of connectedVariables) {
    const block = elements.get(blockId)
    if (block && isBlock(block))
      elements.set(blockId, { ...block, data: { ...block.data, connectedVariables: entries } })
  }
  const withConnectedVariables = (expr: SeriesParallel<NativeElement>): SeriesParallel<NativeElement> => {
    switch (expr.kind) {
      case 'wire':
        return expr
      case 'leaf':
        return { kind: 'leaf', value: elements.get(expr.value.id) ?? expr.value }
      case 'series':
        return { kind: 'series', items: expr.items.map(withConnectedVariables) }
      case 'parallel':
        return { kind: 'parallel', branches: expr.branches.map(withConnectedVariables) }
    }
  }

  const { left, right } = buildNativeRails(rungId)
  const nodes: NativeNode[] = [left]
  const edges: Edge[] = []
  const end = emitSeriesParallel(
    withConnectedVariables(reduced.expr),
    { node: left, handle: RAIL_OUTPUT_HANDLE },
    nodes,
    edges,
  )
  connectEndpoint(edges, end, right, RAIL_INPUT_HANDLE)
  nodes.push(right)

  const rung: RungLadderState = {
    id: rungId,
    comment: '',
    defaultBounds: [...NEW_RUNG_BOUNDS],
    reactFlowViewport: [...NEW_RUNG_BOUNDS],
    selectedNodes: [],
    nodes,
    edges,
  }
  const laidOut = updateDiagramElementsPosition(rung, NEW_RUNG_BOUNDS)
  warnings.push(...blockWarnings)
  return { ok: true, rung: { ...rung, nodes: laidOut.nodes, edges: laidOut.edges } }
}

function withResolvedSignature(
  pouName: string,
  node: LadderParsedNode,
  context: LadderParseContext,
  warnings: string[],
): LadderParsedNode {
  if (!isBlock(node)) return node
  const { variant, executionControl, lockExecutionControl } = buildNativeBlock(pouName, node, context, warnings).data
  return { ...node, data: { ...node.data, variant, executionControl, lockExecutionControl } }
}

export function parseLadderXml(
  pouName: string,
  ldXml: unknown,
  context: LadderParseContext = NO_SIGNATURES,
): { body: LadderFlowType; warnings: string[] } {
  const ld = asRecord(ldXml)
  const warnings: string[] = []
  const nodes: LadderParsedNode[] = []
  const pendingEdges: PendingEdge[] = []

  for (const entry of asArray(ld.leftPowerRail)) {
    const node = parseLeftRailXml(asRecord(entry))
    nodes.push(node)
  }
  for (const entry of asArray(ld.rightPowerRail)) {
    const { node, pendingEdges: edges } = parseRightRailXml(asRecord(entry))
    nodes.push(node)
    pendingEdges.push(...edges)
  }
  for (const entry of asArray(ld.contact)) {
    const { node, pendingEdges: edges } = parseContactXml(asRecord(entry))
    nodes.push(node)
    pendingEdges.push(...edges)
  }
  for (const entry of asArray(ld.coil)) {
    const { node, pendingEdges: edges } = parseCoilXml(asRecord(entry))
    nodes.push(node)
    pendingEdges.push(...edges)
  }
  for (const entry of asArray(ld.block)) {
    const { node, pendingEdges: edges } = parseBlockXml(asRecord(entry))
    nodes.push(node)
    pendingEdges.push(...edges)
  }
  for (const entry of asArray(ld.inVariable)) {
    const node = parseInVariableXml(asRecord(entry))
    nodes.push(node)
  }
  for (const entry of asArray(ld.outVariable)) {
    const { node, pendingEdges: edges } = parseOutVariableXml(asRecord(entry))
    nodes.push(node)
    pendingEdges.push(...edges)
  }

  const nodeByNumericId = new Map(nodes.map((node) => [node.data.numericId, node]))

  const inOutCount = asArray(ld.inOutVariable).length
  if (inOutCount > 0) {
    warnings.push(`POU "${pouName}": ${inOutCount} LD inOutVariable node(s) are not supported, skipped`)
  }

  const links: ImportedLink[] = []
  const forest = new UnionFind()
  for (const node of nodes) forest.find(node.id)

  for (const pending of pendingEdges) {
    const target = nodeByNumericId.get(pending.targetNumericId)
    const source = nodeByNumericId.get(pending.sourceRefLocalId)
    if (!target || !source) {
      warnings.push(`POU "${pouName}": LD connection references unknown localId "${pending.sourceRefLocalId}", skipped`)
      continue
    }
    const sourceHandle = pending.sourceFormalParameter ?? LEAF_OUTPUT_HANDLE
    const edge: Edge = {
      id: `xy-edge__${source.id}${sourceHandle}-${target.id}${pending.targetHandle}`,
      source: source.id,
      sourceHandle,
      target: target.id,
      targetHandle: pending.targetHandle,
      type: 'smoothstep',
    }
    links.push({ edge, source, target })
    forest.union(source.id, target.id)
  }

  // Rungs aren't wrapped by any XML element in this dialect — all rungs
  // flatten into one shared <LD> (see ladderToXml) and are only
  // reconstructable by tracing which nodes are connected to each other.
  // Rungs never cross-connect, so a connected-component partition of the
  // node/edge graph recovers them, without needing the array-position
  // pairing the generator's own output happens to preserve.
  const componentOrder: string[] = []
  const componentNodes = new Map<string, LadderParsedNode[]>()
  for (const node of nodes) {
    const root = forest.find(node.id)
    const group = componentNodes.get(root)
    if (group) {
      group.push(node)
    } else {
      componentNodes.set(root, [node])
      componentOrder.push(root)
    }
  }

  // A variable box wired to nothing has nowhere to be drawn: it is not a rung of its own.
  const rungRoots = componentOrder.filter((root) => !(componentNodes.get(root) ?? []).every(isVariable))
  const strayVariables = componentOrder.length - rungRoots.length
  if (strayVariables > 0) {
    warnings.push(`POU "${pouName}": ${strayVariables} unconnected LD variable box(es) skipped`)
  }

  const rungs: LadderFlowType['rungs'] = rungRoots.map((root, index) => {
    const rungNodes = componentNodes.get(root) ?? []
    const rungNodeIds = new Set(rungNodes.map((n) => n.id))
    const rungLinks = links.filter((link) => rungNodeIds.has(link.source.id))
    const rungEdges = rungLinks.map((link) => link.edge)

    const rebuilt = rebuildRung(
      pouName,
      `rung_${pouName}_${newUuid()}`,
      { nodes: rungNodes, links: rungLinks },
      context,
      warnings,
    )
    if (rebuilt.ok) return rebuilt.rung
    warnings.push(`POU "${pouName}": rung ${index + 1} kept the layout from the XML, because ${rebuilt.reason}`)

    // Without the resolved signature its blocks would transpile with no inputs.
    const fallbackNodes = rungNodes.map((node) => withResolvedSignature(pouName, node, context, warnings))

    // Kept as absolute XML coordinates: the rung is internally consistent, it just starts further down the canvas.
    const minX = Math.min(...rungNodes.map((n) => n.position.x))
    const minY = Math.min(...rungNodes.map((n) => n.position.y))
    const maxX = Math.max(...rungNodes.map((n) => n.position.x + (n.width ?? 0)))
    const maxY = Math.max(...rungNodes.map((n) => n.position.y + (n.height ?? 0)))

    return {
      id: `rung-${index}`,
      comment: '',
      defaultBounds: [minX, minY, maxX, maxY],
      reactFlowViewport: [maxX - minX, maxY - minY],
      selectedNodes: [],
      nodes: fallbackNodes,
      edges: rungEdges,
    }
  })

  return { body: { name: pouName, updated: false, rungs }, warnings }
}
