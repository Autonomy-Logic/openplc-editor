import type { Edge, Node } from '@xyflow/react'

import { generateNumericUUID } from '../../../../../frontend/utils/generate-uuid'
import { newGraphicalEditorNodeID } from '../../../../../frontend/utils/new-graphical-editor-node-id'
import type { RungLadderState } from '../../../ports/types'
import {
  DEFAULT_VARIABLE_CONNECTOR_Y,
  DEFAULT_VARIABLE_HEIGHT,
  DEFAULT_VARIABLE_WIDTH,
  LEGACY_NODE_STYLES,
} from '../legacy-style'
import { getArray, getRecord, isRecord } from '../node-data'
import { hasBranchOnHandle } from './branches'
import { handleIdOf, handlesOf, type LegacyHandle, missing } from './node-access'

/** Builds an LD edge with the editor's deterministic id from its ends and handles. */
export const buildEdge = (
  sourceNodeId: string,
  targetNodeId: string,
  options?: { sourceHandle?: string; targetHandle?: string },
): Edge => {
  return {
    id: `e_${sourceNodeId}_${targetNodeId}__${options?.sourceHandle}_${options?.targetHandle}`,
    source: sourceNodeId,
    target: targetNodeId,
    sourceHandle: options?.sourceHandle,
    targetHandle: options?.targetHandle,
  }
}

/** Identity of a rebuilt variable box: the node id and `data.numericId` it had before the rebuild. */
type VariableIdentity = { id: string; numericId: unknown }

const variableIdentityKey = (blockId: unknown, handleId: unknown, variant: unknown): string =>
  `${String(blockId)}::${String(handleId)}::${String(variant)}`

/** The identities of a rung's existing variable boxes, keyed by block id, pin id and side. */
const collectVariableIdentities = (nodes: Node[]): Map<string, VariableIdentity> => {
  const identities = new Map<string, VariableIdentity>()
  for (const node of nodes) {
    if (node.type !== 'variable') continue
    const block = getRecord(node.data, 'block')
    const variant = node.data.variant
    const numericId = node.data.numericId
    if (!block?.id || !block.handleId || !variant || numericId === undefined) continue
    identities.set(variableIdentityKey(block.id, block.handleId, variant), { id: node.id, numericId })
  }
  return identities
}

type VariableBoxProps = {
  id: string
  numericId: unknown
  posX: number
  posY: number
  handleX: number
  handleY: number
  variant: 'input' | 'output'
  block: { id: string; handleId: string | undefined; variableType: unknown }
  variable: unknown
}

/** A variable box node hanging on a block pin, with its single handle facing the block. */
const buildVariableBox = ({
  id,
  numericId,
  posX,
  posY,
  handleX,
  handleY,
  variant,
  block,
  variable,
}: VariableBoxProps): Node => {
  const inputHandle =
    variant === 'output'
      ? {
          id: 'input',
          position: 'left',
          isConnectable: false,
          type: 'target',
          glbPosition: { x: handleX, y: handleY },
          relPosition: { x: 0, y: DEFAULT_VARIABLE_CONNECTOR_Y },
        }
      : undefined
  const outputHandle =
    variant === 'input'
      ? {
          id: 'output',
          position: 'right',
          isConnectable: false,
          type: 'source',
          glbPosition: { x: handleX + DEFAULT_VARIABLE_WIDTH, y: handleY },
          relPosition: { x: DEFAULT_VARIABLE_WIDTH, y: DEFAULT_VARIABLE_CONNECTOR_Y },
        }
      : undefined

  return {
    id,
    type: 'variable',
    position: { x: posX, y: posY },
    width: DEFAULT_VARIABLE_WIDTH,
    height: DEFAULT_VARIABLE_HEIGHT,
    measured: { width: DEFAULT_VARIABLE_WIDTH, height: DEFAULT_VARIABLE_HEIGHT },
    data: {
      handles: [inputHandle, outputHandle].filter((handle) => handle !== undefined),
      inputHandles: [inputHandle].filter((handle) => handle !== undefined),
      outputHandles: [outputHandle].filter((handle) => handle !== undefined),
      inputConnector: inputHandle,
      outputConnector: outputHandle,
      numericId,
      variable: variable ?? { name: '' },
      executionOrder: 0,
      variant,
      block,
      draggable: false,
      selectable: true,
      deletable: false,
    },
    deletable: false,
    selectable: true,
    draggable: false,
  }
}

/** The block's secondary pins on one side (every pin after the first) that carry no handle branch. */
const secondaryPinsWithoutBranch = (rung: RungLadderState, block: Node, key: string): LegacyHandle[] => {
  const handles = handlesOf(block.data, key)
  return handles.length > 1
    ? handles.slice(1, handles.length).filter((handle) => {
        const handleId = handleIdOf(handle)
        return handleId === undefined || !hasBranchOnHandle(rung, block.id, handleId)
      })
    : []
}

