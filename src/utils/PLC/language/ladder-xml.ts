import { CoilNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes/coil'
import { ContactNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes/contact'
import { ParallelNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes/parallel'
import { PowerRailNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes/power-rail'
import { BasicNodeData } from '@root/renderer/components/_atoms/react-flow/custom-nodes/utils/types'
import { RungState } from '@root/renderer/store/slices'
import {
  CoilLadderXML,
  ContactLadderXML,
  LadderXML,
  LeftPowerRailLadderXML,
  RightPowerRailLadderXML,
} from '@root/types/PLC/xml-data/pous/languages/ladder-diagram'
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

const findConnections = (node: Node<BasicNodeData>, rung: RungState, offsetY: number = 0) => {
  const { nodes: rungNodes, edges: rungEdges } = rung

  const connectedEdges = rungEdges.filter((edge) => edge.target === node.id)
  if (!connectedEdges.length) return []

  const connections = connectedEdges.map((edge) => {
    const sourceNode = rungNodes.find((node) => node.id === edge.source) as Node<BasicNodeData>
    if (!sourceNode) return undefined

    // Node is not a parallel node
    if (sourceNode.type !== 'parallel')
      return {
        '@refLocalId': sourceNode.data.numericId,
        position: [
          // Final edge destination
          {
            '@x': node.data.inputConnector?.glbPosition.x,
            '@y': (node.data.inputConnector?.glbPosition.y ?? 0) + offsetY,
          },
          // Initial edge source
          {
            '@x': sourceNode.data.outputConnector?.glbPosition.x,
            '@y': (sourceNode.data.outputConnector?.glbPosition.y ?? 0) + offsetY,
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
          '@refLocalId': sourceNodeOfParallelNode.data.numericId,
          position: [
            // Final edge destination
            {
              '@x': node.data.inputConnector?.glbPosition.x,
              '@y': (node.data.inputConnector?.glbPosition.y ?? 0) + offsetY,
            },
            // Initial edge source
            {
              '@x': lastParallelNode.data.outputConnector?.glbPosition.x,
              '@y': (lastParallelNode.data.outputConnector?.glbPosition.y ?? 0) + offsetY,
            },
          ],
        }
      }

      // If the node is connected in parallel to the parallel node
      return {
        '@refLocalId': sourceNodeOfParallelNode.data.numericId,
        position: [
          // Final edge destination
          {
            '@x': node.data.inputConnector?.glbPosition.x,
            '@y': (node.data.inputConnector?.glbPosition.y ?? 0) + offsetY,
          },
          // Final position of parallel
          {
            '@x': lastParallelNode.data.parallelOutputConnector?.glbPosition.x,
            '@y': (node.data.inputConnector?.glbPosition.y ?? 0) + offsetY,
          },
          // Initial position of parallel
          {
            '@x': lastParallelNode.data.parallelOutputConnector?.glbPosition.x,
            '@y': (sourceNodeOfParallelNode.data.outputConnector?.glbPosition.y ?? 0) + offsetY,
          },
          // Initial edge source
          {
            '@x': sourceNodeOfParallelNode.data.outputConnector?.glbPosition.x,
            '@y': (sourceNodeOfParallelNode.data.outputConnector?.glbPosition.y ?? 0) + offsetY,
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
        '@refLocalId': node.data.numericId,
        position:
          index === 0
            ? [
                // Final edge destination
                {
                  '@x': actualNode.data.inputConnector?.glbPosition.x,
                  '@y': (actualNode.data.inputConnector?.glbPosition.y ?? 0) + offsetY,
                },
                // Initial edge source
                {
                  '@x': node.data.outputConnector?.glbPosition.x,
                  '@y': (node.data.outputConnector?.glbPosition.y ?? 0) + offsetY,
                },
              ]
            : [
                // Final edge destination
                {
                  '@x': actualNode.data.inputConnector?.glbPosition.x,
                  '@y': (actualNode.data.inputConnector?.glbPosition.y ?? 0) + offsetY,
                },
                // Final position of parallel
                {
                  '@x': firstParallelNode.data.parallelInputConnector?.glbPosition.x,
                  '@y': (actualNode.data.inputConnector?.glbPosition.y ?? 0) + offsetY,
                },
                // Initial position of parallel
                {
                  '@x': firstParallelNode.data.parallelInputConnector?.glbPosition.x,
                  '@y': (node.data.outputConnector?.glbPosition.y ?? 0) + offsetY,
                },
                // Initial edge source
                {
                  '@x': node.data.outputConnector?.glbPosition.x,
                  '@y': (node.data.outputConnector?.glbPosition.y ?? 0) + offsetY,
                },
              ],
      }
    })

    return closeConnections
  })

  return connections.filter(
    (connection) => connection !== undefined,
  ) as ContactLadderXML['connectionPointIn']['connection']
}

/**
 * Parse nodes to XML
 */
const leftRailToXML = (leftRail: PowerRailNode, offsetY: number = 0): LeftPowerRailLadderXML => {
  return {
    '@localId': leftRail.data.numericId,
    '@width': leftRail.width as number,
    '@height': leftRail.height as number,
    position: {
      '@x': leftRail.position.x,
      '@y': (leftRail.position.y ?? 0) + offsetY,
    },
    connectionPointOut: {
      '@formalParameter': '',
      relPosition: {
        '@x': leftRail.data.outputConnector?.relPosition.x || 0,
        '@y': leftRail.data.outputConnector?.relPosition.y || 0,
      },
    },
  }
}

const rightRailToXML = (rightRail: PowerRailNode, rung: RungState, offsetY: number = 0): RightPowerRailLadderXML => {
  const connections = findConnections(rightRail, rung, offsetY)

  return {
    '@localId': rightRail.data.numericId,
    '@width': rightRail.width as number,
    '@height': rightRail.height as number,
    position: {
      '@x': rightRail.position.x,
      '@y': (rightRail.position.y ?? 0) + offsetY,
    },
    connectionPointIn: {
      relPosition: {
        '@x': rightRail.data.inputConnector?.relPosition.x || 0,
        '@y': rightRail.data.inputConnector?.relPosition.y || 0,
      },
      connection: connections,
    },
  }
}

const contactToXML = (contact: ContactNode, rung: RungState, offsetY: number = 0): ContactLadderXML => {
  const connections = findConnections(contact, rung, offsetY)

  return {
    '@localId': contact.data.numericId,
    '@negated': contact.data.variant === 'negated',
    '@edge':
      contact.data.variant === 'risingEdge' ? 'rising' : contact.data.variant === 'fallingEdge' ? 'falling' : undefined,
    '@width': contact.width as number,
    '@height': contact.height as number,
    position: {
      '@x': contact.position.x,
      '@y': (contact.position.y ?? 0) + offsetY,
    },
    variable: 'A',
    connectionPointIn: {
      relPosition: {
        '@x': contact.data.inputConnector?.relPosition.x || 0,
        '@y': contact.data.inputConnector?.relPosition.y || 0,
      },
      connection: connections,
    },
    connectionPointOut: {
      relPosition: {
        '@x': contact.data.outputConnector?.relPosition.x || 0,
        '@y': contact.data.outputConnector?.relPosition.y || 0,
      },
    },
  }
}

const coilToXml = (coil: CoilNode, rung: RungState, offsetY: number = 0): CoilLadderXML => {
  const connections = findConnections(coil, rung, offsetY)

  return {
    '@localId': coil.data.numericId,
    '@negated': coil.data.variant === 'negated',
    '@edge':
      coil.data.variant === 'risingEdge' ? 'rising' : coil.data.variant === 'fallingEdge' ? 'falling' : undefined,
    '@storage': coil.data.variant === 'set' ? 'set' : coil.data.variant === 'reset' ? 'reset' : undefined,
    '@width': coil.width as number,
    '@height': coil.height as number,
    position: {
      '@x': coil.position.x,
      '@y': (coil.position.y ?? 0) + offsetY,
    },
    variable: 'A',
    connectionPointIn: {
      relPosition: {
        '@x': coil.data.inputConnector?.relPosition.x || 0,
        '@y': coil.data.inputConnector?.relPosition.y || 0,
      },
      connection: connections,
    },
    connectionPointOut: {
      relPosition: {
        '@x': coil.data.outputConnector?.relPosition.x || 0,
        '@y': coil.data.outputConnector?.relPosition.y || 0,
      },
    },
  }
}

/**
 * Entry point to parse nodes to XML
 */
const ladderToXml = (rungs: RungState[]) => {
  console.log('=-= PARSING LADDER TO XML =-=')
  const ladderXML: {
    body: {
      LD: LadderXML
    }
  } = {
    body: {
      LD: {
        leftPowerRail: [],
        rightPowerRail: [],
        contact: [],
        coil: [],
        inVariable: [],
        inOutVariable: [],
        outVariable: [],
      },
    },
  }
  let offsetY = 0
  rungs.forEach((rung, _index) => {
    const { nodes } = rung
    nodes.forEach((node) => {
      switch (node.type) {
        case 'powerRail':
          if ((node as PowerRailNode).data.variant === 'left')
            ladderXML.body.LD.leftPowerRail.push(leftRailToXML(node as PowerRailNode, offsetY))
          else ladderXML.body.LD.rightPowerRail.push(rightRailToXML(node as PowerRailNode, rung, offsetY))
          break
        case 'contact':
          ladderXML.body.LD.contact.push(contactToXML(node as ContactNode, rung, offsetY))
          break
        case 'coil':
          ladderXML.body.LD.coil.push(coilToXml(node as CoilNode, rung, offsetY))
          break
        default:
          break
      }
    })
    offsetY += rung.flowViewport[1]
  })

  return ladderXML
}

export { ladderToXml }
