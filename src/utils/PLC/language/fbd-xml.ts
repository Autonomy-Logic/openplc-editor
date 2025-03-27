import { CustomFbdNodeTypes } from '@root/renderer/components/_atoms/graphical-editor/fbd'
import { BlockNode } from '@root/renderer/components/_atoms/graphical-editor/fbd/block'
import { ConnectionNode } from '@root/renderer/components/_atoms/graphical-editor/fbd/connection'
import { BasicNodeData } from '@root/renderer/components/_atoms/graphical-editor/fbd/utils'
import { VariableNode } from '@root/renderer/components/_atoms/graphical-editor/fbd/variable'
import { BlockVariant } from '@root/renderer/components/_atoms/graphical-editor/types/block'
import { FBDRungState } from '@root/renderer/store/slices'
import {
  BlockFbdXML,
  ConnectorFbdXML,
  ContinuationFbdXML,
  FbdXML,
  InVariableFbdXML,
  OutVariableFbdXML,
} from '@root/types/PLC/xml-data/pous/languages/fbd-diagram'
import { parseSvgPath } from '@root/utils/svg-path-to-xy'
import { Edge as FlowEdge, getSmoothStepPath, Node as FlowNode } from '@xyflow/react'

const getEdgePaths = (edge: FlowEdge, nodes: FlowNode[]) => {
  const sourceNodeHandle = (nodes.find((node) => node.id === edge.source)?.data as BasicNodeData).outputHandles?.find(
    (handle) => handle.id === edge.sourceHandle,
  )
  const targetNodeHandle = (nodes.find((node) => node.id === edge.target)?.data as BasicNodeData).inputHandles?.find(
    (handle) => handle.id === edge.targetHandle,
  )

  if (!sourceNodeHandle || !targetNodeHandle) {
    console.log('Error: source or target handle not found')
    console.log('Source:', sourceNodeHandle)
    console.log('Target:', targetNodeHandle)
    return
  }

  const [path] = getSmoothStepPath({
    sourceX: sourceNodeHandle.glbPosition.x,
    sourceY: sourceNodeHandle.glbPosition.y,
    targetX: targetNodeHandle.glbPosition.x,
    targetY: targetNodeHandle.glbPosition.y,
  })
  const xyPath = parseSvgPath(path)
  return xyPath
}

/**
 * Translate react flow nodes to XML
 */

