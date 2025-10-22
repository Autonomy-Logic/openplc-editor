import { defaultCustomNodesStyles, nodesBuilder } from '@root/renderer/components/_atoms/graphical-editor/ladder'
import { BlockNode, BlockVariant } from '@root/renderer/components/_atoms/graphical-editor/ladder/block'
import { RungLadderState } from '@root/renderer/store/slices'
import { newGraphicalEditorNodeID } from '@root/utils/new-graphical-editor-node-id'
import { Edge, Node } from '@xyflow/react'

import { buildEdge } from '../../edges'

export const renderVariableBlock = <T extends BlockVariant>(rung: RungLadderState, block: Node) => {
  const variableElements: Node[] = []
  const variableEdges: Edge[] = []
  const variableElementStyle = defaultCustomNodesStyles.variable

  const blockElement = block as BlockNode<T>
  const blockVariant = blockElement.data.variant

  const inputHandles =
    blockElement.data.inputHandles.length > 1
      ? blockElement.data.inputHandles.slice(1, blockElement.data.inputHandles.length)
      : []
  const outputHandles =
    blockElement.data.outputHandles.length > 1
      ? blockElement.data.outputHandles.slice(1, blockElement.data.outputHandles.length)
      : []

  inputHandles.forEach((inputHandle) => {
    const connectedVariable = blockElement.data.connectedVariables.find((variable) => {
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

    const variableElement = nodesBuilder.variable({
      id: newGraphicalEditorNodeID('variable'),
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
      variable: connectedVariable?.variable,
    })
    const variableEdge = buildEdge(variableElement.id, blockElement.id, {
      sourceHandle: 'output',
      targetHandle: inputHandle.id,
    })

    variableElements.push(variableElement)
    variableEdges.push(variableEdge)
  })

  outputHandles.forEach((outputHandle) => {
    const connectedVariable = blockElement.data.connectedVariables.find((variable) => {
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

    const variableElement = nodesBuilder.variable({
      id: newGraphicalEditorNodeID('variable'),
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

export const updateVariableBlockPosition = (rung: RungLadderState) => {
  let newNodes = [...rung.nodes]
  let newEdges = [...rung.edges]

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
    )
    newNodes = nodes
    newEdges = edges
  })

  return { nodes: newNodes, edges: newEdges }
}
