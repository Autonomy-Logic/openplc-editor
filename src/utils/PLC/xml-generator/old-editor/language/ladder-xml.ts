import { BlockNode, BlockVariant } from '@root/renderer/components/_atoms/graphical-editor/ladder/block'
import { CoilNode } from '@root/renderer/components/_atoms/graphical-editor/ladder/coil'
import { ContactNode } from '@root/renderer/components/_atoms/graphical-editor/ladder/contact'
import { ParallelNode } from '@root/renderer/components/_atoms/graphical-editor/ladder/parallel'
import { PowerRailNode } from '@root/renderer/components/_atoms/graphical-editor/ladder/power-rail'
import { BasicNodeData } from '@root/renderer/components/_atoms/graphical-editor/ladder/utils/types'
import { VariableNode } from '@root/renderer/components/_atoms/graphical-editor/ladder/variable'
import { RungLadderState } from '@root/renderer/store/slices'
import {
  BlockLadderXML,
  CoilLadderXML,
  ContactLadderXML,
  InVariableLadderXML,
  LadderXML,
  LeftPowerRailLadderXML,
  OutVariableLadderXML,
  RightPowerRailLadderXML,
} from '@root/types/PLC/xml-data/old-editor/pous/languages/ladder-diagram'
import { Node } from '@xyflow/react'

/**
 * Find the connections of a node in a rung.
 */
