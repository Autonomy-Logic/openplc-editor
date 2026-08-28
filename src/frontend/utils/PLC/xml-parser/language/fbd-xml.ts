import { BlockNode } from '@root/frontend/components/_atoms/graphical-editor/fbd/block'
import {
  DEFAULT_EXECUTE_CONNECTOR_Y,
  DEFAULT_EXECUTE_HEIGHT,
  DEFAULT_EXECUTE_WIDTH,
} from '@root/frontend/components/_atoms/graphical-editor/fbd/utils/constants'
import type { ExecuteNode } from '@root/frontend/components/_atoms/graphical-editor/fbd/utils/types'
import {
  CommentNode,
  ConnectionNode,
  VariableNode,
} from '@root/frontend/components/_atoms/graphical-editor/fbd/utils/types'
import { BlockVariant } from '@root/frontend/components/_atoms/graphical-editor/types/block'
import { FBDFlowType } from '@root/frontend/store/slices'
import { Edge, Position } from '@xyflow/react'

import { readExecuteStCode } from '../../execute-plcopen'
import { extractXhtmlText } from '../variable-xml'
import { asArray, asRecord, asString } from '../xml-node'
import type { XyPosition } from './geometry'
import { makeHandle, parsePositionXml, toNumber } from './geometry'

type FbdNode = BlockNode<BlockVariant> | CommentNode | ConnectionNode | ExecuteNode | VariableNode

// Reverse of xml-generator/old-editor/language/fbd-xml.ts. Greenfield (no
// PLCopen import reference existed anywhere before this) — reconstructed
// purely from reading that generator and its zod schema.
//
// Leaf (non-block) FBD nodes have exactly one handle each, and the XML never
// names it directly (no @formalParameter on a leaf node's own element — only
// on a <connection>'s reference to a *block's* pin). The sentinel handle ids
// below are confirmed for input-variable/output-variable (an edge's
// sourceHandle into a block is literally "output-variable" when its source
// is an input-variable node); applied by analogy to connector (sink, like
// output-variable) and continuation (source, like input-variable) since
// neither has been directly observed — flagged as an unverified assumption,
// consistent with this parser's provisional old-editor-dialect scope (see
// xml-parser/index.ts).
const LEAF_INPUT_HANDLE_ID = 'input-variable'
const LEAF_OUTPUT_HANDLE_ID = 'output-variable'

// A block's <connection> (or output-variable's/connector's) may reference a
// node that appears later in the XML, so all nodes are built first and
// edges are resolved in a second pass against this pending list.
interface PendingEdge {
  targetNumericId: string
  targetHandle: string
  sourceRefLocalId: string
  sourceFormalParameter?: string
}

function parseConnectionXml(connXml: unknown, targetNumericId: string, targetHandle: string): PendingEdge {
  const conn = asRecord(connXml)
  const formalParameter = conn['@formalParameter']
  return {
    targetNumericId,
    targetHandle,
    sourceRefLocalId: asString(conn['@refLocalId']),
    sourceFormalParameter: typeof formalParameter === 'string' ? formalParameter : undefined,
  }
}

