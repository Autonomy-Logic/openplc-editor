/**
 * Build an FBD rung from a description: place the nodes, then wire them.
 *
 * Hosted in the store rather than beside the editor because the node builders
 * are component modules the CLI may not import, and this is the seam that lets
 * a headless caller produce the same diagram the editor would.
 *
 * FBD gets neither of the things ladder gets for free — `addFBDFlow` never
 * touches geometry and `fbd-utils/edges.ts` is empty — so both the placement and
 * the edge ids are produced here.
 */

import type { Edge, Node } from '@xyflow/react'

import { buildGenericNode } from '../../../../components/_molecules/graphical-editor/fbd/fbd-utils/nodes'
import { newGraphicalEditorNodeID } from '../../../../utils/new-graphical-editor-node-id'
import { type LayoutConnection, layoutFbdGraph } from './layout'

export type FbdNodeKind = 'block' | 'input-variable' | 'output-variable' | 'inout-variable' | 'comment'

export interface FbdGraphNode {
  /** Caller-local name. Store ids are minted here. */
  label: string
  kind: FbdNodeKind
  /** Block signature, already resolved. */
  variant?: unknown
  /** Variable name, or a function block's instance name. */
  variable?: string
  /** `comment` only. */
  text?: string
  /** Add EN/ENO to a block. */
  executionControl?: boolean
  /** Evaluation order for a block; 0 leaves it unordered. */
  executionOrder?: number
}

export interface FbdGraphConnection {
  /** `label` or `label.PIN`. */
  from: string
  to: string
}

export interface BuildFbdGraphResult {
  nodes: Node[]
  edges: Edge[]
  brokenCycles: LayoutConnection[]
  errors: string[]
}

/** React Flow's own edge id — the form the XML parser writes and reads. */
function edgeId(source: string, sourceHandle: string, target: string, targetHandle: string): string {
  return `xy-edge__${source}${sourceHandle}-${target}${targetHandle}`
}

/** `label` or `label.PIN`. A variable node's pin follows from its direction. */
export function splitPinRef(ref: string): { label: string; pin?: string } {
  const dot = ref.indexOf('.')
  return dot < 0 ? { label: ref } : { label: ref.slice(0, dot), pin: ref.slice(dot + 1) }
}

export function buildFbdGraph(
  specNodes: readonly FbdGraphNode[],
  connections: readonly FbdGraphConnection[],
): BuildFbdGraphResult {
  const errors: string[] = []

  const placed = layoutFbdGraph(
    specNodes.map((node) => ({ id: node.label })),
    connections.map((connection) => ({
      from: splitPinRef(connection.from).label,
      to: splitPinRef(connection.to).label,
    })),
  )

  const idByLabel = new Map<string, string>()
  const nodes: Node[] = []

  for (const spec of specNodes) {
    const position = placed.positions.get(spec.label) ?? { x: 0, y: 0 }
    const id = newGraphicalEditorNodeID(spec.kind.toUpperCase())
    const node = buildGenericNode({
      id,
      position,
      nodeType: spec.kind,
      blockType: spec.variant,
      executionControl: spec.executionControl,
    }) as Node | undefined
    if (!node) {
      errors.push(`node "${spec.label}" has an unknown kind "${spec.kind}"`)
      continue
    }

    const data = node.data as {
      variable?: { id: string; name: string }
      value?: string
      executionOrder?: number
    }
    if (spec.variable) data.variable = { id: '', name: spec.variable }
    if (spec.kind === 'comment' && spec.text) data.value = spec.text
    if (spec.executionOrder !== undefined) data.executionOrder = spec.executionOrder

    idByLabel.set(spec.label, id)
    nodes.push(node)
  }

  const edges: Edge[] = []
  for (const connection of connections) {
    const from = splitPinRef(connection.from)
    const to = splitPinRef(connection.to)
    const sourceId = idByLabel.get(from.label)
    const targetId = idByLabel.get(to.label)
    if (!sourceId || !targetId) {
      errors.push(`connection "${connection.from}" -> "${connection.to}" names an unknown node`)
      continue
    }

    // On a block the pin name IS the handle id; a variable node carries one
    // fixed handle per direction.
    const sourceHandle = from.pin ?? 'output-variable'
    const targetHandle = to.pin ?? 'input-variable'

    edges.push({
      id: edgeId(sourceId, sourceHandle, targetId, targetHandle),
      source: sourceId,
      sourceHandle,
      target: targetId,
      targetHandle,
    })
  }

  return { nodes, edges, brokenCycles: placed.brokenCycles, errors }
}