const findNodeBasedOnParallelOpen = (
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

const findNodesBasedOnParallelClose = (
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

const findConnections = (node: Node<BasicNodeData>, rung: RungLadderState, offsetY: number = 0) => {
  const { nodes: rungNodes, edges: rungEdges } = rung

  const connectedEdges = rungEdges.filter((edge) => edge.target === node.id)
  if (!connectedEdges.length) return []

  const connections = connectedEdges.map((edge) => {
    const sourceNode = rungNodes.find((node) => node.id === edge.source) as Node<BasicNodeData>
    // If the source node is not found or it is a variable node, return undefined
    if (!sourceNode || sourceNode.type === 'variable') return undefined

    // Node is not a parallel node
    if (sourceNode.type !== 'parallel') {
      return {
        '@refLocalId': sourceNode.data.numericId,
        '@formalParameter': sourceNode.data.outputConnector?.id,
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
      if (lastParallelSerialEdge && lastParallelSerialEdge.target === node.id) {
        return nodes.map((node, index) => ({
          '@refLocalId': node.data.numericId,
          '@formalParameter': node.data.outputConnector?.id,
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

      // If the node is connected in parallel to the parallel node
      // const sourceNodeOfParallelNode = nodes[0]
      // return {
      //   '@refLocalId': sourceNodeOfParallelNode.data.numericId,
      //   '@formalParameter': sourceNodeOfParallelNode.data.outputConnector?.id,
      //   position: [
      //     // Final edge destination
      //     {
      //       '@x': node.data.inputConnector?.glbPosition.x ?? 0,
      //       '@y': (node.data.inputConnector?.glbPosition.y ?? 0) + offsetY,
      //     },
      //     // Final position of parallel
      //     {
      //       '@x': lastParallelNode.data.parallelOutputConnector?.glbPosition.x ?? 0,
      //       '@y': (node.data.inputConnector?.glbPosition.y ?? 0) + offsetY,
      //     },
      //     // Initial position of parallel
      //     {
      //       '@x': lastParallelNode.data.parallelOutputConnector?.glbPosition.x ?? 0,
      //       '@y': (sourceNodeOfParallelNode.data.outputConnector?.glbPosition.y ?? 0) + offsetY,
      //     },
      //     // Initial edge source
      //     {
      //       '@x': sourceNodeOfParallelNode.data.outputConnector?.glbPosition.x ?? 0,
      //       '@y': (sourceNodeOfParallelNode.data.outputConnector?.glbPosition.y ?? 0) + offsetY,
      //     },
      //   ],
      // }

      return nodes.map((node) => {
        return {
          '@refLocalId': node.data.numericId,
          '@formalParameter': node.data.outputConnector?.id,
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
        '@formalParameter': node.data.outputConnector?.id,
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

  return connections.flat().filter((connection) => connection !== undefined) as {
    '@refLocalId': string
    '@formalParameter': string
    position: {
      '@x': number
      '@y': number
    }[]
  }[]
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

const rightRailToXML = (
  rightRail: PowerRailNode,
  rung: RungLadderState,
  offsetY: number = 0,
): RightPowerRailLadderXML => {
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

const contactToXML = (contact: ContactNode, rung: RungLadderState, offsetY: number = 0): ContactLadderXML => {
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
    variable: contact.data.variable && contact.data.variable.name !== '' ? contact.data.variable.name : 'A',
  }
}

const coilToXml = (coil: CoilNode, rung: RungLadderState, offsetY: number = 0): CoilLadderXML => {
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
    variable: coil.data.variable && coil.data.variable.name !== '' ? coil.data.variable.name : 'A',
  }
}

const blockToXml = (block: BlockNode<BlockVariant>, rung: RungLadderState, offsetY: number = 0): BlockLadderXML => {
  const connections = findConnections(block, rung, offsetY)
  const inputVariables = block.data.inputHandles.map((handle) => {
    // Only the input of the block contains connections from other blocks
    // The other handles are connected to variables
    if (handle.id === block.data.inputConnector?.id) {
      return {
        '@formalParameter': handle.id || '',
        connectionPointIn: {
          relPosition: {
            '@x': handle.relPosition.x || 0,
            '@y': handle.relPosition.y || 0,
          },
          connection: connections,
        },
      }
    }

    // Check if the handle is connected to an existing variable node
    const variableNode = rung.nodes.find(
      (node) =>
        node.type === 'variable' &&
        (node as VariableNode).data.block.id === block.id &&
        (node as VariableNode).data.block.handleId === handle.id,
    ) as Node<BasicNodeData>
    if (!variableNode) return undefined

    return {
      '@formalParameter': handle.id || '',
      connectionPointIn: {
        relPosition: {
          '@x': handle.relPosition.x || 0,
          '@y': handle.relPosition.y || 0,
        },
        connection: [
          {
            '@refLocalId': variableNode.data.numericId,
            position: [
              // Connection at the block
              {
                '@x': handle.glbPosition.x || 0,
                '@y': (handle.glbPosition.y || 0) + offsetY,
              },
              // Start the edge connecting the variable
              {
                '@x': variableNode.data.outputConnector?.glbPosition.x || 0,
                '@y': (variableNode.data.outputConnector?.glbPosition.y || 0) + offsetY,
              },
            ],
          },
        ],
      },
    }
  })

  const outputVariable = block.data.outputHandles.map((handle) => {
    return {
      '@formalParameter': handle.id || '',
      connectionPointOut: {
        relPosition: {
          '@x': handle.relPosition.x || 0,
          '@y': handle.relPosition.y || 0,
        },
      },
    }
  })

  return {
    '@localId': block.data.numericId,
    '@typeName': block.data.variant.name,
    '@instanceName': block.data.variant.type === 'function-block' ? block.data.variable.name : undefined,
    '@width': block.width as number,
    '@height': block.height as number,
    '@executionOrderId': block.data.executionOrder,
    position: {
      '@x': block.position.x,
      '@y': (block.position.y ?? 0) + offsetY,
    },
    inputVariables: {
      variable: inputVariables.filter((variable) => variable !== undefined),
    },
    inOutVariables: '',
    outputVariables: {
      variable: outputVariable.filter((variable) => variable !== undefined),
    },
  }
}

const inVariableToXML = (variable: VariableNode, offsetY: number = 0): InVariableLadderXML => {
  return {
    '@localId': variable.data.numericId,
    '@width': variable.width as number,
    '@height': variable.height as number,
    '@negated': false,
    position: {
      '@x': variable.position.x,
      '@y': (variable.position.y ?? 0) + offsetY,
    },
    connectionPointOut: {
      relPosition: {
        '@x': variable.data.outputConnector?.relPosition.x || 0,
        '@y': variable.data.outputConnector?.relPosition.y || 0,
      },
    },
    expression: variable.data.variable.name,
  }
}

const outVariableToXML = (variable: VariableNode, rung: RungLadderState, offsetY: number = 0): OutVariableLadderXML => {
  const connectedBlock = rung.nodes.find((node) => node.id === variable.data.block.id) as BlockNode<BlockVariant>

  return {
    '@localId': variable.data.numericId,
    '@width': variable.width as number,
    '@height': variable.height as number,
    '@negated': false,
    position: {
      '@x': variable.position.x,
      '@y': (variable.position.y ?? 0) + offsetY,
    },
    connectionPointIn: {
      relPosition: {
        '@x': variable.data.inputConnector?.relPosition.x || 0,
        '@y': variable.data.inputConnector?.relPosition.y || 0,
      },
      connection: [
        {
          '@refLocalId': connectedBlock.data.numericId,
          '@formalParameter': variable.data.block.handleId,
          position: [
            // Final edge destination
            {
              '@x': variable.data.inputConnector?.glbPosition.x || 0,
              '@y': (variable.data.inputConnector?.glbPosition.y || 0) + offsetY,
            },
            // Initial edge source
            {
              '@x': connectedBlock.data.outputConnector?.glbPosition.x || 0,
              '@y': (connectedBlock.data.outputConnector?.glbPosition.y || 0) + offsetY,
            },
          ],
        },
      ],
    },
    expression: variable.data.variable.name,
  }
}

/**
 * Entry point to parse nodes to XML
 */
const ladderToXml = (rungs: RungLadderState[]) => {
  const ladderXML: {
    body: {
      LD: LadderXML
    }
  } = {
    body: {
      LD: {
        leftPowerRail: [],
        rightPowerRail: [],
        block: [],
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
        case 'block':
          ladderXML.body.LD.block.push(blockToXml(node as BlockNode<BlockVariant>, rung, offsetY))
          break
        case 'variable':
          if ((node as VariableNode).data.variable.name === '') return
          if ((node as VariableNode).data.variant === 'input')
            ladderXML.body.LD.inVariable.push(inVariableToXML(node as VariableNode, offsetY))
          if ((node as VariableNode).data.variant === 'output')
            ladderXML.body.LD.outVariable.push(outVariableToXML(node as VariableNode, rung, offsetY))
          break
        default:
          break
      }
    })
    offsetY += rung.reactFlowViewport[1]
  })

  return ladderXML
}

export { ladderToXml }
