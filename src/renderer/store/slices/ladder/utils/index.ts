import { nodesBuilder } from '@root/renderer/components/_atoms/graphical-editor/ladder'
import { BlockNode, BlockVariant } from '@root/renderer/components/_atoms/graphical-editor/ladder/block'
import { CoilNode } from '@root/renderer/components/_atoms/graphical-editor/ladder/coil'
import { ContactNode } from '@root/renderer/components/_atoms/graphical-editor/ladder/contact'
import { ParallelNode } from '@root/renderer/components/_atoms/graphical-editor/ladder/parallel'
import { PowerRailNode } from '@root/renderer/components/_atoms/graphical-editor/ladder/power-rail'
import { VariableNode } from '@root/renderer/components/_atoms/graphical-editor/ladder/variable'
import { generateNumericUUID } from '@root/utils'
import { Edge, Node } from '@xyflow/react'

import { RungLadderState } from '../types'

export const duplicateLadderRung = (editorName: string, rung: RungLadderState): RungLadderState => {
  const nodeMaps: { [key: string]: Node } = rung.nodes.reduce(
    (acc, node) => {
      acc[node.id] = {
        ...node,
        id: node.type === 'powerRail' ? node.id : `${node.type?.toUpperCase()}_${crypto.randomUUID()}`,
      }
      return acc
    },
    {} as { [key: string]: Node },
  )

  const edgeMaps: { [key: string]: Edge } = rung.edges.reduce(
    (acc, edge) => {
      acc[edge.id] = {
        id: `e_${nodeMaps[edge.source].id}_${nodeMaps[edge.target].id}__${edge.sourceHandle}_${edge.targetHandle}`,
        source: nodeMaps[edge.source].id,
        target: nodeMaps[edge.target].id,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
      }
      return acc
    },
    {} as { [key: string]: Edge },
  )

  const newNodes = rung.nodes.map((node) => {
    switch (node.type) {
      case 'block': {
        const newBlock = nodesBuilder.block({
          id: nodeMaps[node.id].id,
          posX: node.position.x,
          posY: node.position.y,
          handleX: (node as BlockNode<BlockVariant>).data.inputConnector?.glbPosition.x ?? 0,
          handleY: (node as BlockNode<BlockVariant>).data.inputConnector?.glbPosition.y ?? 0,
          variant: (node as BlockNode<BlockVariant>).data.variant,
          executionControl: (node as BlockNode<BlockVariant>).data.executionControl,
        })
        return {
          ...newBlock,
          data: {
            ...newBlock.data,
            variable:
              (node as BlockNode<BlockVariant>).data.variant.type === 'function-block'
                ? { name: '' }
                : node.data.variable,
            connectedVariables: (node as BlockNode<BlockVariant>).data.connectedVariables,
          },
        } as BlockNode<BlockVariant>
      }
      case 'coil': {
        const newCoil = nodesBuilder.coil({
          id: nodeMaps[node.id].id,
          posX: node.position.x,
          posY: node.position.y,
          handleX: (node as CoilNode).data.inputConnector?.glbPosition.x ?? 0,
          handleY: (node as CoilNode).data.inputConnector?.glbPosition.y ?? 0,
          variant: (node as CoilNode).data.variant,
        })
        return {
          ...newCoil,
          data: {
            ...newCoil.data,
            variable: (node as CoilNode).data.variable,
          },
        } as CoilNode
      }
      case 'contact': {
        const newContact = nodesBuilder.contact({
          id: nodeMaps[node.id].id,
          posX: node.position.x,
          posY: node.position.y,
          handleX: (node as ContactNode).data.inputConnector?.glbPosition.x ?? 0,
          handleY: (node as ContactNode).data.inputConnector?.glbPosition.y ?? 0,
          variant: (node as ContactNode).data.variant,
        })
        return {
          ...newContact,
          data: {
            ...newContact.data,
            variable: (node as ContactNode).data.variable,
          },
        } as ContactNode
      }
      case 'parallel': {
        return {
          ...node,
          id: nodeMaps[node.id].id,
          data: {
            ...node.data,
            numericId: generateNumericUUID(),
            parallelCloseReference: (node as ParallelNode).data.parallelCloseReference
              ? nodeMaps[(node as ParallelNode).data.parallelCloseReference ?? ''].id
              : undefined,
            parallelOpenReference: (node as ParallelNode).data.parallelOpenReference
              ? nodeMaps[(node as ParallelNode).data.parallelOpenReference ?? ''].id
              : undefined,
          },
        } as ParallelNode
      }
      case 'powerRail': {
        return {
          ...node,
          id: nodeMaps[node.id].id,
          data: {
            ...node.data,
            numericId: generateNumericUUID(),
          },
        } as PowerRailNode
      }
      case 'variable': {
        return {
          ...node,
          id: nodeMaps[node.id].id,
          data: {
            ...node.data,
            numericId: generateNumericUUID(),
            block: {
              ...(node as VariableNode).data.block,
              id: nodeMaps[(node as VariableNode).data.block.id]?.id ?? (node as VariableNode).data.block.id,
            },
          },
        } as VariableNode
      }
      default: {
        return node
      }
    }
  })

  const newEdges = rung.edges.map((edge) => ({
    ...edge,
    id: edgeMaps[edge.id].id,
    source: edgeMaps[edge.id].source,
    target: edgeMaps[edge.id].target,
  }))

  const newRung = {
    id: `rung_${editorName}_${crypto.randomUUID()}`,
    comment: rung.comment,
    defaultBounds: rung.defaultBounds,
    reactFlowViewport: rung.reactFlowViewport,
    selectedNodes: [],
    nodes: newNodes,
    edges: newEdges,
  }

  return newRung
}
