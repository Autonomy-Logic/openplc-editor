import {
  BlockNode,
  BlockVariant,
  CoilNode,
  ContactNode,
  PowerRailNode,
  VariableNode,
} from '@root/frontend/components/_atoms/graphical-editor/ladder/utils/types'
import { LadderFlowType } from '@root/frontend/store/slices'
import { Edge, Position } from '@xyflow/react'

import { asArray, asRecord, asString } from '../xml-node'
import { makeHandle, parsePositionXml, toNumber } from './geometry'

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
function parseCoilVariant(entry: Record<string, unknown>): 'default' | 'negated' | 'risingEdge' | 'fallingEdge' | 'set' | 'reset' {
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
      block: { id: '', handleId: '', variableType: { name: '', class: '', type: { definition: 'base-type', value: '' } } },
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

export function parseLadderXml(pouName: string, ldXml: unknown): { body: LadderFlowType; warnings: string[] } {
  const ld = asRecord(ldXml)
  const warnings: string[] = []
  const nodes: LadderParsedNode[] = []
  const nodeIdByNumericId = new Map<string, string>()
  const pendingEdges: PendingEdge[] = []

  for (const entry of asArray(ld.leftPowerRail)) {
    const node = parseLeftRailXml(asRecord(entry))
    nodes.push(node)
    nodeIdByNumericId.set(node.data.numericId, node.id)
  }
  for (const entry of asArray(ld.rightPowerRail)) {
    const { node, pendingEdges: edges } = parseRightRailXml(asRecord(entry))
    nodes.push(node)
    nodeIdByNumericId.set(node.data.numericId, node.id)
    pendingEdges.push(...edges)
  }
  for (const entry of asArray(ld.contact)) {
    const { node, pendingEdges: edges } = parseContactXml(asRecord(entry))
    nodes.push(node)
    nodeIdByNumericId.set(node.data.numericId, node.id)
    pendingEdges.push(...edges)
  }
  for (const entry of asArray(ld.coil)) {
    const { node, pendingEdges: edges } = parseCoilXml(asRecord(entry))
    nodes.push(node)
    nodeIdByNumericId.set(node.data.numericId, node.id)
    pendingEdges.push(...edges)
  }
  for (const entry of asArray(ld.block)) {
    const { node, pendingEdges: edges } = parseBlockXml(asRecord(entry))
    nodes.push(node)
    nodeIdByNumericId.set(node.data.numericId, node.id)
    pendingEdges.push(...edges)
  }
  for (const entry of asArray(ld.inVariable)) {
    const node = parseInVariableXml(asRecord(entry))
    nodes.push(node)
    nodeIdByNumericId.set(node.data.numericId, node.id)
  }
  for (const entry of asArray(ld.outVariable)) {
    const { node, pendingEdges: edges } = parseOutVariableXml(asRecord(entry))
    nodes.push(node)
    nodeIdByNumericId.set(node.data.numericId, node.id)
    pendingEdges.push(...edges)
  }

  const inOutCount = asArray(ld.inOutVariable).length
  if (inOutCount > 0) {
    warnings.push(`POU "${pouName}": ${inOutCount} LD inOutVariable node(s) are not supported, skipped`)
  }

  const edges: Edge[] = []
  const forest = new UnionFind()
  for (const node of nodes) forest.find(node.id)

  for (const pending of pendingEdges) {
    const targetNodeId = nodeIdByNumericId.get(pending.targetNumericId)
    const sourceNodeId = nodeIdByNumericId.get(pending.sourceRefLocalId)
    if (!targetNodeId || !sourceNodeId) {
      warnings.push(
        `POU "${pouName}": LD connection references unknown localId "${pending.sourceRefLocalId}", skipped`,
      )
      continue
    }
    const sourceHandle = pending.sourceFormalParameter ?? LEAF_OUTPUT_HANDLE
    edges.push({
      id: `xy-edge__${sourceNodeId}${sourceHandle}-${targetNodeId}${pending.targetHandle}`,
      source: sourceNodeId,
      sourceHandle,
      target: targetNodeId,
      targetHandle: pending.targetHandle,
      type: 'smoothstep',
    })
    forest.union(sourceNodeId, targetNodeId)
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

  // Rung stacking (offsetY in the generator) bakes a cumulative Y shift into
  // every node's position; re-basing each rung to a local origin would need
  // to rebuild every node-data variant's handles generically, which TS can't
  // do without a type assertion across this discriminated union — kept as
  // absolute coordinates instead (still internally consistent per rung; a
  // reopened diagram just starts further down the canvas for later rungs).
  const rungs: LadderFlowType['rungs'] = componentOrder.map((root, index) => {
    const rungNodeIds = new Set(componentNodes.get(root)?.map((n) => n.id))
    const rungEdges = edges.filter((e) => rungNodeIds.has(e.source) && rungNodeIds.has(e.target))
    const rungNodes = componentNodes.get(root) ?? []

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
      nodes: rungNodes,
      edges: rungEdges,
    }
  })

  return { body: { name: pouName, updated: false, rungs }, warnings }
}
