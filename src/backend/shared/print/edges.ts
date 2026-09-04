import type { Edge, Node } from '@xyflow/react'
import { getSmoothStepPath, Position } from '@xyflow/system'

import type { DrawOp, RgbHex } from './types'

type LocalHandle = {
  id?: string
  position?: string
  relPosition?: { x: number; y: number }
}

function isLocalHandle(value: unknown): value is LocalHandle {
  return typeof value === 'object' && value !== null
}

function getNodeHandles(node: Node): LocalHandle[] {
  const data = node.data as Record<string, unknown> | undefined
  const handles = data?.handles
  return Array.isArray(handles) ? handles.filter(isLocalHandle) : []
}

function asPosition(value: string | undefined): Position | undefined {
  switch (value) {
    case Position.Left:
    case Position.Right:
    case Position.Top:
    case Position.Bottom:
      return value
    default:
      return undefined
  }
}

type HandlePoint = { x: number; y: number; position: Position }

function resolveHandlePoint(node: Node, handleId: string | null | undefined, fallback: Position): HandlePoint {
  const handle = handleId ? getNodeHandles(node).find((h) => h.id === handleId) : undefined
  if (!handle?.relPosition) {
    return { x: node.position.x, y: node.position.y, position: fallback }
  }
  return {
    x: node.position.x + handle.relPosition.x,
    y: node.position.y + handle.relPosition.y,
    position: asPosition(handle.position) ?? fallback,
  }
}

/**
 * Renders one edge as a `path` DrawOp, replicating xyflow's on-screen
 * `smoothstep` edge geometry exactly (`@xyflow/system` is the library the
 * live canvas already uses for this). Coordinates are absolute, in the same
 * top-down node-space as the source/target nodes — no extra offset needed.
 */
export function edgeToDrawOp(
  nodesById: Map<string, Node>,
  edge: Edge,
  color: RgbHex,
  strokeWidth: number,
): DrawOp | undefined {
  const source = nodesById.get(edge.source)
  const target = nodesById.get(edge.target)
  if (!source || !target) return undefined

  const sourcePoint = resolveHandlePoint(source, edge.sourceHandle, Position.Right)
  const targetPoint = resolveHandlePoint(target, edge.targetHandle, Position.Left)

  const [path] = getSmoothStepPath({
    sourceX: sourcePoint.x,
    sourceY: sourcePoint.y,
    sourcePosition: sourcePoint.position,
    targetX: targetPoint.x,
    targetY: targetPoint.y,
    targetPosition: targetPoint.position,
  })

  return { kind: 'path', d: path, x: 0, y: 0, scale: 1, stroke: color, strokeWidthPt: strokeWidth }
}

/** Node types whose edges (as endpoints) are structural-only and never rendered — mirrors `graphical-diff-viewer.tsx`. */
const HIDDEN_EDGE_NODE_TYPES = new Set(['placeholder', 'parallelPlaceholder', 'mockNode'])

export function isVisibleEdge(nodesById: Map<string, Node>, edge: Edge): boolean {
  const source = nodesById.get(edge.source)
  const target = nodesById.get(edge.target)
  if (!source || !target) return false
  return !HIDDEN_EDGE_NODE_TYPES.has(source.type ?? '') && !HIDDEN_EDGE_NODE_TYPES.has(target.type ?? '')
}
