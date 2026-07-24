import { RungLadderState } from '@root/frontend/store/slices'
import { newGraphicalEditorNodeID } from '@root/frontend/utils/new-graphical-editor-node-id'
import { Edge, Node } from '@xyflow/react'

import {
  defaultCustomNodesStyles,
  nodesBuilder,
} from '../../../../../../../_atoms/graphical-editor/ladder/node-builders'
import { BlockNode, BlockVariant } from '../../../../../../../_atoms/graphical-editor/ladder/utils/types'
import { buildEdge } from '../../edges'
import { hasBranchOnHandle } from '../handle-branch'

/**
 * Identity of a rebuilt variable node, keyed by its attachment point
 * (block id + handle id + input/output side). The layout pass destroys and
 * rebuilds every variable node — reusing the previous node's `id` and
 * `data.numericId` keeps a net-identical graph byte-identical on disk, so
 * dragging a block away and back doesn't leave a phantom "Modified" file.
 */
type VariableIdentity = { id: string; numericId: number | string }

const variableIdentityKey = (blockId: string, handleId: string, variant: 'input' | 'output') =>
  `${blockId}::${handleId}::${variant}`

/** Collect the identities of a rung's existing variable nodes before a rebuild. */
const collectVariableIdentities = (nodes: Node[]): Map<string, VariableIdentity> => {
  const identities = new Map<string, VariableIdentity>()
  for (const node of nodes) {
    if (node.type !== 'variable') continue
    const data = node.data as {
      variant?: 'input' | 'output'
      block?: { id?: string; handleId?: string }
      numericId?: number | string
    }
    if (!data?.block?.id || !data.block.handleId || !data.variant || data.numericId === undefined) continue
    identities.set(variableIdentityKey(data.block.id, data.block.handleId, data.variant), {
      id: node.id,
      numericId: data.numericId,
    })
  }
  return identities
}