// Reverse of blockToXml. Each <inputVariables><variable formalParameter="X">
// entry becomes one input handle "X" (deduped — the generator can emit
// several sibling <variable> entries sharing the same @formalParameter when
// that pin has multiple incoming edges, rather than one <variable> with a
// multi-item <connection> array) plus one pending edge per <connection>
// child. A pin with zero incoming edges has no <variable> element at all, so
// it can't be recovered here — this parser's block only has the handles the
// XML actually mentions.
function parseBlockXml(entry: Record<string, unknown>): { node: BlockNode<BlockVariant>; pendingEdges: PendingEdge[] } {
  const numericId = asString(entry['@localId'])
  const position = parsePositionXml(entry.position)
  const instanceName = entry['@instanceName']
  const isFunctionBlock = typeof instanceName === 'string'
  const typeName = asString(entry['@typeName'])

  const inputHandles: BlockNode<BlockVariant>['data']['inputHandles'] = []
  const seenInputHandleIds = new Set<string>()
  const pendingEdges: PendingEdge[] = []

  for (const varRaw of asArray(asRecord(entry.inputVariables).variable)) {
    const v = asRecord(varRaw)
    const formalParameter = asString(v['@formalParameter'])
    const connIn = asRecord(v.connectionPointIn)

    if (!seenInputHandleIds.has(formalParameter)) {
      seenInputHandleIds.add(formalParameter)
      inputHandles.push(makeHandle(formalParameter, 'target', Position.Left, position, connIn.relPosition))
    }
    for (const connRaw of asArray(connIn.connection)) {
      pendingEdges.push(parseConnectionXml(connRaw, numericId, formalParameter))
    }
  }

  const outputHandles: BlockNode<BlockVariant>['data']['outputHandles'] = asArray(
    asRecord(entry.outputVariables).variable,
  ).map((varRaw) => {
    const v = asRecord(varRaw)
    const formalParameter = asString(v['@formalParameter'])
    const connOut = asRecord(v.connectionPointOut)
    return makeHandle(formalParameter, 'source', Position.Right, position, connOut.relPosition)
  })

  // Only a function-block instance carries a name of its own (@instanceName);
  // a plain function call has none in the XML (only @typeName, the callee's
  // name). `variable.name` is required by the domain type even so — fall
  // back to typeName as an honest, non-empty placeholder the generator never
  // actually reads back for a non-function-block (see blockToXml's
  // `variant.type === 'function-block' ? ... : undefined` guard).
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
      // Blocks address pins by name (formalParameter), not a single
      // primary connector — never read for a 'block' node by the
      // generator's FBD reader, kept `undefined` to satisfy the shared
      // BasicNodeData shape.
      inputConnector: undefined,
      outputConnector: undefined,
      numericId,
      executionOrder: toNumber(entry['@executionOrderId']),
      variable: { name: variableName },
      draggable: true,
      selectable: true,
      deletable: true,
      // Full class/type per pin can't be recovered from the FBD XML alone
      // (it only ever names pins, never their IEC variable class/type) —
      // an honest, documented gap rather than a guess. `body`/`language` used
      // to be filled in here as placeholders; `BlockVariant` no longer carries
      // them (see ports/block-types.ts, DOPE-592), which is what they always
      // were for a placed instance: never read back.
      variant: {
        name: typeName,
        type: isFunctionBlock ? 'function-block' : 'function',
        variables: [],
        documentation: '',
        extensible: false,
      },
      executionControl: false,
    },
  }

  return { node, pendingEdges }
}

/** An `EN` / `ENO` handle for a file that declared neither. */
function makeExecuteFallbackHandle(id: 'EN' | 'ENO', position: XyPosition) {
  const relPosition = { '@x': id === 'EN' ? 0 : DEFAULT_EXECUTE_WIDTH, '@y': DEFAULT_EXECUTE_CONNECTOR_Y }
  return makeHandle(
    id,
    id === 'EN' ? 'target' : 'source',
    id === 'EN' ? Position.Left : Position.Right,
    position,
    relPosition,
    {
      top: DEFAULT_EXECUTE_CONNECTOR_Y,
      ...(id === 'EN' ? { left: 0 } : { right: 0 }),
    },
  )
}

/**
 * Rebuild an Execute ("ST Block") element from a `<block typeName="EXECUTE">`.
 *
 * Without this the generic block path claims it, producing a nameless function
 * block with no snippet and pins that do not match the wiring — so the element
 * imports empty and disconnected.
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
    // `style.top` places the handle's DOM element; React Flow draws edges to
    // that position, not to `relPosition`.
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
  // produce a usable box — `inputConnector` / `outputConnector` must exist.
  // Nothing we write omits them; this covers hand-edited and foreign files.
  if (inputHandles.length === 0) inputHandles.push(makeExecuteFallbackHandle('EN', position))
  if (outputHandles.length === 0) outputHandles.push(makeExecuteFallbackHandle('ENO', position))

  const node: ExecuteNode = {
    id: `EXECUTE-${numericId}`,
    type: 'execute',
    position,
    // `||` and not `??`: toNumber yields 0 for an absent attribute, and a
    // 0-sized box is exactly what needs the fallback. CODESYS omits both.
    width: toNumber(entry['@width']) || DEFAULT_EXECUTE_WIDTH,
    height: toNumber(entry['@height']) || DEFAULT_EXECUTE_HEIGHT,
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

/**
 * The id of a node's only output handle, or undefined when it has none or
 * several. A comment node carries no handles at all, hence the narrowing.
 */
function soleOutputHandleId(node: FbdNode | undefined): string | undefined {
  if (!node) return undefined
  const data: unknown = node.data
  if (typeof data !== 'object' || data === null || !('outputHandles' in data)) return undefined
  const { outputHandles } = data as { outputHandles?: { id?: string }[] }
  if (outputHandles?.length !== 1) return undefined
  return outputHandles[0].id
}

