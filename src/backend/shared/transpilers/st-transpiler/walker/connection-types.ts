/**
 * Pin-type inference — port of python's ComputeConnectionTypes +
 * ComputeBlockInputTypes (PLCGenerator.py:971-1241).
 *
 * Two passes over the flattened body graph. Pass 1 seeds concrete
 * types from declared variables, literals, contacts/coils/rails and
 * resolvable blocks; blocks with no known signature are deferred.
 * Pass 2 gives each deferred block a permissive all-ANY synthesized
 * signature and unifies each ANY-class pin group with any concrete
 * connected type. Pins known to share a type but still untyped live
 * in `related` groups that collapse when one member gets typed.
 */

import type { BlockInfos } from '../helpers/block-library'
import {
  asBlockData,
  asConnectorData,
  asContinuationData,
  asVariableData,
  asVariableExpressionData,
  type BlockData,
} from './narrow'
import type { RFBody, RFEdge, RFNode } from './types'

export interface TypeContext {
  /** Declared/dot-path/literal type of an expression, or null. */
  variableType(expression: string): string | null
  /** Block signature by type name (single generic signature), or null. */
  resolveBlock(typeName: string): BlockInfos | null
}

export function pinIn(nodeId: string, handle = ''): string {
  return `in:${nodeId}:${handle}`
}

export function pinOut(nodeId: string, handle = ''): string {
  return `out:${nodeId}:${handle}`
}

const LITERAL_TYPES: Record<string, string | null> = {
  T: 'TIME',
  D: 'DATE',
  TOD: 'TIME_OF_DAY',
  DT: 'DATE_AND_TIME',
  '2': null,
  '8': null,
  '16': null,
}

/** Literal-prefix typing from ComputeConnectionTypes (PLCGenerator.py:1001-1010). */
export function literalType(expression: string): string | null {
  const parts = expression.split('#')
  if (parts.length > 1) {
    const prefix = parts[0].toUpperCase()
    return prefix in LITERAL_TYPES ? LITERAL_TYPES[prefix] : prefix
  }
  if (expression.startsWith("'")) return 'STRING'
  if (expression.startsWith('"')) return 'WSTRING'
  return null
}

interface Graph {
  byId: Map<string, RFNode>
  incoming: Map<string, RFEdge[]>
}

class PinTypes {
  types = new Map<string, string>()
  related: string[][] = []

  extractRelated(pin: string): string[] {
    for (let i = 0; i < this.related.length; i++) {
      if (this.related[i].includes(pin)) return this.related.splice(i, 1)[0]
    }
    return [pin]
  }

  assign(pins: readonly string[], type: string): void {
    for (const pin of pins) this.types.set(pin, type)
  }
}

export function computeConnectionTypes(body: RFBody, ctx: TypeContext): Map<string, string> {
  const graph: Graph = { byId: new Map(), incoming: new Map() }
  const nodes: RFNode[] = []
  for (const rung of body.rungs) {
    for (const node of rung.nodes) {
      graph.byId.set(node.id, node)
      graph.incoming.set(node.id, [])
      nodes.push(node)
    }
    for (const edge of rung.edges) {
      graph.incoming.get(edge.target)?.push(edge)
    }
  }

  const pt = new PinTypes()
  const deferred: { node: RFNode; data: BlockData }[] = []

  for (const node of nodes) {
    switch (node.type) {
      case 'variable':
      case 'input-variable':
      case 'output-variable':
      case 'inout-variable': {
        const data = asVariableData(node.data)
        if (data === null) break
        const expr = asVariableExpressionData(node.data)?.expression ?? data.variable
        const varType = ctx.variableType(expr) ?? literalType(expr)
        if (varType === null) break
        if (data.variant === 'input' || data.variant === 'inout') {
          pt.assign(pt.extractRelated(pinOut(node.id)), varType)
        }
        if (data.variant === 'output' || data.variant === 'inout') {
          pt.types.set(pinIn(node.id), varType)
          const source = sourcePin(graph, node.id)
          if (source !== null && !pt.types.has(source)) {
            pt.assign(pt.extractRelated(source), varType)
          }
        }
        break
      }
      // `execute` is electrically a coil: BOOL in on `EN`, BOOL out on `ENO`,
      // so whatever feeds its EN infers BOOL like any other rung element.
      case 'contact':
      case 'coil':
      case 'parallel':
      case 'execute':
      case 'powerRail': {
        pt.assign(pt.extractRelated(pinOut(node.id)), 'BOOL')
        pt.types.set(pinIn(node.id), 'BOOL')
        for (const edge of graph.incoming.get(node.id) ?? []) {
          const source = edgeSourcePin(graph, edge)
          if (!pt.types.has(source)) pt.assign(pt.extractRelated(source), 'BOOL')
        }
        break
      }
      case 'continuation': {
        const name = asContinuationData(node.data)?.name
        if (name === undefined) break
        let connector: RFNode | null = null
        for (const candidate of nodes) {
          if (candidate.type === 'connector' && asConnectorData(candidate.data)?.name === name) {
            connector = candidate
            break
          }
        }
        if (connector === null) break
        const undefinedPins = [pinOut(node.id), pinIn(connector.id)]
        const source = sourcePin(graph, connector.id)
        if (source !== null) undefinedPins.push(source)
        let varType = 'ANY'
        const related: string[] = []
        for (const pin of undefinedPins) {
          const known = pt.types.get(pin)
          if (known !== undefined) varType = known
          else related.push(...pt.extractRelated(pin))
        }
        if (varType.startsWith('ANY') && related.length > 0) pt.related.push(related)
        else pt.assign(related, varType)
        break
      }
      case 'block': {
        const data = asBlockData(node.data)
        if (data === null) break
        const infos = ctx.resolveBlock(data.typeName)
        if (infos !== null) {
          computeBlockInputTypes(graph, pt, node, data, infos)
        } else {
          for (const handle of wiredInputHandles(graph, node, data)) {
            const pin = pinIn(node.id, handle)
            const source = sourcePin(graph, node.id, handle)
            if (source === null) continue
            const sourceType = pt.types.get(source)
            if (sourceType !== undefined) {
              pt.types.set(pin, sourceType)
            } else {
              const related = pt.extractRelated(source)
              related.push(pin)
              pt.related.push(related)
            }
          }
          deferred.push({ node, data })
        }
        break
      }
    }
  }

  for (const { node, data } of deferred) {
    const infos = synthesizePermissiveBlockInfos(graph, node, data)
    computeBlockInputTypes(graph, pt, node, data, infos)
  }

  return pt.types
}

