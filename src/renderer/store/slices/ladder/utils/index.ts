import { nodesBuilder } from '@root/renderer/components/_atoms/graphical-editor/ladder'
import { BlockNode, BlockVariant } from '@root/renderer/components/_atoms/graphical-editor/ladder/block'
import { CoilNode } from '@root/renderer/components/_atoms/graphical-editor/ladder/coil'
import { ContactNode } from '@root/renderer/components/_atoms/graphical-editor/ladder/contact'
import { ParallelNode } from '@root/renderer/components/_atoms/graphical-editor/ladder/parallel'
import { PowerRailNode } from '@root/renderer/components/_atoms/graphical-editor/ladder/power-rail'
import { VariableNode } from '@root/renderer/components/_atoms/graphical-editor/ladder/variable'
import { PLCVariable } from '@root/types/PLC/open-plc'
import { generateNumericUUID } from '@root/utils'
import { newGraphicalEditorNodeID } from '@root/utils/new-graphical-editor-node-id'
import { Edge, Node } from '@xyflow/react'

import { RungLadderState } from '../types'

export const duplicateLadderRung = (editorName: string, rung: RungLadderState): RungLadderState => {
  const nodeMaps: { [key: string]: Node } = rung.nodes.reduce(
    (acc, node) => {
      acc[node.id] = {
        ...node,
        id: node.type === 'powerRail' ? node.id : newGraphicalEditorNodeID(node.type?.toUpperCase()),
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

/**
 * Checks if a function block variable is still in use by any block in the flows.
 * This is used to determine if a variable should be deleted when a function block is removed.
 *
 * @param variableName - Name of the variable to check (case-insensitive)
 * @param allRungs - All rungs/diagrams (must have nodes property)
 * @returns true if the variable is still in use, false otherwise
 */
export const isFunctionBlockVariableInUse = (variableName: string, allRungs: Array<{ nodes: Node[] }>): boolean => {
  const normalizedName = variableName.toLowerCase()

  for (const rung of allRungs) {
    for (const node of rung.nodes) {
      if (node.type === 'block') {
        const blockNode = node as BlockNode<BlockVariant>
        const blockVariableName = blockNode.data.variable?.name?.toLowerCase()

        if (blockVariableName === normalizedName && blockNode.data.variant.type === 'function-block') {
          return true
        }
      }
    }
  }

  return false
}

/**
 * Gets all function block variables that should be cleaned up after nodes are removed.
 * Returns an array of variable names that are no longer in use.
 *
 * @param removedNodes - Nodes that were removed
 * @param allRungs - All rungs/diagrams (must have nodes property)
 * @param allVariables - All variables in the POU
 * @returns Array of variable names to delete
 */
export const getFunctionBlockVariablesToCleanup = (
  removedNodes: Node[],
  allRungs: Array<{ nodes: Node[] }>,
  allVariables: PLCVariable[],
): string[] => {
  const variablesToCheck = new Set<string>()

  for (const node of removedNodes) {
    if (node.type === 'block') {
      const blockNode = node as BlockNode<BlockVariant>
      if (blockNode.data.variant.type === 'function-block') {
        const variableName = blockNode.data.variable?.name
        if (variableName) {
          variablesToCheck.add(variableName)
        }
      }
    }
  }

  const variablesToDelete: string[] = []

  for (const variableName of variablesToCheck) {
    const variable = allVariables.find((v) => v.name.toLowerCase() === variableName.toLowerCase())

    if (variable && variable.type.definition === 'derived') {
      if (!isFunctionBlockVariableInUse(variableName, allRungs)) {
        variablesToDelete.push(variableName)
      }
    }
  }

  return variablesToDelete
}
