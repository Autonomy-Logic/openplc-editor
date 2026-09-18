import type { Node } from '@xyflow/react'

import type { RungLadderState } from '../../../../../../store/slices/ladder'
import { defaultCustomNodesStyles, nodesBuilder } from '../../../../../_atoms/graphical-editor/ladder/node-builders'
import type { BuilderBasicProps } from '../../../../../_atoms/graphical-editor/ladder/utils/types'

export const findNode = (
  rung: RungLadderState,
  nodeId: string,
): { node: Node | undefined; position: number | undefined } => {
  return {
    node: rung.nodes.find((node) => node.id === nodeId),
    position: rung.nodes.findIndex((node) => node.id === nodeId),
  }
}

export const removeNode = (rung: RungLadderState, nodeId: string): Node[] => {
  return rung.nodes.filter((node) => node.id !== nodeId)
}

export const isNodeOfType = (node: Node, nodeType: string): boolean => {
  return node.type === nodeType
}

export const getDefaultNodeStyle = ({ node, nodeType }: { node?: Node; nodeType?: string }) => {
  return defaultCustomNodesStyles[node?.type ?? nodeType ?? 'mockNode']
}

/** Origin placeholder inherited from the synthetic `-1` node that used to be
 *  prepended to the `getNodesBounds` call. Dominated by `rung.defaultBounds`
 *  ([300, 100] in production) on every real path; kept so the computation stays
 *  numerically identical to the xyflow one it replaces. */
const ORIGIN_NODE_SIZE = { width: 150, height: 40 }

/**
 * Bounding box of a rung's nodes, measured from the flow origin (0, 0).
 *
 * Replaces the standalone `getNodesBounds` from `@xyflow/react`, which warns in
 * dev since v12 unless it is handed the internal `nodeLookup`. The hook form
 * (`useReactFlow().getNodesBounds`) reads the store ReactFlow has already
 * adopted, which lags the rung state this runs on by a frame — so it would swap
 * a warning for stale numbers. Ladder rungs are flat (no subflows, no
 * `parentId`, no node `origin`), so the box is just the node rectangles unioned
 * with the origin, exactly what xyflow computed.
 *
 * The dimension precedence mirrors xyflow's own `nodeToRect`:
 * `measured` (written by `applyNodeChanges` on dimension changes), then the
 * declared `width`/`height`, then `initialWidth`/`initialHeight`. Every ladder
 * builder in `_atoms/graphical-editor/ladder/node-builders.ts` sets explicit
 * dimensions, so the initial-* step is unreachable today — it is here so the
 * fallback chain stays honest to the helper it replaces.
 */
export const getRungNodesBounds = (nodes: Node[]): { width: number; height: number } =>
  nodes.reduce(
    (bounds, node) => ({
      width: Math.max(bounds.width, node.position.x + (node.measured?.width ?? node.width ?? node.initialWidth ?? 0)),
      height: Math.max(
        bounds.height,
        node.position.y + (node.measured?.height ?? node.height ?? node.initialHeight ?? 0),
      ),
    }),
    { ...ORIGIN_NODE_SIZE },
  )

export const buildGenericNode = <T>({
  nodeType,
  blockType,
  id,
  posX,
  posY,
  handleX,
  handleY,
}: BuilderBasicProps & {
  nodeType: string
  blockType?: T | undefined
}) => {
  switch (nodeType) {
    case 'block':
      return nodesBuilder.block({
        id,
        posX,
        posY,
        handleX,
        handleY,
        variant: blockType ?? undefined,
      })
    case 'coil':
      return nodesBuilder.coil({
        id,
        posX,
        posY,
        handleX,
        handleY,
        variant: 'default',
      })
    case 'contact':
      return nodesBuilder.contact({
        id,
        posX,
        posY,
        handleX,
        handleY,
        variant: 'default',
      })
    case 'parallel':
      return nodesBuilder.parallel({
        id,
        posX,
        posY,
        handleX,
        handleY,
        type: 'open',
      })
    default:
      return nodesBuilder.mockNode({
        id,
        label: id,
        posX,
        posY,
        handleX,
        handleY,
      })
  }
}