/** ComputeBlockInputTypes (PLCGenerator.py:1183-1241). */
function computeBlockInputTypes(graph: Graph, pt: PinTypes, node: RFNode, data: BlockData, infos: BlockInfos): void {
  const undefinedGroups = new Map<string, string[]>()
  const bucket = (anyClass: string, pin: string) => {
    const group = undefinedGroups.get(anyClass) ?? []
    group.push(pin)
    undefinedGroups.set(anyClass, group)
  }

  for (const out of outputHandles(data)) {
    const pin = pinOut(node.id, out)
    if (out === 'ENO') {
      pt.assign(pt.extractRelated(pin), 'BOOL')
      continue
    }
    for (const formal of infos.outputs) {
      if (formal.name !== out) continue
      if (formal.type.startsWith('ANY')) bucket(formal.type, pin)
      else if (!pt.types.has(pin)) pt.assign(pt.extractRelated(pin), formal.type)
    }
  }

  for (const handle of wiredInputHandles(graph, node, data)) {
    const pin = pinIn(node.id, handle)
    if (handle === 'EN') {
      pt.assign(pt.extractRelated(pin), 'BOOL')
      continue
    }
    for (const formal of infos.inputs) {
      if (formal.name !== handle) continue
      const source = sourcePin(graph, node.id, handle)
      if (formal.type.startsWith('ANY')) {
        bucket(formal.type, pin)
        if (source !== null) bucket(formal.type, source)
      } else {
        pt.types.set(pin, formal.type)
        if (source !== null && !pt.types.has(source)) {
          pt.assign(pt.extractRelated(source), formal.type)
        }
      }
    }
  }

  for (const [anyClass, pins] of undefinedGroups) {
    let varType = anyClass
    const related: string[] = []
    for (const pin of pins) {
      const known = pt.types.get(pin)
      if (known !== undefined && !known.startsWith('ANY')) varType = known
      else related.push(...pt.extractRelated(pin))
    }
    if (varType.startsWith('ANY') && related.length > 0) pt.related.push(related)
    else pt.assign(related, varType)
  }
}

/** SynthesizePermissiveBlockInfos (PLCGenerator.py:732-763). */
function synthesizePermissiveBlockInfos(graph: Graph, node: RFNode, data: BlockData): BlockInfos {
  return {
    name: data.typeName,
    type: data.blockKind === 'function-block-instance' ? 'functionBlock' : 'function',
    extensible: false,
    inputs: wiredInputHandles(graph, node, data)
      .filter((h) => h !== 'EN')
      .map((h) => ({ name: h, type: 'ANY', qualifier: 'none' as const })),
    outputs: outputHandles(data)
      .filter((h) => h !== 'ENO')
      .map((h) => ({ name: h, type: 'ANY', qualifier: 'none' as const })),
    comment: '',
    usage: '',
  }
}

// python only ever sees serialized (wired) input pins; EN first when wired
function wiredInputHandles(graph: Graph, node: RFNode, data: BlockData): string[] {
  const wired = new Set((graph.incoming.get(node.id) ?? []).map((e) => e.targetHandle ?? ''))
  const handles: string[] = []
  if (wired.has('EN')) handles.push('EN')
  for (const name of data.inputs) {
    if (name === 'EN') continue
    if (wired.has(name)) handles.push(name)
  }
  return handles
}

function outputHandles(data: BlockData): string[] {
  const handles = [...data.outputs]
  if (data.executionControl && !handles.includes('ENO')) handles.push('ENO')
  return handles
}

function sourcePin(graph: Graph, nodeId: string, handle?: string): string | null {
  for (const edge of graph.incoming.get(nodeId) ?? []) {
    if (handle === undefined || (edge.targetHandle ?? '') === handle) {
      return edgeSourcePin(graph, edge)
    }
  }
  return null
}

function edgeSourcePin(graph: Graph, edge: RFEdge): string {
  const source = graph.byId.get(edge.source)
  if (source !== undefined && source.type === 'block') {
    return pinOut(edge.source, edge.sourceHandle ?? '')
  }
  return pinOut(edge.source)
}
