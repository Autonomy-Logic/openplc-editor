import {
  DEFAULT_EXECUTE_CONNECTOR_Y,
  DEFAULT_EXECUTE_WIDTH,
  executeHeight,
} from '@root/frontend/components/_atoms/graphical-editor/ladder/utils/constants'
import {
  BlockNode,
  BlockVariant,
  CoilNode,
  ContactNode,
  ExecuteNode,
  PowerRailNode,
  VariableNode,
} from '@root/frontend/components/_atoms/graphical-editor/ladder/utils/types'
import { LadderFlowType } from '@root/frontend/store/slices'
import { Edge, Position } from '@xyflow/react'

import { readExecuteStCode } from '../../execute-plcopen'
import { asArray, asRecord, asString } from '../xml-node'
import type { XyPosition } from './geometry'
import { makeHandle, parsePositionXml, toNumber } from './geometry'

type LadderParsedNode = PowerRailNode | ContactNode | CoilNode | BlockNode<BlockVariant> | VariableNode | ExecuteNode

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

// Rails are the one exception to this file's `TYPE-<localId>` id convention.
// The rung layout resolves them by prefix — `id.startsWith('left-rail')` /
// `'right-rail'` (see changeRailBounds and the handle-branch helpers) — so a
// differently-prefixed id makes an imported rung's right rail invisible to the
// layout: it never repositions, and elements added afterwards run straight
// past it.
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
    id: `left-rail-${numericId}`,
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
    id: `right-rail-${numericId}`,
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

/** An `EN` / `ENO` handle for a file that declared neither. */
function makeExecuteFallbackHandle(id: 'EN' | 'ENO', position: XyPosition) {
  const side = id === 'EN' ? Position.Left : Position.Right
  const relPosition = { '@x': id === 'EN' ? 0 : DEFAULT_EXECUTE_WIDTH, '@y': DEFAULT_EXECUTE_CONNECTOR_Y }
  return makeHandle(id, id === 'EN' ? 'target' : 'source', side, position, relPosition, {
    top: DEFAULT_EXECUTE_CONNECTOR_Y,
    ...(id === 'EN' ? { left: 0 } : { right: 0 }),
  })
}

/**
 * Rebuild an Execute ("ST Block") element from a `<block typeName="EXECUTE">`.
 *
 * PLCopen has no inline-ST element, so the snippet rides in an `<addData>`
 * under 3S's `.../plcopenxml/stcode` URI — the same shape CODESYS writes, so
 * their exports import here too. See `utils/PLC/execute-plcopen.ts`.
 *
 * The `EN`/`ENO` pins are ordinary formal parameters, so connections rebuild
 * through exactly the same `parseConnectionXml` path as any other block.
 */
