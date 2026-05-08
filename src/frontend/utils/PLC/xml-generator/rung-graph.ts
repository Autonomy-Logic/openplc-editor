import type {
  BasicNodeData,
  ParallelNode,
} from '@root/frontend/components/_atoms/graphical-editor/ladder/utils/types'
import type { RungLadderState } from '@root/frontend/store/slices'
import type { Node } from '@xyflow/react'

/**
 * Shared rung-graph traversal helpers used by every ladder XML dialect.
 *
 * The two dialect formatters (codesys and old-editor) emit different XML, but
 * walk the same rung graph and resolve the same set of incoming connections
 * for each node. This module owns that traversal so each dialect only handles
 * the dialect-specific output shape.
 */

type RungConnectionPosition = { '@x': number; '@y': number }

export type RungConnection = {
  '@refLocalId': string
  '@formalParameter': string
  position: RungConnectionPosition[]
}

export type FindConnectionsOptions = {
  /** When provided, only edges whose `targetHandle` matches are considered. */
  targetHandle?: string
  /**
   * Optional dialect-specific formatter for the source node's output connector id,
   * applied when populating each connection's `@formalParameter`. Defaults to the
   * raw id with `''` substituted for undefined.
   */
  formatFormalParameter?: (rawId: string | undefined) => string
}

const defaultFormatFormalParameter = (rawId: string | undefined): string => rawId ?? ''

/**
 * Walk backward from a parallel-open node, collecting the upstream serial nodes
 * and the parallel nodes encountered along the way.
 */
export const findNodeBasedOnParallelOpen = (
  parallelNode: ParallelNode,
  rung: RungLadderState,
  path: {
    nodes: Node<BasicNodeData>[]
    parallels: ParallelNode[]
  } = { nodes: [], parallels: [] },
) => {
  const { nodes: rungNodes, edges: rungEdges } = rung

  const edgeToParallelNode = rungEdges.find((edge) => edge.target === parallelNode.id)?.source
  const sourceNodeOfParallelNode = rungNodes.find((node) => node.id === edgeToParallelNode) as Node<BasicNodeData>
  path.parallels.push(parallelNode)

  if (sourceNodeOfParallelNode.type !== 'parallel') {
    path.nodes.push(sourceNodeOfParallelNode)
    return path
  } else if ((sourceNodeOfParallelNode as ParallelNode).data.type === 'close') {
    return findNodesBasedOnParallelClose(sourceNodeOfParallelNode as ParallelNode, rung, path)
  } else {
    return findNodeBasedOnParallelOpen(sourceNodeOfParallelNode as ParallelNode, rung, path)
  }
}

/**
 * Walk backward from a parallel-close node, collecting both the serial-spine
 * upstream and the parallel-path upstream nodes plus all parallel nodes seen.
 */
export const findNodesBasedOnParallelClose = (
  parallelNode: ParallelNode,
  rung: RungLadderState,
  path: {
    nodes: Node<BasicNodeData>[]
    parallels: ParallelNode[]
  } = { nodes: [], parallels: [] },
) => {
  const { nodes: rungNodes, edges: rungEdges } = rung

  const edgesToParallelNode = rungEdges.filter((edge) => edge.target === parallelNode.id)
  const serialNode = rungNodes.find((node) =>
    edgesToParallelNode.find(
      (edge) => edge.source === node.id && edge.targetHandle === parallelNode.data.inputConnector?.id,
    ),
  ) as Node<BasicNodeData>

  if (!path.nodes.includes(serialNode)) path.nodes.push(serialNode)

  const bottomNode = rungNodes.find((node) =>
    edgesToParallelNode.find(
      (edge) => edge.source === node.id && edge.targetHandle === parallelNode.data.parallelInputConnector?.id,
    ),
  ) as Node<BasicNodeData>

  path.parallels.push(parallelNode)

  if (bottomNode.type !== 'parallel') {
    path.nodes.push(bottomNode)
    return path
  }

  return findNodesBasedOnParallelClose(bottomNode as ParallelNode, rung, path)
}

