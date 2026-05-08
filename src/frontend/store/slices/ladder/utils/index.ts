import { Edge, Node } from '@xyflow/react'

import type { HandleBranch, PLCVariable } from '../../../../../middleware/shared/ports/types'
import { nodesBuilder } from '../../../../components/_atoms/graphical-editor/ladder/node-builders'
import type { LadderBlockConnectedVariables } from '../../../../components/_atoms/graphical-editor/ladder/utils/types'
import type {
  BlockNode,
  BlockVariant,
  CoilNode,
  ContactNode,
  ParallelNode,
  PowerRailNode,
  VariableNode,
} from '../../../../components/_atoms/graphical-editor/ladder/utils/types'
import { generateNumericUUID } from '../../../../utils/generate-uuid'
import { newGraphicalEditorNodeID } from '../../../../utils/new-graphical-editor-node-id'
import { RungLadderState } from '../types'

/**
 * Rail handles for handle branches use the id format
 * `branch_${blockId}_${handleId}`. When a rung is duplicated and its blocks
 * receive new ids, every reference to the old block id inside such a handle
 * (or in an edge's `sourceHandle` / `targetHandle`) needs to be retargeted to
 * the new block. Returns the input unchanged if it isn't a branch handle id.
 */
const remapBranchHandleId = (
  handleId: string | null | undefined,
  blockIdMap: Record<string, string>,
): string | null | undefined => {
  if (typeof handleId !== 'string' || !handleId.startsWith('branch_')) return handleId
  for (const [oldBlockId, newBlockId] of Object.entries(blockIdMap)) {
    const prefix = `branch_${oldBlockId}_`
    if (handleId.startsWith(prefix)) {
      return `branch_${newBlockId}_${handleId.slice(prefix.length)}`
    }
  }
  return handleId
}

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

  const blockIdMap: Record<string, string> = {}
  for (const node of rung.nodes) {
    if (node.type === 'block') {
      blockIdMap[node.id] = nodeMaps[node.id].id
    }
  }

  const edgeMaps: { [key: string]: Edge } = rung.edges.reduce(
    (acc, edge) => {
      const newSourceHandle = remapBranchHandleId(edge.sourceHandle, blockIdMap) ?? edge.sourceHandle
      const newTargetHandle = remapBranchHandleId(edge.targetHandle, blockIdMap) ?? edge.targetHandle
      acc[edge.id] = {
        id: `e_${nodeMaps[edge.source].id}_${nodeMaps[edge.target].id}__${newSourceHandle}_${newTargetHandle}`,
        source: nodeMaps[edge.source].id,
        target: nodeMaps[edge.target].id,
        sourceHandle: newSourceHandle,
        targetHandle: newTargetHandle,
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
          handleX: node.data.inputConnector?.glbPosition.x ?? 0,
          handleY: node.data.inputConnector?.glbPosition.y ?? 0,
          variant: node.data.variant,
          executionControl: node.data.executionControl,
        })
        return {
          ...newBlock,
          data: {
            ...newBlock.data,
            variable: node.data.variant.type === 'function-block' ? { name: '' } : node.data.variable,
            connectedVariables: normalizeConnectedVariables(node.data.connectedVariables),
          },
        } as BlockNode<BlockVariant>
      }
      case 'coil': {
        const sourceCoil = node
        const newCoil = nodesBuilder.coil({
          id: nodeMaps[node.id].id,
          posX: node.position.x,
          posY: node.position.y,
          handleX: sourceCoil.data.inputConnector?.glbPosition.x ?? 0,
          handleY: sourceCoil.data.inputConnector?.glbPosition.y ?? 0,
          variant: sourceCoil.data.variant,
        })
        return {
          ...newCoil,
          data: {
            ...newCoil.data,
            variable: sourceCoil.data.variable,
            branchContext: sourceCoil.data.branchContext
              ? {
                  ...sourceCoil.data.branchContext,
                  blockId: blockIdMap[sourceCoil.data.branchContext.blockId] ?? sourceCoil.data.branchContext.blockId,
                }
              : undefined,
          },
        } as CoilNode
      }
      case 'contact': {
        const sourceContact = node
        const newContact = nodesBuilder.contact({
          id: nodeMaps[node.id].id,
          posX: node.position.x,
          posY: node.position.y,
          handleX: sourceContact.data.inputConnector?.glbPosition.x ?? 0,
          handleY: sourceContact.data.inputConnector?.glbPosition.y ?? 0,
          variant: sourceContact.data.variant,
        })
        return {
          ...newContact,
          data: {
            ...newContact.data,
            variable: sourceContact.data.variable,
            branchContext: sourceContact.data.branchContext
              ? {
                  ...sourceContact.data.branchContext,
                  blockId:
                    blockIdMap[sourceContact.data.branchContext.blockId] ?? sourceContact.data.branchContext.blockId,
                }
              : undefined,
          },
        } as ContactNode
      }
      case 'parallel': {
        const sourceParallel = node
        return {
          ...node,
          id: nodeMaps[node.id].id,
          data: {
            ...node.data,
            numericId: generateNumericUUID(),
            parallelCloseReference: sourceParallel.data.parallelCloseReference
              ? nodeMaps[sourceParallel.data.parallelCloseReference ?? ''].id
              : undefined,
            parallelOpenReference: sourceParallel.data.parallelOpenReference
              ? nodeMaps[sourceParallel.data.parallelOpenReference ?? ''].id
              : undefined,
            branchContext: sourceParallel.data.branchContext
              ? {
                  ...sourceParallel.data.branchContext,
                  blockId:
                    blockIdMap[sourceParallel.data.branchContext.blockId] ?? sourceParallel.data.branchContext.blockId,
                }
              : undefined,
          },
        } as ParallelNode
      }
      case 'powerRail': {
        const sourceRail = node
        const remapHandle = <T extends { id?: string | null }>(handle: T): T => ({
          ...handle,
          id: (remapBranchHandleId(handle.id, blockIdMap) ?? handle.id) as T['id'],
        })
        return {
          ...node,
          id: nodeMaps[node.id].id,
          data: {
            ...node.data,
            numericId: generateNumericUUID(),
            handles: sourceRail.data.handles.map(remapHandle),
            inputHandles: sourceRail.data.inputHandles.map(remapHandle),
            outputHandles: sourceRail.data.outputHandles.map(remapHandle),
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
              ...node.data.block,
              id: nodeMaps[node.data.block.id]?.id ?? node.data.block.id,
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
    sourceHandle: edgeMaps[edge.id].sourceHandle,
    targetHandle: edgeMaps[edge.id].targetHandle,
  }))

  const newHandleBranches: HandleBranch[] = (rung.handleBranches ?? []).map((branch) => ({
    ...branch,
    blockId: blockIdMap[branch.blockId] ?? branch.blockId,
    nodeIds: branch.nodeIds.map((nodeId) => nodeMaps[nodeId]?.id ?? nodeId),
  }))

  const newRung = {
    id: `rung_${editorName}_${crypto.randomUUID()}`,
    comment: rung.comment,
    defaultBounds: rung.defaultBounds,
    reactFlowViewport: rung.reactFlowViewport,
    selectedNodes: [],
    nodes: newNodes,
    edges: newEdges,
    handleBranches: newHandleBranches,
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

/**
 * Normalize connectedVariables from legacy object format to array format.
 * Old projects stored { handleId: { variable, type } } instead of the
 * current [{ handleId, variable, type }] array format.
 */
function normalizeConnectedVariables(raw: unknown): LadderBlockConnectedVariables {
  if (Array.isArray(raw)) return raw as LadderBlockConnectedVariables
  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, { variable?: PLCVariable; type?: string }>).map(([key, cv]) => ({
      handleId: key,
      variable: cv.variable,
      type: (cv.type as 'input' | 'output') ?? 'input',
    }))
  }
  return []
}