export const renderVariableBlock = <T extends BlockVariant>(
  rung: RungLadderState,
  block: Node,
  previousIdentities?: Map<string, VariableIdentity>,
) => {
  const variableElements: Node[] = []
  const variableEdges: Edge[] = []
  const variableElementStyle = defaultCustomNodesStyles.variable

  const blockElement = block as BlockNode<T>
  const blockVariant = blockElement.data.variant

  const inputHandles =
    blockElement.data.inputHandles.length > 1
      ? blockElement.data.inputHandles
          .slice(1, blockElement.data.inputHandles.length)
          .filter((handle) => !hasBranchOnHandle(rung, blockElement.id, handle.id as string))
      : []
  const outputHandles =
    blockElement.data.outputHandles.length > 1
      ? blockElement.data.outputHandles
          .slice(1, blockElement.data.outputHandles.length)
          .filter((handle) => !hasBranchOnHandle(rung, blockElement.id, handle.id as string))
      : []

  inputHandles.forEach((inputHandle) => {
    const connectedVariable = (
      Array.isArray(blockElement.data.connectedVariables) ? blockElement.data.connectedVariables : []
    ).find((variable) => {
      return variable.type === 'input' && variable.handleId === inputHandle.id
    })

    let variableType: BlockVariant['variables'][0] = {
      name: '',
      class: '',
      type: {
        definition: '',
        value: '',
      },
    }
    blockVariant.variables.forEach((variable) => {
      if (variable.name === inputHandle.id) variableType = variable
    })

    const previous = previousIdentities?.get(variableIdentityKey(blockElement.id, inputHandle.id as string, 'input'))
    const variableElement = nodesBuilder.variable({
      id: previous?.id ?? newGraphicalEditorNodeID('variable'),
      posX: inputHandle.glbPosition.x - (variableElementStyle.width + variableElementStyle.gap),
      posY: inputHandle.glbPosition.y - variableElementStyle.handle.y,
      handleX: inputHandle.glbPosition.x - variableElementStyle.gap,
      handleY: inputHandle.glbPosition.y,
      variant: 'input',
      block: {
        id: blockElement.id,
        handleId: inputHandle.id as string,
        variableType,
      },
      variable: connectedVariable ? connectedVariable.variable : undefined,
    })
    if (previous) (variableElement.data as { numericId: number | string }).numericId = previous.numericId
    const variableEdge = buildEdge(variableElement.id, blockElement.id, {
      sourceHandle: 'output',
      targetHandle: inputHandle.id,
    })

    variableElements.push(variableElement)
    variableEdges.push(variableEdge)
  })

  outputHandles.forEach((outputHandle) => {
    const connectedVariable = (
      Array.isArray(blockElement.data.connectedVariables) ? blockElement.data.connectedVariables : []
    ).find((variable) => {
      return variable.type === 'output' && variable.handleId === outputHandle.id
    })

    let variableType: BlockVariant['variables'][0] = {
      name: '',
      class: '',
      type: {
        definition: '',
        value: '',
      },
    }
    blockVariant.variables.forEach((variable) => {
      if (variable.name === outputHandle.id) variableType = variable
    })

    const previous = previousIdentities?.get(variableIdentityKey(blockElement.id, outputHandle.id as string, 'output'))
    const variableElement = nodesBuilder.variable({
      id: previous?.id ?? newGraphicalEditorNodeID('variable'),
      posX: outputHandle.glbPosition.x + variableElementStyle.gap,
      posY: outputHandle.glbPosition.y - variableElementStyle.handle.y,
      handleX: outputHandle.glbPosition.x + variableElementStyle.gap,
      handleY: outputHandle.glbPosition.y,
      variant: 'output',
      block: {
        id: blockElement.id,
        handleId: outputHandle.id as string,
        variableType,
      },
      variable: connectedVariable ? connectedVariable.variable : undefined,
    })
    if (previous) (variableElement.data as { numericId: number | string }).numericId = previous.numericId
    const variableEdge = buildEdge(blockElement.id, variableElement.id, {
      sourceHandle: outputHandle.id,
      targetHandle: 'input',
    })

    variableElements.push(variableElement)
    variableEdges.push(variableEdge)
  })

  return { nodes: [...rung.nodes, ...variableElements], edges: [...rung.edges, ...variableEdges] }
}

export const removeVariableBlock = (rung: RungLadderState) => {
  const newNodes = rung.nodes.filter((node) => node.type !== 'variable')
  const newEdges = rung.edges.filter(
    (edge) => !edge.source.toLowerCase().includes('variable') && !edge.target.toLowerCase().includes('variable'),
  )
  return { nodes: newNodes, edges: newEdges }
}

export const updateVariableBlockPosition = (rung: RungLadderState, previousNodes?: Node[]) => {
  let newNodes = [...rung.nodes]
  let newEdges = [...rung.edges]

  // Remember each variable node's identity before the rebuild so unchanged
  // attachment points keep their ids (and therefore their edge ids).
  // `previousNodes` is a fallback identity source for pipelines that strip
  // variable nodes before layout (the drag-drop flow removes them in
  // `prepareDropState`) — entries from `rung.nodes` win when both exist.
  const previousIdentities = collectVariableIdentities(previousNodes ? [...previousNodes, ...rung.nodes] : rung.nodes)

  const { nodes: removedVariableNodes, edges: removedVariableEdges } = removeVariableBlock(rung)
  newNodes = removedVariableNodes
  newEdges = removedVariableEdges

  const blockElements = newNodes.filter((node) => node.type === 'block')

  blockElements.forEach((blockElement) => {
    const { nodes, edges } = renderVariableBlock(
      {
        ...rung,
        nodes: newNodes,
        edges: newEdges,
      },
      blockElement,
      previousIdentities,
    )
    newNodes = nodes
    newEdges = edges
  })

  return { nodes: newNodes, edges: newEdges }
}
