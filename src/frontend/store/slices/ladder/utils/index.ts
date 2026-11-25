import { Edge, Node } from '@xyflow/react'

import type { PLCVariable } from '../../../../../middleware/shared/ports/types'
import {
  EMPTY_LABEL_SOURCE,
  type LadderLabelSource,
  relayoutRung,
} from '../../../../../middleware/shared/utils/ladder-layout'
import { nodesBuilder } from '../../../../components/_atoms/graphical-editor/ladder/node-builders'
import type {
  BasicNodeData,
  LadderBlockConnectedVariables,
} from '../../../../components/_atoms/graphical-editor/ladder/utils/types'
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
import { newUuid } from '../../../../utils/new-uuid'
import { RungLadderState } from '../types'

export const duplicateLadderRung = (
  editorName: string,
  rung: RungLadderState,
  labelSource: LadderLabelSource = EMPTY_LABEL_SOURCE,
): RungLadderState => {
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

  // Build mapping for branch handle IDs (old → new) based on block ID remapping
  const branchHandleMap: Record<string, string> = {}
  if (rung.handleBranches) {
    for (const branch of rung.handleBranches) {
      const newBlockId = nodeMaps[branch.blockId]?.id ?? branch.blockId
      branchHandleMap[`branch_${branch.blockId}_${branch.handleId}`] = `branch_${newBlockId}_${branch.handleId}`
    }
  }

  const edgeMaps: { [key: string]: Edge } = rung.edges.reduce(
    (acc, edge) => {
      const newSourceHandle = branchHandleMap[edge.sourceHandle ?? ''] ?? edge.sourceHandle
      const newTargetHandle = branchHandleMap[edge.targetHandle ?? ''] ?? edge.targetHandle
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
            connectedVariables: normalizeConnectedVariables((node as BlockNode<BlockVariant>).data.connectedVariables),
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
        const coilData = node.data as BasicNodeData
        return {
          ...newCoil,
          data: {
            ...newCoil.data,
            variable: (node as CoilNode).data.variable,
            ...(coilData.branchContext && {
              branchContext: {
                ...coilData.branchContext,
                blockId: nodeMaps[coilData.branchContext.blockId]?.id ?? coilData.branchContext.blockId,
              },
            }),
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
        const contactData = node.data as BasicNodeData
        return {
          ...newContact,
          data: {
            ...newContact.data,
            variable: (node as ContactNode).data.variable,
            ...(contactData.branchContext && {
              branchContext: {
                ...contactData.branchContext,
                blockId: nodeMaps[contactData.branchContext.blockId]?.id ?? contactData.branchContext.blockId,
              },
            }),
          },
        } as ContactNode
      }
      case 'parallel': {
        const parallelData = node.data as BasicNodeData
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
            // Branch parallel nodes (a parallel inside a handle branch) carry a
            // branchContext whose blockId must be remapped to the duplicated
            // block — same as coils/contacts. Without this the copy's parallel
            // nodes point at the original block id, breaking branch operations.
            ...(parallelData.branchContext && {
              branchContext: {
                ...parallelData.branchContext,
                blockId: nodeMaps[parallelData.branchContext.blockId]?.id ?? parallelData.branchContext.blockId,
              },
            }),
          },
        } as ParallelNode
      }
      case 'powerRail': {
        const railData = node.data as BasicNodeData
        const remappedHandles = railData.handles.map((h) => {
          const newId = branchHandleMap[h.id as string] ?? h.id
          return { ...h, id: newId }
        })
        return {
          ...node,
          id: nodeMaps[node.id].id,
          data: {
            ...railData,
            numericId: generateNumericUUID(),
            handles: remappedHandles,
            inputHandles: remappedHandles.filter((h) => h.type === 'target'),
            outputHandles: remappedHandles.filter((h) => h.type === 'source'),
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
    sourceHandle: edgeMaps[edge.id].sourceHandle,
    targetHandle: edgeMaps[edge.id].targetHandle,
  }))

  const newRung = {
    id: `rung_${editorName}_${newUuid()}`,
    comment: rung.comment,
    defaultBounds: rung.defaultBounds,
    reactFlowViewport: rung.reactFlowViewport,
    selectedNodes: [],
    nodes: newNodes,
    edges: newEdges,
    ...(rung.handleBranches && {
      handleBranches: rung.handleBranches.map((branch) => ({
        ...branch,
        blockId: nodeMaps[branch.blockId]?.id ?? branch.blockId,
        nodeIds: branch.nodeIds.map((id) => nodeMaps[id]?.id ?? id),
      })),
    }),
  }

  // Blocks/coils/contacts are rebuilt at their DEFAULT dimensions by
  // nodesBuilder, so a block that was branch-expanded in the source rung comes
  // back compact while its branch elements keep the expanded positions —
  // leaving the duplicated diagram visually broken. Re-run the (branch-aware)
  // layout solver so the block re-expands and every element is repositioned
  // against the actual node set.
  return relayoutRung(newRung, labelSource)
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
