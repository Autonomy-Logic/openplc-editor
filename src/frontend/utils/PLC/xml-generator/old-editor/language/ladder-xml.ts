import type {
  BasicNodeData,
  BlockNode,
  BlockVariant,
  CoilNode,
  ContactNode,
  PowerRailNode,
  VariableNode,
} from '@root/frontend/components/_atoms/graphical-editor/ladder/utils/types'
import { RungLadderState } from '@root/frontend/store/slices'
import {
  BlockLadderXML,
  CoilLadderXML,
  ContactLadderXML,
  InVariableLadderXML,
  LadderXML,
  LeftPowerRailLadderXML,
  OutVariableLadderXML,
  RightPowerRailLadderXML,
} from '@root/middleware/shared/ports/xml-types/old-editor/pous/languages/ladder-diagram'
import { Node } from '@xyflow/react'

import { findConnections as findRungConnections } from '../../rung-graph'

const findConnections = (
  node: Node<BasicNodeData>,
  rung: RungLadderState,
  offsetY: number = 0,
  targetHandle?: string,
) => findRungConnections(node, rung, offsetY, { targetHandle })

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
  const connections = findConnections(rightRail as Node<BasicNodeData>, rung, offsetY)

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

    // Secondary input handles can be wired by a handle-branch — a contact /
    // coil / parallel chain that lives on the rung and feeds this exact
    // handle id. Without picking those up here, the branch is serialized
    // as disconnected nodes and the handle reads as an unbound variable,
    // so the compiled program never sees the branch's boolean signal.
    const branchConnections = findConnections(block, rung, offsetY, handle.id)
    if (branchConnections.length > 0) {
      return {
        '@formalParameter': handle.id || '',
        connectionPointIn: {
          relPosition: {
            '@x': handle.relPosition.x || 0,
            '@y': handle.relPosition.y || 0,
          },
          connection: branchConnections,
        },
      }
    }

    // Check if the handle is connected to an existing variable node
    const variableNode = rung.nodes.find(
      (node) => node.type === 'variable' && node.data.block.id === block.id && node.data.block.handleId === handle.id,
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
          if (node.data.variant === 'left') ladderXML.body.LD.leftPowerRail.push(leftRailToXML(node, offsetY))
          else ladderXML.body.LD.rightPowerRail.push(rightRailToXML(node, rung, offsetY))
          break
        case 'contact':
          ladderXML.body.LD.contact.push(contactToXML(node, rung, offsetY))
          break
        case 'coil':
          ladderXML.body.LD.coil.push(coilToXml(node, rung, offsetY))
          break
        case 'block':
          ladderXML.body.LD.block.push(blockToXml(node, rung, offsetY))
          break
        case 'variable':
          if (node.data.variable.name === '') return
          if (node.data.variant === 'input') ladderXML.body.LD.inVariable.push(inVariableToXML(node, offsetY))
          if (node.data.variant === 'output') ladderXML.body.LD.outVariable.push(outVariableToXML(node, rung, offsetY))
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
