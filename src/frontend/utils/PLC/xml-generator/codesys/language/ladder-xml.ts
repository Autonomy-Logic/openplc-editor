import { BlockNode, BlockVariant } from '@root/frontend/components/_atoms/graphical-editor/ladder/block'
import { CoilNode } from '@root/frontend/components/_atoms/graphical-editor/ladder/coil'
import { ContactNode } from '@root/frontend/components/_atoms/graphical-editor/ladder/contact'
import {
  BasicNodeData,
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
} from '@root/middleware/shared/ports/xml-types/codesys/pous/languages/ladder-diagram'
import { Node } from '@xyflow/react'

import { findConnections as findRungConnections } from '../../rung-graph'

// CoDeSys-style XML uses `''` for the implicit `OUT` formal parameter; other
// handle ids pass through.
const formatFormalParameter = (rawId: string | undefined): string => (rawId === 'OUT' ? '' : rawId || '')

const findConnections = (
  node: Node<BasicNodeData>,
  rung: RungLadderState,
  offsetY: number = 0,
  targetHandle?: string,
) => findRungConnections(node, rung, offsetY, { targetHandle, formatFormalParameter })

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
      '@formalParameter': 'none',
    },
  }
}

const rightRailToXML = (
  rightRail: PowerRailNode,
  _rung: RungLadderState,
  offsetY: number = 0,
): RightPowerRailLadderXML => {
  return {
    '@localId': rightRail.data.numericId,
    '@width': rightRail.width as number,
    '@height': rightRail.height as number,
    position: {
      '@x': rightRail.position.x,
      '@y': (rightRail.position.y ?? 0) + offsetY,
    },
    connectionPointIn: '',
  }
}

const contactToXML = (
  contact: ContactNode,
  rung: RungLadderState,
  offsetY: number = 0,
  leftRailId: string,
): ContactLadderXML => {
  const connections = findConnections(contact, rung, offsetY)

  const railConnection = connections.find((connection) => {
    const rail = rung.nodes.find((node) => node.type === 'powerRail' && (node).data.variant === 'left')
    if (rail?.data.numericId === connection['@refLocalId']) {
      return true
    }
    return false
  })

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
      connection: connections.map((connection) => {
        const connectionNode = rung.nodes.find((node) => node.data.numericId === connection['@refLocalId'])
        const refLocalId = railConnection ? leftRailId.toString() : connection['@refLocalId']
        const formalParameter =
          connectionNode?.type === 'block'
            ? (connectionNode).data.variant.type === 'function'
              ? (connectionNode).data.variant.name
              : connection['@formalParameter']
            : undefined
        return {
          '@refLocalId': refLocalId,
          '@formalParameter': formalParameter,
        }
      }),
    },
    connectionPointOut: '',
    variable: contact.data.variable && contact.data.variable.name !== '' ? contact.data.variable.name : 'A',
  }
}

const coilToXml = (coil: CoilNode, rung: RungLadderState, offsetY: number = 0, leftRailId: string): CoilLadderXML => {
  const connections = findConnections(coil, rung, offsetY)

  const railConnection = connections.find((connection) => {
    const rail = rung.nodes.find((node) => node.type === 'powerRail' && (node).data.variant === 'left')
    if (rail?.data.numericId === connection['@refLocalId']) {
      return true
    }
    return false
  })

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
      connection: connections.map((connection) => {
        const connectionNode = rung.nodes.find((node) => node.data.numericId === connection['@refLocalId'])
        const refLocalId = railConnection ? leftRailId.toString() : connection['@refLocalId']
        const formalParameter =
          connectionNode?.type === 'block'
            ? (connectionNode).data.variant.type === 'function'
              ? (connectionNode).data.variant.name
              : connection['@formalParameter']
            : undefined
        return {
          '@refLocalId': refLocalId,
          '@formalParameter': formalParameter,
        }
      }),
    },
    connectionPointOut: '',
    variable: coil.data.variable && coil.data.variable.name !== '' ? coil.data.variable.name : 'A',
  }
}