function parseInVariableXml(entry: Record<string, unknown>): VariableNode {
  const numericId = asString(entry['@localId'])
  const position = parsePositionXml(entry.position)
  const outputHandle = makeHandle(
    LEAF_OUTPUT_HANDLE_ID,
    'source',
    Position.Right,
    position,
    asRecord(entry.connectionPointOut).relPosition,
  )

  return {
    id: `INPUT-VARIABLE-${numericId}`,
    type: 'input-variable',
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
      executionOrder: toNumber(entry['@executionOrderId']),
      variable: { name: asString(entry.expression) },
      draggable: true,
      selectable: true,
      deletable: true,
      variant: 'input-variable',
      negated: asString(entry['@negated']) === 'true',
    },
  }
}

function parseOutVariableXml(entry: Record<string, unknown>): { node: VariableNode; pendingEdges: PendingEdge[] } {
  const numericId = asString(entry['@localId'])
  const position = parsePositionXml(entry.position)
  const connIn = asRecord(entry.connectionPointIn)
  const inputHandle = makeHandle(LEAF_INPUT_HANDLE_ID, 'target', Position.Left, position, connIn.relPosition)
  const pendingEdges = asArray(connIn.connection).map((connRaw) =>
    parseConnectionXml(connRaw, numericId, LEAF_INPUT_HANDLE_ID),
  )

  const node: VariableNode = {
    id: `OUTPUT-VARIABLE-${numericId}`,
    type: 'output-variable',
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
      executionOrder: toNumber(entry['@executionOrderId']),
      variable: { name: asString(entry.expression) },
      draggable: true,
      selectable: true,
      deletable: true,
      variant: 'output-variable',
      negated: asString(entry['@negated']) === 'true',
    },
  }

  return { node, pendingEdges }
}

// connector is a sink (only connectionPointIn, like output-variable) despite
// the name; continuation is the source it (cosmetically) pairs with. Neither
// carries an executionOrderId/negated in the XML — the generator never
// reads or writes them for these two types.
function parseConnectorXml(entry: Record<string, unknown>): { node: ConnectionNode; pendingEdges: PendingEdge[] } {
  const numericId = asString(entry['@localId'])
  const position = parsePositionXml(entry.position)
  const connIn = asRecord(entry.connectionPointIn)
  const inputHandle = makeHandle(LEAF_INPUT_HANDLE_ID, 'target', Position.Left, position, connIn.relPosition)
  const pendingEdges = asArray(connIn.connection).map((connRaw) =>
    parseConnectionXml(connRaw, numericId, LEAF_INPUT_HANDLE_ID),
  )

  const node: ConnectionNode = {
    id: `CONNECTOR-${numericId}`,
    type: 'connector',
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
      executionOrder: 0,
      variable: { name: asString(entry['@name']) },
      draggable: true,
      selectable: true,
      deletable: true,
      variant: 'connector',
    },
  }

  return { node, pendingEdges }
}

function parseContinuationXml(entry: Record<string, unknown>): ConnectionNode {
  const numericId = asString(entry['@localId'])
  const position = parsePositionXml(entry.position)
  const outputHandle = makeHandle(
    LEAF_OUTPUT_HANDLE_ID,
    'source',
    Position.Right,
    position,
    asRecord(entry.connectionPointOut).relPosition,
  )

  return {
    id: `CONTINUATION-${numericId}`,
    type: 'continuation',
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
      executionOrder: 0,
      variable: { name: asString(entry['@name']) },
      draggable: true,
      selectable: true,
      deletable: true,
      variant: 'continuation',
    },
  }
}

// The generator writes the literal placeholder 'No comment provided' for an
// empty comment (commentToXml) — reverse it, mirroring parseDocumentationXml's
// ' ' -> '' un-placeholder-ing for the same reason (can't otherwise tell
// "left blank" from "typed the placeholder text").
function parseCommentXml(entry: Record<string, unknown>): CommentNode {
  const numericId = asString(entry['@localId'])
  const position = parsePositionXml(entry.position)
  const content = extractXhtmlText(entry.content)

  return {
    id: `COMMENT-${numericId}`,
    type: 'comment',
    position,
    width: toNumber(entry['@width']),
    height: toNumber(entry['@height']),
    draggable: true,
    selectable: true,
    data: {
      deletable: true,
      draggable: true,
      selectable: true,
      numericId,
      content: content === 'No comment provided' ? '' : content,
    },
  }
}