/**
 * Adds a variable box, wired to the pin, on every secondary pin of `block` that has no handle branch; reuses the
 * identity `previousIdentities` holds for the same block, pin and side.
 */
export const renderVariableBlock = (
  rung: RungLadderState,
  block: Node,
  previousIdentities?: Map<string, VariableIdentity>,
): { nodes: Node[]; edges: Edge[] } => {
  const variableElements: Node[] = []
  const variableEdges: Edge[] = []
  const variableElementStyle = LEGACY_NODE_STYLES.variable

  const inputHandles = secondaryPinsWithoutBranch(rung, block, 'inputHandles')
  const outputHandles = secondaryPinsWithoutBranch(rung, block, 'outputHandles')
  const connectedVariables = getArray(block.data, 'connectedVariables') ?? []

  const pinVariable = (handle: LegacyHandle): unknown => {
    let variableType: unknown = {
      name: '',
      class: '',
      type: {
        definition: '',
        value: '',
      },
    }
    const variables = getArray(getRecord(block.data, 'variant'), 'variables') ?? missing(`variables of ${block.id}`)
    variables.forEach((variable) => {
      if (isRecord(variable) && variable.name === handle.id) variableType = variable
    })
    return variableType
  }

  const connectedVariableOf = (handle: LegacyHandle, side: 'input' | 'output'): unknown => {
    const connected = connectedVariables.find(
      (variable) => isRecord(variable) && variable.type === side && variable.handleId === handle.id,
    )
    return isRecord(connected) ? connected.variable : undefined
  }

  inputHandles.forEach((inputHandle) => {
    const variableType = pinVariable(inputHandle)
    const handleId = handleIdOf(inputHandle)
    const previous = previousIdentities?.get(variableIdentityKey(block.id, inputHandle.id, 'input'))
    const variableElement = buildVariableBox({
      id: previous?.id ?? newGraphicalEditorNodeID('variable'),
      numericId: previous ? previous.numericId : generateNumericUUID(),
      posX: inputHandle.glbPosition.x - (variableElementStyle.width + variableElementStyle.gap),
      posY: inputHandle.glbPosition.y - variableElementStyle.handle.y,
      handleX: inputHandle.glbPosition.x - variableElementStyle.gap,
      handleY: inputHandle.glbPosition.y,
      variant: 'input',
      block: { id: block.id, handleId, variableType },
      variable: connectedVariableOf(inputHandle, 'input'),
    })
    variableElements.push(variableElement)
    variableEdges.push(buildEdge(variableElement.id, block.id, { sourceHandle: 'output', targetHandle: handleId }))
  })

  outputHandles.forEach((outputHandle) => {
    const variableType = pinVariable(outputHandle)
    const handleId = handleIdOf(outputHandle)
    const previous = previousIdentities?.get(variableIdentityKey(block.id, outputHandle.id, 'output'))
    const variableElement = buildVariableBox({
      id: previous?.id ?? newGraphicalEditorNodeID('variable'),
      numericId: previous ? previous.numericId : generateNumericUUID(),
      posX: outputHandle.glbPosition.x + variableElementStyle.gap,
      posY: outputHandle.glbPosition.y - variableElementStyle.handle.y,
      handleX: outputHandle.glbPosition.x + variableElementStyle.gap,
      handleY: outputHandle.glbPosition.y,
      variant: 'output',
      block: { id: block.id, handleId, variableType },
      variable: connectedVariableOf(outputHandle, 'output'),
    })
    variableElements.push(variableElement)
    variableEdges.push(buildEdge(block.id, variableElement.id, { sourceHandle: handleId, targetHandle: 'input' }))
  })

  return { nodes: [...rung.nodes, ...variableElements], edges: [...rung.edges, ...variableEdges] }
}

/** The rung without its variable boxes and without every edge whose end id names a variable. */
export const removeVariableBlock = (rung: RungLadderState): { nodes: Node[]; edges: Edge[] } => {
  const newNodes = rung.nodes.filter((node) => node.type !== 'variable')
  const newEdges = rung.edges.filter(
    (edge) => !edge.source.toLowerCase().includes('variable') && !edge.target.toLowerCase().includes('variable'),
  )
  return { nodes: newNodes, edges: newEdges }
}

/**
 * Rebuilds every block's variable boxes at its current pin positions, keeping the id and `numericId` of each box
 * whose block, pin and side are unchanged; `previousNodes` is a fallback identity source, `rung.nodes` wins.
 */
export const updateVariableBlockPosition = (
  rung: RungLadderState,
  previousNodes?: Node[],
): { nodes: Node[]; edges: Edge[] } => {
  const previousIdentities = collectVariableIdentities(previousNodes ? [...previousNodes, ...rung.nodes] : rung.nodes)

  const { nodes: removedVariableNodes, edges: removedVariableEdges } = removeVariableBlock(rung)
  let newNodes = removedVariableNodes
  let newEdges = removedVariableEdges

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
