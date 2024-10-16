import { ContactNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes/contact'
import { ParallelNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes/parallel'
import { BasicNodeData } from '@root/renderer/components/_atoms/react-flow/custom-nodes/utils/types'
import { RungState } from '@root/renderer/store/slices'
import { ContactLadderXML } from '@root/types/PLC/language-data/ladder-diagram'
import { Node } from '@xyflow/react'

/**
 * Find the connections of a node in a rung.
 */
const findNodeBasedOnParallelOpen = (parallelNode: ParallelNode, rung: RungState, path: ParallelNode[] = []) => {
  const { nodes: rungNodes, edges: rungEdges } = rung

  const edgeToParallelNode = rungEdges.find((edge) => edge.target === parallelNode.id)?.source
  const sourceNodeOfParallelNode = rungNodes.find((node) => node.id === edgeToParallelNode) as Node<BasicNodeData>
  path.push(parallelNode)

  if (sourceNodeOfParallelNode.type !== 'parallel') return { node: sourceNodeOfParallelNode, path: path }
  else {
    return findNodeBasedOnParallelOpen(sourceNodeOfParallelNode as ParallelNode, rung, path)
  }
}

const findNodesBasedOnParallelClose = (
  parallelNode: ParallelNode,
  rung: RungState,
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

const findConnections = (node: Node<BasicNodeData>, rung: RungState) => {
  const { nodes: rungNodes, edges: rungEdges } = rung

  const connectedEdges = rungEdges.filter((edge) => edge.target === node.id)
  if (!connectedEdges.length) return []

  const connections = connectedEdges.map((edge) => {
    const sourceNode = rungNodes.find((node) => node.id === edge.source) as Node<BasicNodeData>
    if (!sourceNode) return undefined

    // Node is not a parallel node
    if (sourceNode.type !== 'parallel')
      return {
        'reference-to-local-id': sourceNode.id,
        positions: [
          // Final edge destination
          {
            ...node.data.inputConnector?.glbPosition,
          },
          // Initial edge source
          {
            ...sourceNode.data.outputConnector?.glbPosition,
          },
        ],
      }

    // Node is a parallel node
    const parallelNode = sourceNode as ParallelNode

    // If the parallel node is openning the connection
    if (parallelNode.data.type === 'open') {
      // Find the previous node of the parallel node
      const { node: sourceNodeOfParallelNode, path } = findNodeBasedOnParallelOpen(parallelNode, rung)

      const lastParallelNode = path[path.length - 1]
      const lastParallelSerialEdge = rungEdges.find(
        (edge) =>
          edge.source === lastParallelNode.id && edge.sourceHandle === lastParallelNode.data.outputConnector?.id,
      )

      // If the node is connected serially to the parallel node
      if (lastParallelSerialEdge && lastParallelSerialEdge.target === node.id) {
        return {
          'reference-to-local-id': sourceNodeOfParallelNode.id,
          positions: [
            // Final edge destination
            {
              ...node.data.inputConnector?.glbPosition,
            },
            // Initial edge source
            {
              ...sourceNodeOfParallelNode.data.outputConnector?.glbPosition,
            },
          ],
        }
      }

      // If the node is connected in parallel to the parallel node
      return {
        'reference-to-local-id': sourceNodeOfParallelNode.id,
        positions: [
          // Final edge destination
          {
            ...node.data.inputConnector?.glbPosition,
          },
          // Final position of parallel
          {
            x: lastParallelNode.data.parallelOutputConnector?.glbPosition.x,
            y: node.data.inputConnector?.glbPosition.y,
          },
          // Initial position of parallel
          {
            x: lastParallelNode.data.parallelOutputConnector?.glbPosition.x,
            y: sourceNodeOfParallelNode.data.outputConnector?.glbPosition.y,
          },
          // Initial edge source
          {
            ...sourceNodeOfParallelNode.data.outputConnector?.glbPosition,
          },
        ],
      }
    }

    // If the parallel node is closing the connection
    const { nodes, parallels } = findNodesBasedOnParallelClose(parallelNode, rung)
    const actualNode = node

    const firstParallelNode = parallels[0]
    const closeConnections = nodes.map((node, index) => {
      return {
        'reference-to-local-id': node.id,
        positions:
          index === 0
            ? [
                // Final edge destination
                {
                  ...actualNode.data.inputConnector?.glbPosition,
                },
                // Initial edge source
                {
                  ...firstParallelNode.data.inputConnector?.glbPosition,
                },
              ]
            : [
                // Final edge destination
                {
                  ...actualNode.data.inputConnector?.glbPosition,
                },
                // Final position of parallel
                {
                  x: firstParallelNode.data.parallelInputConnector?.glbPosition.x,
                  y: actualNode.data.inputConnector?.glbPosition.y,
                },
                // Initial position of parallel
                {
                  x: firstParallelNode.data.parallelInputConnector?.glbPosition.x,
                  y: node.data.outputConnector?.glbPosition.y,
                },
                // Initial edge source
                {
                  ...node.data.outputConnector?.glbPosition,
                },
              ],
      }
    })

    return closeConnections
  })

  return connections.filter(
    (connection) => connection !== undefined,
  ) as ContactLadderXML['connection-point-in']['connections']
}

/**
 * Parse nodes to XML
 */
const contactToXML = (contact: ContactNode, rung: RungState): ContactLadderXML => {
  const connections = findConnections(contact, rung)

  return {
    'local-id': contact.id,
    negated: contact.data.variant === 'negated',
    edges:
      contact.data.variant === 'risingEdge' ? 'rising' : contact.data.variant === 'fallingEdge' ? 'falling' : undefined,
    width: contact.width as number,
    height: contact.height as number,
    position: contact.position,
    variable: '',
    'connection-point-in': {
      'relative-position': {
        ...(contact.data.inputConnector?.relPosition || { x: 0, y: 0 }),
      },
      connections,
    },
    'connection-point-out': {
      'relative-position': {
        ...(contact.data.outputConnector?.relPosition || { x: 0, y: 0 }),
      },
    },
  }
}

/**
 * Entry point to parse nodes to XML
 */
const nodesToXML = (rungs: RungState[]) => {
  console.log('PARSING TO XML')
  const xml: unknown[] = []
  rungs.forEach((rung) => {
    const { nodes } = rung
    nodes.forEach((node) => {
      if (node.type === 'contact') {
        xml.push(contactToXML(node as ContactNode, rung))
      }
    })
  })
  console.log(xml)
}

export { nodesToXML }
