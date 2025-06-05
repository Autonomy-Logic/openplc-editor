import { CustomFbdNodeTypes } from '@root/renderer/components/_atoms/graphical-editor/fbd'
import { BlockNode } from '@root/renderer/components/_atoms/graphical-editor/fbd/block'
import { CommentNode } from '@root/renderer/components/_atoms/graphical-editor/fbd/comment'
import { ConnectionNode } from '@root/renderer/components/_atoms/graphical-editor/fbd/connection'
import { BasicNodeData } from '@root/renderer/components/_atoms/graphical-editor/fbd/utils'
import { VariableNode } from '@root/renderer/components/_atoms/graphical-editor/fbd/variable'
import { BlockVariant } from '@root/renderer/components/_atoms/graphical-editor/types/block'
import { FBDRungState } from '@root/renderer/store/slices'
import {
  BlockFbdXML,
  CommentFbdXML,
  ConnectorFbdXML,
  ContinuationFbdXML,
  FbdXML,
  InVariableFbdXML,
  OutVariableFbdXML,
} from '@root/types/PLC/xml-data/codesys/pous/languages/fbd-diagram'

/**
 * Translate react flow nodes to XML
 */

const blockToXml = (node: BlockNode<BlockVariant>, rung: FBDRungState): BlockFbdXML => {
  const inputVariables: BlockFbdXML['inputVariables']['variable'] = node.data.inputHandles
    .flatMap((handle) => {
      const edges = rung.edges.filter((edge) => edge.target === node.id && edge.targetHandle === handle.id)
      if (edges.length === 0)
        return {
          '@formalParameter': handle.id || '',
          connectionPointIn: {
            connection: [],
          },
        }

      return edges.map((edge) => {
        const sourceNode = rung.nodes.find((node) => node.id === edge.source)
        if (!sourceNode) return undefined

        return {
          '@formalParameter': handle.id || '',
          connectionPointIn: {
            connection: [
              {
                '@refLocalId': (sourceNode.data as BasicNodeData).numericId,
                '@formalParameter':
                  sourceNode.type === 'block'
                    ? (edge.sourceHandle as string) === 'OUT'
                      ? '   '
                      : (edge.sourceHandle as string)
                    : undefined,
              },
            ],
          },
        }
      })
    })
    .filter((variable) => variable !== undefined)

  const outputVariable: BlockFbdXML['outputVariables']['variable'] = node.data.outputHandles
    .flatMap((handle, handleIndex) => {
      const edges = rung.edges.filter((edge) => edge.source === node.id && edge.sourceHandle === handle.id)
      if (edges.length === 0)
        return {
          '@formalParameter': handle.id || '',
          connectionPointOut: {
            expression: undefined,
          },
        }

      return edges.map((edge) => {
        const targetNode = rung.nodes.find((node) => node.id === edge.target)
        if (!targetNode) return undefined

        return {
          '@formalParameter': handle.id === 'OUT' ? '   ' : handle.id || '',
          connectionPointOut: {
            expression:
              handleIndex !== 0 && targetNode.type?.includes('variable')
                ? (targetNode as VariableNode).data.variable.name
                : undefined,
          },
        }
      })
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
    connectionPointOut: '',
    expression: node.data.variable.name,
  }

  return inputVariableXML
}

const outputVariableToXml = (node: VariableNode, rung: FBDRungState): OutVariableFbdXML | undefined => {
  const inputEdges = rung.edges.filter((edge) => edge.target === node.id)

  const inputConnection: OutVariableFbdXML['connectionPointIn'] = {
    connection: inputEdges
      .map((edge) => {
        const sourceNode = rung.nodes.find((node) => node.id === edge.source)
        const isConnectedToOutputConnector =
          (sourceNode?.data as BasicNodeData).outputConnector?.id === edge.sourceHandle

        return {
          '@refLocalId': sourceNode
            ? isConnectedToOutputConnector
              ? (sourceNode?.data as BasicNodeData).numericId
              : 'undefined'
            : 'undefined',
          '@formalParameter':
            sourceNode?.type === 'block'
              ? (edge.sourceHandle as string) === 'OUT'
                ? '   '
                : (edge.sourceHandle as string)
              : undefined,
        }
      })
      .filter((connection) => connection['@refLocalId'] !== 'undefined'),
  }

  if (inputConnection.connection.length === 0) {
    return undefined
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

        return {
          '@refLocalId': (sourceNode.data as BasicNodeData).numericId,
          '@formalParameter':
            sourceNode.type === 'block'
              ? (edge.sourceHandle as string) === 'OUT'
                ? '   '
                : (edge.sourceHandle as string)
              : undefined,
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

const commentToXml = (node: CommentNode): CommentFbdXML => {
  const commentXML: CommentFbdXML = {
    '@localId': node.data.numericId,
    '@height': node.height ?? (node.measured?.height as number),
    '@width': node.width ?? (node.measured?.width as number),
    position: {
      '@x': node.position.x,
      '@y': node.position.y,
    },
    content: {
      'xhtml': {
        '@xmlns': 'http://www.w3.org/1999/xhtml',
        $: node.data.content,
      },
    },
  }

  return commentXML
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
        outVariable: [],
        connector: [],
        continuation: [],
        comment: [],
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
      case 'output-variable': {
        const outputVarXml = outputVariableToXml(node as VariableNode, rung)
        if (outputVarXml) fbdXML.body.FBD.outVariable.push(outputVarXml)
        break
      }
      case 'connector':
        fbdXML.body.FBD.connector.push(connectorToXml(node as ConnectionNode, rung))
        break
      case 'continuation':
        fbdXML.body.FBD.continuation.push(continuationToXml(node as ConnectionNode))
        break
      case 'comment':
        fbdXML.body.FBD.comment.push(commentToXml(node as CommentNode))
        break
      default:
        break
    }
  })

  return fbdXML
}

export { fbdToXml }