export function parseFbdXml(
  pouName: string,
  fbdXml: unknown,
  /**
   * Untrimmed `<STCode>` payloads by `@localId`, from a second parse — see
   * `parse-xml-document.ts`. The main parse trims text nodes, which would eat
   * an Execute snippet's first-line indentation. Absent (tests, callers that
   * don't care) falls back to the trimmed text.
   */
  executeStCode: ReadonlyMap<string, string> = new Map(),
): { body: FBDFlowType; warnings: string[] } {
  const fbd = asRecord(fbdXml)
  const warnings: string[] = []
  const nodes: FbdNode[] = []
  const nodeIdByNumericId = new Map<string, string>()
  const pendingEdges: PendingEdge[] = []

  for (const entry of asArray(fbd.block)) {
    const record = asRecord(entry)
    // An Execute element rides in as a <block typeName="EXECUTE">, so it has
    // to be split out before the generic block path claims it.
    const trimmedCode = readExecuteStCode(record)
    const executeCode = trimmedCode === null ? null : (executeStCode.get(asString(record['@localId'])) ?? trimmedCode)
    const { node, pendingEdges: edges } =
      executeCode === null ? parseBlockXml(record) : parseExecuteXml(record, executeCode)
    nodes.push(node)
    nodeIdByNumericId.set(node.data.numericId, node.id)
    pendingEdges.push(...edges)
  }
  for (const entry of asArray(fbd.inVariable)) {
    const node = parseInVariableXml(asRecord(entry))
    nodes.push(node)
    nodeIdByNumericId.set(node.data.numericId, node.id)
  }
  for (const entry of asArray(fbd.outVariable)) {
    const { node, pendingEdges: edges } = parseOutVariableXml(asRecord(entry))
    nodes.push(node)
    nodeIdByNumericId.set(node.data.numericId, node.id)
    pendingEdges.push(...edges)
  }
  for (const entry of asArray(fbd.connector)) {
    const { node, pendingEdges: edges } = parseConnectorXml(asRecord(entry))
    nodes.push(node)
    nodeIdByNumericId.set(node.data.numericId, node.id)
    pendingEdges.push(...edges)
  }
  for (const entry of asArray(fbd.continuation)) {
    const node = parseContinuationXml(asRecord(entry))
    nodes.push(node)
    nodeIdByNumericId.set(node.data.numericId, node.id)
  }
  for (const entry of asArray(fbd.comment)) {
    nodes.push(parseCommentXml(asRecord(entry)))
  }

  // inOutVariable is a confirmed dead branch in the generator (fbdToXml's
  // switch has no case for it, so it's never emitted) — if XML from a
  // different tool populates it, surface as a warning rather than guessing
  // at semantics with zero forward-generation precedent.
  const inOutCount = asArray(fbd.inOutVariable).length
  if (inOutCount > 0) {
    warnings.push(`POU "${pouName}": ${inOutCount} FBD inOutVariable node(s) are not supported, skipped`)
  }

  const edges: Edge[] = []
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  for (const pending of pendingEdges) {
    const targetNodeId = nodeIdByNumericId.get(pending.targetNumericId)
    const sourceNodeId = nodeIdByNumericId.get(pending.sourceRefLocalId)
    if (!targetNodeId || !sourceNodeId) {
      warnings.push(
        `POU "${pouName}": FBD connection references unknown localId "${pending.sourceRefLocalId}", skipped`,
      )
      continue
    }
    // A block-shaped source names the pin it is read from; a contact or
    // variable has a single anonymous output. Fall back to the source's only
    // output handle when the name is missing — files exported before Execute
    // was recognised as block-shaped omit it, and defaulting to the leaf id
    // would leave the edge pointing at a handle that does not exist.
    const sourceHandle =
      pending.sourceFormalParameter ?? soleOutputHandleId(nodeById.get(sourceNodeId)) ?? LEAF_OUTPUT_HANDLE_ID
    edges.push({
      id: `xy-edge__${sourceNodeId}${sourceHandle}-${targetNodeId}${pending.targetHandle}`,
      source: sourceNodeId,
      sourceHandle,
      target: targetNodeId,
      targetHandle: pending.targetHandle,
      type: 'smoothstep',
    })
  }

  return { body: { name: pouName, updated: false, rung: { comment: '', nodes, edges, selectedNodes: [] } }, warnings }
}