const blockToXml = (node: BlockNode<BlockVariant>, rung: FBDRungState): BlockFbdXML => {
  const inputVariables: BlockFbdXML['inputVariables']['variable'] = node.data.inputHandles
    .flatMap((handle) => {
      const edges = rung.edges.filter((edge) => edge.target === node.id && edge.targetHandle === handle.id)
      if (!edges) return undefined

      return edges.map((edge) => {
        const sourceNode = rung.nodes.find((node) => node.id === edge.source)
        if (!sourceNode) return undefined

        const path = getEdgePaths(edge, rung.nodes)
        if (!path) return undefined

        return {
          '@formalParameter': handle.id || '',
          connectionPointIn: {
            relPosition: {
              '@x': handle.relPosition.x || 0,
              '@y': handle.relPosition.y || 0,
            },
            connection: [
              {
                '@refLocalId': (sourceNode.data as BasicNodeData).numericId,
                position: path.reverse().map((point) => ({
                  '@x': point.x,
                  '@y': point.y,
                })),
              },
            ],
          },
        }
      })
    })
    .filter((variable) => variable !== undefined)

  const outputVariable: BlockFbdXML['outputVariables']['variable'] = node.data.outputHandles
    .map((handle) => {
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
    .filter((variable) => variable !== undefined)

  const blockXML: BlockFbdXML = {
    '@localId': node.data.numericId,
    '@typeName': node.data.variant.name,
    '@instanceName': node.data.variant.type === 'function-block' ? node.data.variable.name : undefined,
    '@executionOrderId': node.data.executionOrder,
    '@height': node.height as number,
    '@width': node.width as number,
    position: {
      '@x': node.position.x,
      '@y': node.position.y,
    },
    inputVariables: {
      variable: inputVariables,
    },
    inOutVariables: '',
    outputVariables: {
      variable: outputVariable,
    },
  }

  return blockXML
}

const inputVariableToXml = (node: VariableNode): InVariableFbdXML => {
  const inputVariableXML: InVariableFbdXML = {
    '@localId': node.data.numericId,
    '@executionOrderId': node.data.executionOrder,
    '@height': node.height as number,
    '@width': node.width as number,
    '@negated': node.data.negated,
    position: {
      '@x': node.position.x,
      '@y': node.position.y,
    },
    connectionPointOut: {
      relPosition: {
        '@x': node.data.outputConnector?.relPosition.x || 0,
        '@y': node.data.outputConnector?.relPosition.y || 0,
      },
    },
    expression: node.data.variable.name,
  }

  return inputVariableXML
}

const outputVariableToXml = (node: VariableNode, rung: FBDRungState): OutVariableFbdXML => {
  const inputEdges = rung.edges.filter((edge) => edge.target === node.id)

  const inputConnection: OutVariableFbdXML['connectionPointIn'] = {
    relPosition: {
      '@x': node.data.inputConnector?.relPosition.x || 0,
      '@y': node.data.inputConnector?.relPosition.y || 0,
    },
    connection: inputEdges
      .map((edge) => {
        const sourceNode = rung.nodes.find((node) => node.id === edge.source)
        if (!sourceNode) return undefined

        const path = getEdgePaths(edge, rung.nodes)
        if (!path) return undefined

        return {
          '@refLocalId': (sourceNode.data as BasicNodeData).numericId,
          '@formalParameter': edge.sourceHandle ? edge.sourceHandle : '',
          position: path.reverse().map((point) => ({
            '@x': point.x,
            '@y': point.y,
          })),
        }
      })
      .filter((connection) => connection !== undefined),
  }

  const outputVariableXML: OutVariableFbdXML = {
    '@localId': node.data.numericId,
    '@executionOrderId': node.data.executionOrder,
    '@height': node.height as number,
    '@width': node.width as number,
    '@negated': node.data.negated,
    position: {
      '@x': node.position.x,
      '@y': node.position.y,
    },
    connectionPointIn: inputConnection,
    expression: node.data.variable.name,
  }

  return outputVariableXML
}

const connectorToXml = (node: ConnectionNode, rung: FBDRungState): ConnectorFbdXML => {
  const inputEdges = rung.edges.filter((edge) => edge.target === node.id)

  const inputConnection: ConnectorFbdXML['connectionPointIn'] = {
    relPosition: {
      '@x': node.data.inputConnector?.relPosition.x || 0,
      '@y': node.data.inputConnector?.relPosition.y || 0,
    },
    connection: inputEdges
      .map((edge) => {
        const sourceNode = rung.nodes.find((node) => node.id === edge.source)
        if (!sourceNode) return undefined

        const path = getEdgePaths(edge, rung.nodes)
        if (!path) return undefined

        return {
          '@refLocalId': (sourceNode.data as BasicNodeData).numericId,
          '@formalParameter': edge.sourceHandle ? edge.sourceHandle : '',
          position: path.reverse().map((point) => ({
            '@x': point.x,
            '@y': point.y,
          })),
        }
      })
      .filter((connection) => connection !== undefined),
  }

  const connectorXML: ConnectorFbdXML = {
    '@name': node.data.variable.name,
    '@localId': node.data.numericId,
    '@height': node.height as number,
    '@width': node.width as number,
    position: {
      '@x': node.position.x,
      '@y': node.position.y,
    },
    connectionPointIn: inputConnection,
  }

  return connectorXML
}

const continuationToXml = (node: ConnectionNode): ContinuationFbdXML => {
  const continuationXML: ContinuationFbdXML = {
    '@name': node.data.variable.name,
    '@localId': node.data.numericId,
    '@height': node.height as number,
    '@width': node.width as number,
    position: {
      '@x': node.position.x,
      '@y': node.position.y,
    },
    connectionPointOut: {
      relPosition: {
        '@x': node.data.outputConnector?.relPosition.x || 0,
        '@y': node.data.outputConnector?.relPosition.y || 0,
      },
    },
  }

  return continuationXML
}

/**
 * Entry point to parse nodes to XML
 */
const fbdToXml = (rung: FBDRungState) => {
  const fbdXML: {
    body: {
      FBD: FbdXML
    }
  } = {
    body: {
      FBD: {
        block: [],
        inVariable: [],
        inOutVariable: [],
        outVariable: [],
        connector: [],
        continuation: [],
      },
    },
  }

  const { nodes, edges: _edges } = rung
  nodes.forEach((node) => {
    switch (node.type as CustomFbdNodeTypes) {
      case 'block':
        fbdXML.body.FBD.block.push(blockToXml(node as BlockNode<BlockVariant>, rung))
        break
      case 'input-variable':
        fbdXML.body.FBD.inVariable.push(inputVariableToXml(node as VariableNode))
        break
      case 'output-variable':
        fbdXML.body.FBD.outVariable.push(outputVariableToXml(node as VariableNode, rung))
        break
      case 'connector':
        fbdXML.body.FBD.connector.push(connectorToXml(node as ConnectionNode, rung))
        break
      case 'continuation':
        fbdXML.body.FBD.continuation.push(continuationToXml(node as ConnectionNode))
        break
      default:
        break
    }
  })

  return fbdXML
}

export { fbdToXml }