function parseExecuteXml(
  entry: Record<string, unknown>,
  code: string,
): { node: ExecuteNode; pendingEdges: PendingEdge[] } {
  const numericId = asString(entry['@localId'])
  const position = parsePositionXml(entry.position)
  const pendingEdges: PendingEdge[] = []

  const inputHandles: ExecuteNode['data']['inputHandles'] = []
  for (const varRaw of asArray(asRecord(entry.inputVariables).variable)) {
    const v = asRecord(varRaw)
    const formalParameter = asString(v['@formalParameter'])
    const connIn = asRecord(v.connectionPointIn)
    // `style.top` is what places the handle's DOM element, and React Flow
    // draws edges to the DOM position — without it an imported box has its
    // wires meeting it at the element's vertical centre instead of the pin row.
    inputHandles.push(
      makeHandle(formalParameter, 'target', Position.Left, position, connIn.relPosition, {
        top: DEFAULT_EXECUTE_CONNECTOR_Y,
        left: 0,
      }),
    )
    for (const connRaw of asArray(connIn.connection)) {
      pendingEdges.push(parseConnectionXml(connRaw, numericId, formalParameter))
    }
  }

  const outputHandles: ExecuteNode['data']['outputHandles'] = asArray(asRecord(entry.outputVariables).variable).map(
    (varRaw) => {
      const v = asRecord(varRaw)
      const connOut = asRecord(v.connectionPointOut)
      return makeHandle(asString(v['@formalParameter']), 'source', Position.Right, position, connOut.relPosition, {
        top: DEFAULT_EXECUTE_CONNECTOR_Y,
        right: 0,
      })
    },
  )

  // A file that declares typeName="EXECUTE" without EN/ENO still has to
  // produce a usable box: the rung layout reads `inputConnector` /
  // `outputConnector` to place whatever is inserted next to it, and an
  // undefined one crashes it. Nothing we write omits them — this covers
  // hand-edited and foreign files.
  if (inputHandles.length === 0) inputHandles.push(makeExecuteFallbackHandle('EN', position))
  if (outputHandles.length === 0) outputHandles.push(makeExecuteFallbackHandle('ENO', position))

  // `||` and not `??`: toNumber yields 0 for an absent or unparseable
  // attribute, and a 0-sized box is exactly what needs the fallback. CODESYS
  // omits width/height entirely, so this is its normal path.
  const width = toNumber(entry['@width']) || DEFAULT_EXECUTE_WIDTH
  const height = toNumber(entry['@height']) || executeHeight(code === '' ? 0 : code.split('\n').length)

  const node: ExecuteNode = {
    id: `EXECUTE-${numericId}`,
    type: 'execute',
    position,
    width,
    height,
    draggable: true,
    selectable: true,
    data: {
      handles: [...inputHandles, ...outputHandles],
      inputHandles,
      outputHandles,
      inputConnector: inputHandles[0],
      outputConnector: outputHandles[0],
      numericId,
      code,
      variable: { name: '' },
      executionOrder: toNumber(entry['@executionOrderId']),
      draggable: true,
      selectable: true,
      deletable: true,
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

/**
 * Shift a rung's nodes vertically by `dy`, keeping handle geometry in step.
 *
 * Mutates the freshly-parsed nodes rather than rebuilding them: `data` is a
 * discriminated union whose members differ, and every node's handles are
 * reached the same way regardless. `inputConnector` / `outputConnector` alias
 * the same handle objects, so moving those objects updates every view of them.
 */
function translateRungY(rungNodes: LadderParsedNode[], dy: number): void {
  if (dy === 0) return
  // `handles` holds the same objects as `inputHandles` / `outputHandles`, so
  // track identity — moving one twice would double the shift.
  const moved = new Set<object>()
  for (const node of rungNodes) {
    node.position = { x: node.position.x, y: node.position.y + dy }
    const data: unknown = node.data
    if (typeof data !== 'object' || data === null) continue
    for (const key of ['handles', 'inputHandles', 'outputHandles'] as const) {
      if (!(key in data)) continue
      const handles = (data as Record<string, unknown>)[key]
      if (!Array.isArray(handles)) continue
      for (const handle of handles) {
        if (typeof handle !== 'object' || handle === null || !('glbPosition' in handle)) continue
        if (moved.has(handle)) continue
        moved.add(handle)
        const { glbPosition } = handle as { glbPosition: { x: number; y: number } }
        glbPosition.y += dy
      }
    }
  }
}

/**
 * Put a rung's nodes in electrical order: left rail first, each element in
 * signal-flow order, right rail last.
 *
 * The parse builds nodes grouped by XML element type — every `<contact>`, then
 * every `<coil>`, then every `<block>` — because that is the shape
 * fast-xml-parser hands over. The ladder editor reads a rung's node array as
 * its serial spine, though: `appendSerialConnection` and `getPreviousElement`
 * both take "the entry before this one in the array" to be the electrical
 * predecessor. Fed a type-grouped array, inserting an element wires it to
 * whatever happened to be parsed before it — typically the right power rail,
 * which has no output connector at all.
 *
 * Kahn's algorithm over the rung's own edges, tie-broken by X then parse order.
 * Newly-ready successors go to the front of the queue so a chain stays
 * contiguous — a parallel path's elements must not interleave with its
 * sibling's.
 */
function orderRungNodes(rungNodes: LadderParsedNode[], rungEdges: Edge[]): LadderParsedNode[] {
  const byId = new Map(rungNodes.map((node) => [node.id, node]))
  const parseIndex = new Map(rungNodes.map((node, index) => [node.id, index]))
  const inDegree = new Map(rungNodes.map((node) => [node.id, 0]))
  const successors = new Map<string, string[]>()

  for (const edge of rungEdges) {
    if (!inDegree.has(edge.source) || !inDegree.has(edge.target)) continue
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1)
    const existing = successors.get(edge.source)
    if (existing) existing.push(edge.target)
    else successors.set(edge.source, [edge.target])
  }

  const compare = (a: LadderParsedNode, b: LadderParsedNode): number =>
    a.position.x - b.position.x || (parseIndex.get(a.id) ?? 0) - (parseIndex.get(b.id) ?? 0)

  const queue = rungNodes.filter((node) => (inDegree.get(node.id) ?? 0) === 0).sort(compare)
  const ordered: LadderParsedNode[] = []
  const placed = new Set<string>()

  while (queue.length > 0) {
    const node = queue.shift()
    if (!node) break
    ordered.push(node)
    placed.add(node.id)

    const unlocked: LadderParsedNode[] = []
    for (const successorId of successors.get(node.id) ?? []) {
      const remaining = (inDegree.get(successorId) ?? 0) - 1
      inDegree.set(successorId, remaining)
      if (remaining !== 0) continue
      const successor = byId.get(successorId)
      if (successor) unlocked.push(successor)
    }
    queue.unshift(...unlocked.sort(compare))
  }

  // Ladder bodies are acyclic, so this only guards against a malformed file —
  // an unorderable node keeps its parse position rather than being dropped.
  for (const node of rungNodes) if (!placed.has(node.id)) ordered.push(node)

  return ordered
}

export function parseLadderXml(
  pouName: string,
  ldXml: unknown,
  /**
   * Untrimmed `<STCode>` payloads by `@localId`, from a second parse — see
   * `parse-xml-document.ts`. The main parse trims text nodes, which would
   * eat an Execute snippet's first-line indentation and trailing newline.
   * Absent (tests, callers that don't care) falls back to the trimmed text.
   */
  executeStCode: ReadonlyMap<string, string> = new Map(),
): { body: LadderFlowType; warnings: string[] } {
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
    const record = asRecord(entry)
    // An Execute ("ST Block") element rides in as a <block> with
    // typeName="EXECUTE" — the shape CODESYS itself writes — so it has to be
    // split out here before the generic block path claims it as a function call.
    const trimmedCode = readExecuteStCode(record)
    const executeCode = trimmedCode === null ? null : (executeStCode.get(asString(record['@localId'])) ?? trimmedCode)
    const { node, pendingEdges: edges } =
      executeCode === null ? parseBlockXml(record) : parseExecuteXml(record, executeCode)
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
      warnings.push(`POU "${pouName}": LD connection references unknown localId "${pending.sourceRefLocalId}", skipped`)
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
  const allComponents: string[] = []
  const componentNodes = new Map<string, LadderParsedNode[]>()
  for (const node of nodes) {
    const root = forest.find(node.id)
    const group = componentNodes.get(root)
    if (group) {
      group.push(node)
    } else {
      componentNodes.set(root, [node])
      allComponents.push(root)
    }
  }

  // A component of nothing but power rails carries no logic — it is a rail the
  // file left unwired (CODESYS emits its <rightPowerRail> with an empty
  // <connectionPointIn>, so it lands in a component of its own). Turning that
  // into a rung yields one the editor cannot lay out or add to, so drop it and
  // say so rather than shipping a broken rung.
  const componentOrder: string[] = []
  let skippedEmptyNetworks = 0
  for (const root of allComponents) {
    const group = componentNodes.get(root) ?? []
    if (group.some((node) => node.type !== 'powerRail')) componentOrder.push(root)
    else skippedEmptyNetworks += 1
  }
  if (skippedEmptyNetworks > 0) {
    warnings.push(
      `POU "${pouName}": ${skippedEmptyNetworks} LD network(s) with no elements (unwired power rail) skipped`,
    )
  }

  // Rung stacking bakes a cumulative Y shift into every node's position (the
  // generator adds each preceding rung's viewport height, see ladderToXml), so
  // an imported rung's contents would otherwise sit far below its own
  // viewport — a large blank gap above the elements, growing with every rung.
  // Re-base each rung so its topmost element sits where the first rung's does.
  const rungTops = componentOrder.map((root) => {
    const rungNodes = componentNodes.get(root) ?? []
    return rungNodes.length > 0 ? Math.min(...rungNodes.map((n) => n.position.y)) : 0
  })
  const topmostRungY = rungTops.length > 0 ? Math.min(...rungTops) : 0

  const rungs: LadderFlowType['rungs'] = componentOrder.map((root, index) => {
    const rungNodeIds = new Set(componentNodes.get(root)?.map((n) => n.id))
    const rungEdges = edges.filter((e) => rungNodeIds.has(e.source) && rungNodeIds.has(e.target))
    const rungNodes = orderRungNodes(componentNodes.get(root) ?? [], rungEdges)

    translateRungY(rungNodes, topmostRungY - rungTops[index])

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