/**
 * Find all incoming connections for a node, resolving parallel sources into
 * waypoint chains. Skips edges whose source is a variable node (variables are
 * resolved separately by each dialect's block / variable formatter).
 *
 * When `options.targetHandle` is supplied, only edges whose `targetHandle`
 * matches are considered — required when a node has multiple input handles
 * that may be wired to different sources (e.g. a function block with branch
 * contacts on individual input handles).
 */
export const findConnections = (
  node: Node<BasicNodeData>,
  rung: RungLadderState,
  offsetY: number = 0,
  options: FindConnectionsOptions = {},
): RungConnection[] => {
  const { nodes: rungNodes, edges: rungEdges } = rung
  const { targetHandle, formatFormalParameter = defaultFormatFormalParameter } = options

  const connectedEdges = rungEdges.filter(
    (edge) => edge.target === node.id && (targetHandle === undefined || edge.targetHandle === targetHandle),
  )
  if (!connectedEdges.length) return []

  const connections = connectedEdges.map((edge) => {
    const sourceNode = rungNodes.find((node) => node.id === edge.source) as Node<BasicNodeData>
    // If the source node is not found or it is a variable node, return undefined
    if (!sourceNode || sourceNode.type === 'variable') return undefined

    // Node is not a parallel node
    if (sourceNode.type !== 'parallel') {
      return {
        '@refLocalId': sourceNode.data.numericId,
        '@formalParameter': formatFormalParameter(sourceNode.data.outputConnector?.id),
        position: [
          // Final edge destination
          {
            '@x': node.data.inputConnector?.glbPosition.x ?? 0,
            '@y': (node.data.inputConnector?.glbPosition.y ?? 0) + offsetY,
          },
          // Initial edge source
          {
            '@x': sourceNode.data.outputConnector?.glbPosition.x ?? 0,
            '@y': (sourceNode.data.outputConnector?.glbPosition.y ?? 0) + offsetY,
          },
        ],
      }
    }

    // Node is a parallel node
    const parallelNode = sourceNode as ParallelNode

    /**
     * TODO: This is a temporary solution to find the connections of a parallel node.
     * This should be refactored so that the lines are placed correctly
     */

    // If the parallel node is opening the connection
    if (parallelNode.data.type === 'open') {
      // Find the previous node of the parallel node
      const { nodes, parallels } = findNodeBasedOnParallelOpen(parallelNode, rung)
      const actualNode = node

      const lastParallelNode = parallels
        .filter((parallel) => parallel.data.type === 'open')
        .reverse()
        .copyWithin(0, 1)[0]
      const lastParallelSerialEdge = rungEdges.find(
        (edge) =>
          edge.source === lastParallelNode.id && edge.sourceHandle === lastParallelNode.data.outputConnector?.id,
      )

      // If the node is connected serially to the parallel node
      if (lastParallelSerialEdge && lastParallelSerialEdge.target === actualNode.id) {
        return nodes.map((node, index) => ({
          '@refLocalId': node.data.numericId,
          '@formalParameter': formatFormalParameter(node.data.outputConnector?.id),
          position:
            index === 0
              ? [
                  // Final edge destination
                  {
                    '@x': actualNode.data.inputConnector?.glbPosition.x ?? 0,
                    '@y': (actualNode.data.inputConnector?.glbPosition.y ?? 0) + offsetY,
                  },
                  // Initial edge source
                  {
                    '@x': node.data.outputConnector?.glbPosition.x ?? 0,
                    '@y': (node.data.outputConnector?.glbPosition.y ?? 0) + offsetY,
                  },
                ]
              : [
                  // Final edge destination
                  {
                    '@x': actualNode.data.inputConnector?.glbPosition.x ?? 0,
                    '@y': (actualNode.data.inputConnector?.glbPosition.y ?? 0) + offsetY,
                  },
                  // Final position of parallel
                  {
                    '@x': lastParallelNode.data.parallelInputConnector?.glbPosition.x ?? 0,
                    '@y': (actualNode.data.inputConnector?.glbPosition.y ?? 0) + offsetY,
                  },
                  // Initial position of parallel
                  {
                    '@x': lastParallelNode.data.parallelInputConnector?.glbPosition.x ?? 0,
                    '@y': (node.data.outputConnector?.glbPosition.y ?? 0) + offsetY,
                  },
                  // Initial edge source
                  {
                    '@x': node.data.outputConnector?.glbPosition.x ?? 0,
                    '@y': (node.data.outputConnector?.glbPosition.y ?? 0) + offsetY,
                  },
                ],
        }))
      }

      return nodes.map((node) => {
        return {
          '@refLocalId': node.data.numericId,
          '@formalParameter': formatFormalParameter(node.data.outputConnector?.id),
          position: [
            // Final edge destination
            {
              '@x': actualNode.data.inputConnector?.glbPosition.x ?? 0,
              '@y': (actualNode.data.inputConnector?.glbPosition.y ?? 0) + offsetY,
            },
            // Final position of parallel
            {
              '@x': lastParallelNode.data.parallelInputConnector?.glbPosition.x ?? 0,
              '@y': (actualNode.data.inputConnector?.glbPosition.y ?? 0) + offsetY,
            },
            // Initial position of parallel
            {
              '@x': lastParallelNode.data.parallelInputConnector?.glbPosition.x ?? 0,
              '@y': (node.data.outputConnector?.glbPosition.y ?? 0) + offsetY,
            },
            // Initial edge source
            {
              '@x': node.data.outputConnector?.glbPosition.x ?? 0,
              '@y': (node.data.outputConnector?.glbPosition.y ?? 0) + offsetY,
            },
          ],
        }
      })
    }

    // If the parallel node is closing the connection
    const { nodes, parallels } = findNodesBasedOnParallelClose(parallelNode, rung)
    const actualNode = node

    const firstParallelNode = parallels[0]
    const closeConnections = nodes.map((node, index) => {
      return {
        '@refLocalId': node.data.numericId,
        '@formalParameter': formatFormalParameter(node.data.outputConnector?.id),
        position:
          index === 0
            ? [
                // Final edge destination
                {
                  '@x': actualNode.data.inputConnector?.glbPosition.x ?? 0,
                  '@y': (actualNode.data.inputConnector?.glbPosition.y ?? 0) + offsetY,
                },
                // Initial edge source
                {
                  '@x': node.data.outputConnector?.glbPosition.x ?? 0,
                  '@y': (node.data.outputConnector?.glbPosition.y ?? 0) + offsetY,
                },
              ]
            : [
                // Final edge destination
                {
                  '@x': actualNode.data.inputConnector?.glbPosition.x ?? 0,
                  '@y': (actualNode.data.inputConnector?.glbPosition.y ?? 0) + offsetY,
                },
                // Final position of parallel
                {
                  '@x': firstParallelNode.data.parallelInputConnector?.glbPosition.x ?? 0,
                  '@y': (actualNode.data.inputConnector?.glbPosition.y ?? 0) + offsetY,
                },
                // Initial position of parallel
                {
                  '@x': firstParallelNode.data.parallelInputConnector?.glbPosition.x ?? 0,
                  '@y': (node.data.outputConnector?.glbPosition.y ?? 0) + offsetY,
                },
                // Initial edge source
                {
                  '@x': node.data.outputConnector?.glbPosition.x ?? 0,
                  '@y': (node.data.outputConnector?.glbPosition.y ?? 0) + offsetY,
                },
              ],
      }
    })

    return closeConnections
  })

  return connections.flat().filter((connection) => connection !== undefined) as RungConnection[]
}