const blockToXml = (
  block: BlockNode<BlockVariant>,
  rung: RungLadderState,
  offsetY: number = 0,
  leftRailId: string,
): BlockLadderXML => {
  const connections = findConnections(block, rung, offsetY)

  // If the block is connected to a power rail, replace the refLocalId with the left rail id at connections
  const railConnection = connections.find((connection) => {
    const rail = rung.nodes.find((node) => node.type === 'powerRail' && (node).data.variant === 'left')
    if (rail?.data.numericId === connection['@refLocalId']) {
      return true
    }
    return false
  })

  const inputVariables = block.data.inputHandles.map((handle) => {
    // Only the input of the block contains connections from other blocks
    // The other handles are connected to variables
    if (handle.id === block.data.inputConnector?.id) {
      return {
        '@formalParameter': handle.id || '',
        connectionPointIn: {
          connection: connections.map((connection) => {
            const connectionNode = rung.nodes.find((node) => node.data.numericId === connection['@refLocalId'])
            const refLocalId = railConnection ? leftRailId.toString() : connection['@refLocalId']
            const formalParameter = connectionNode?.type === 'block' ? connection['@formalParameter'] : undefined
            return {
              '@refLocalId': refLocalId,
              '@formalParameter': formalParameter,
            }
          }),
        },
      }
    }

    // Secondary input handles can be wired by a handle-branch — a contact /
    // coil / parallel chain that lives on the rung and feeds this exact
    // handle id. Without picking those up here, the branch is serialized as
    // disconnected nodes and the handle reads as an unbound variable, so
    // the compiled program never sees the branch's boolean signal.
    const branchConnections = findConnections(block, rung, offsetY, handle.id)
    if (branchConnections.length > 0) {
      return {
        '@formalParameter': handle.id || '',
        connectionPointIn: {
          connection: branchConnections.map((connection) => {
            const connectionNode = rung.nodes.find((node) => node.data.numericId === connection['@refLocalId'])
            const formalParameter = connectionNode?.type === 'block' ? connection['@formalParameter'] : undefined
            return {
              '@refLocalId': connection['@refLocalId'],
              '@formalParameter': formalParameter,
            }
          }),
        },
      }
    }

    // Check if the handle is connected to an existing variable node
    const variableNode = rung.nodes.find(
      (node) =>
        node.type === 'variable' &&
        (node).data.block.id === block.id &&
        (node).data.block.handleId === handle.id,
    ) as Node<BasicNodeData>
    if (!variableNode) return undefined

    return {
      '@formalParameter': handle.id || '',
      connectionPointIn: {
        connection: [
          {
            '@refLocalId': variableNode.data.numericId,
          },
        ],
      },
    }
  })

  const outputVariable = block.data.outputHandles.map((handle, handleIndex) => {
    const edge = rung.edges.find((edge) => edge.source === block.id && edge.sourceHandle === handle.id)
    const connectedNode = rung.nodes.find((node) => node.id === edge?.target)

    return {
      '@formalParameter':
        handle.id === 'OUT' ? (block.data.variant.type === 'function' ? block.data.variant.name : '') : handle.id || '',
      connectionPointOut: {
        expression:
          handleIndex !== 0
            ? connectedNode && connectedNode.type === 'variable'
              ? (connectedNode).data.variable.name
              : ''
            : undefined,
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
    '@executionOrderId': variable.data.executionOrder,
    '@width': variable.width as number,
    '@height': variable.height as number,
    '@negated': false,
    position: {
      '@x': variable.position.x,
      '@y': (variable.position.y ?? 0) + offsetY,
    },
    connectionPointOut: '',
    expression: variable.data.variable.name,
  }
}

const outVariableToXML = (
  variable: VariableNode,
  rung: RungLadderState,
  offsetY: number = 0,
): OutVariableLadderXML | undefined => {
  const connectedBlock = rung.nodes.find((node) => node.id === variable.data.block.id) as BlockNode<BlockVariant>

  if (variable.data.block.handleId !== connectedBlock.data.outputConnector?.id) return undefined

  return {
    '@localId': variable.data.numericId,
    '@executionOrderId': variable.data.executionOrder,
    '@width': variable.width as number,
    '@height': variable.height as number,
    '@negated': false,
    position: {
      '@x': variable.position.x,
      '@y': (variable.position.y ?? 0) + offsetY,
    },
    connectionPointIn: {
      connection: [
        {
          '@refLocalId': connectedBlock.data.numericId,
          '@formalParameter':
            variable.data.block.handleId === 'OUT'
              ? connectedBlock.data.variant.type === 'function'
                ? connectedBlock.data.variant.name
                : ''
              : variable.data.block.handleId || '',
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
        block: [],
        contact: [],
        coil: [],
        inVariable: [],
        outVariable: [],
        rightPowerRail: [],
      },
    },
  }
  let offsetY = 0
  let leftRailId = ''
  rungs.forEach((rung, _index) => {
    const { nodes } = rung

    nodes.forEach((node) => {
      switch (node.type) {
        case 'powerRail':
          if ((node).data.variant === 'left' && ladderXML.body.LD.leftPowerRail.length === 0) {
            ladderXML.body.LD.leftPowerRail.push(leftRailToXML(node, offsetY))
            leftRailId = (node).data.numericId
          } else {
            if (ladderXML.body.LD.rightPowerRail.length === 0) {
              ladderXML.body.LD.rightPowerRail.push(rightRailToXML(node, rung, offsetY))
            }
          }
          break
        case 'contact':
          ladderXML.body.LD.contact.push(contactToXML(node, rung, offsetY, leftRailId))
          break
        case 'coil':
          ladderXML.body.LD.coil.push(coilToXml(node, rung, offsetY, leftRailId))
          break
        case 'block':
          ladderXML.body.LD.block.push(blockToXml(node, rung, offsetY, leftRailId))
          break
        case 'variable':
          if ((node).data.variable.name === '') return
          if ((node).data.variant === 'input')
            ladderXML.body.LD.inVariable.push(inVariableToXML(node, offsetY))
          if ((node).data.variant === 'output') {
            const outVarXML = outVariableToXML(node, rung, offsetY)
            if (outVarXML) ladderXML.body.LD.outVariable.push(outVarXML)
          }
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
