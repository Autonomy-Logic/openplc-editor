import type { RungLadderState } from '../../../../../store/slices/ladder'
import { edgeTriggerInstanceName, edgeTriggerTypeForVariant } from '../../../../../utils/PLC/edge-trigger-instance'

export type LadderDebugContext = {
  isFunctionBlockPou: boolean
  hasProgramInstance: boolean
  getCompositeKey: (variableName: string) => string
  boolValues: Map<string, string>
}

export type RungDebugStates = {
  edgeStates: Map<string, boolean>
  nodeInputStates: Map<string, boolean>
}

export const computeRungDebugStates = (
  nodes: RungLadderState['nodes'],
  edges: RungLadderState['edges'],
  ctx: LadderDebugContext,
): RungDebugStates => {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]))
  const edgesByTarget = new Map<string, RungLadderState['edges']>()
  for (const edge of edges) {
    const list = edgesByTarget.get(edge.target)
    if (list) list.push(edge)
    else edgesByTarget.set(edge.target, [edge])
  }

  const getNodeOutputState = (
    nodeId: string,
    sourceHandle: string | null | undefined,
    isInputGreen: boolean,
  ): boolean | undefined => {
    const node = nodeById.get(nodeId)
    if (!node) return undefined

    if (node.type === 'powerRail') {
      return (node.data as { variant: 'left' | 'right' }).variant === 'left'
    }

    if (node.type === 'parallel') {
      return isInputGreen
    }

    if (node.type === 'contact') {
      const contactData = node.data as { variable?: { name: string }; variant: string; numericId?: string }
      const variableName = contactData.variable?.name
      if (!variableName) return undefined

      // An edge contact passes the trigger's pulse, not the variable's level.
      const edgeTriggerType = edgeTriggerTypeForVariant(contactData.variant)
      const edgeTriggerName = edgeTriggerType ? edgeTriggerInstanceName(edgeTriggerType, contactData.numericId) : null
      if (edgeTriggerType && !edgeTriggerName) return undefined

      const compositeKey = ctx.getCompositeKey(edgeTriggerName ? `${edgeTriggerName}.Q` : variableName)
      const value = ctx.boolValues.get(compositeKey)
      if (value === undefined) return undefined

      const isTrue = value === '1' || value.toUpperCase() === 'TRUE'
      const contactState = contactData.variant === 'negated' ? !isTrue : isTrue

      return isInputGreen && contactState
    }

    if (node.type === 'coil') {
      return isInputGreen
    }

    if (node.type === 'block') {
      const blockData = node.data as {
        variable?: { name: string }
        variant?: { name: string; type: string }
        numericId?: string
      }
      if (!sourceHandle) return undefined

      if (!ctx.isFunctionBlockPou && !ctx.hasProgramInstance) return undefined

      if (blockData.variant?.type === 'function-block') {
        const blockVariableName = blockData.variable?.name
        if (!blockVariableName) return undefined

        const compositeKey = ctx.getCompositeKey(`${blockVariableName}.${sourceHandle}`)
        const value = ctx.boolValues.get(compositeKey)

        if (value === undefined) return undefined

        return value === '1' || value.toUpperCase() === 'TRUE'
      } else if (blockData.variant?.type === 'function') {
        const blockName = blockData.variant.name.toUpperCase()
        const numericId = blockData.numericId
        if (!numericId) return undefined

        const compositeKey = ctx.getCompositeKey(`_TMP_${blockName}${numericId}_${sourceHandle.toUpperCase()}`)
        const value = ctx.boolValues.get(compositeKey)

        if (value === undefined) return undefined

        return value === '1' || value.toUpperCase() === 'TRUE'
      }

      return undefined
    }

    return undefined
  }

  const edgeStates = new Map<string, boolean>()

  const determineEdgeState = (edgeId: string): boolean => {
    if (edgeStates.has(edgeId)) {
      return edgeStates.get(edgeId)!
    }

    const edge = edgeById.get(edgeId)
    if (!edge) return false

    const incomingEdges = edgesByTarget.get(edge.source) ?? []

    let isInputGreen = false
    if (incomingEdges.length === 0) {
      const sourceNode = nodeById.get(edge.source)
      isInputGreen = sourceNode?.type === 'powerRail' && (sourceNode.data as { variant: string }).variant === 'left'
    } else {
      isInputGreen = incomingEdges.some((incomingEdge) => determineEdgeState(incomingEdge.id))
    }

    const sourceOutputState = getNodeOutputState(edge.source, edge.sourceHandle, isInputGreen)

    const isGreen = sourceOutputState === true
    edgeStates.set(edgeId, isGreen)
    return isGreen
  }

  edges.forEach((edge) => {
    determineEdgeState(edge.id)
  })

  const nodeInputStates = new Map<string, boolean>()

  const determineNodeInputState = (nodeId: string): boolean => {
    if (nodeInputStates.has(nodeId)) {
      return nodeInputStates.get(nodeId)!
    }

    const node = nodeById.get(nodeId)
    if (!node) return false

    if (node.type === 'powerRail' && (node.data as { variant: string }).variant === 'left') {
      nodeInputStates.set(nodeId, true)
      return true
    }

    const incomingEdges = edgesByTarget.get(nodeId) ?? []

    if (incomingEdges.length === 0) {
      nodeInputStates.set(nodeId, false)
      return false
    }

    const hasGreenInput = incomingEdges.some((incomingEdge) => {
      const sourceInputGreen = determineNodeInputState(incomingEdge.source)
      const sourceOutputGreen = getNodeOutputState(incomingEdge.source, incomingEdge.sourceHandle, sourceInputGreen)
      return sourceOutputGreen === true
    })

    nodeInputStates.set(nodeId, hasGreenInput)
    return hasGreenInput
  }

  nodes.forEach((node) => {
    determineNodeInputState(node.id)
  })

  return { edgeStates, nodeInputStates }
}
