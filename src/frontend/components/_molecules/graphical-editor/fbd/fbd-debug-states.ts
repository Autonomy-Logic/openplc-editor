import type { PLCVariable } from '../../../../../middleware/shared/ports/types'
import type { FBDRungState } from '../../../../store/slices/fbd'

/** Debug values and lookups that colour FBD wires. */
export type FBDDebugContext = {
  isFunctionBlockPou: boolean
  hasProgramInstance: boolean
  getCompositeKey: (variableName: string) => string
  boolValues: Map<string, string>
  forcedValues: Map<string, boolean>
  pouVariables: PLCVariable[] | undefined
}

/**
 * Wire id to energised state. A wire is energised when its source output is a TRUE BOOL in `boolValues`, which holds
 * only BOOL variables, so generic-typed function outputs (ANY_BIT) colour too; connectors and continuations pass through.
 */
export const computeFBDEdgeStates = (
  nodes: FBDRungState['nodes'],
  edges: FBDRungState['edges'],
  ctx: FBDDebugContext,
): Map<string, boolean> => {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]))
  const edgesByTarget = new Map<string, FBDRungState['edges']>()
  for (const edge of edges) {
    const list = edgesByTarget.get(edge.target)
    if (list) list.push(edge)
    else edgesByTarget.set(edge.target, [edge])
  }
  const variablesByName = new Map<string, PLCVariable>()
  for (const variable of ctx.pouVariables ?? []) {
    const key = variable.name.toLowerCase()
    if (!variablesByName.has(key)) variablesByName.set(key, variable)
  }

  const getNodeOutputState = (nodeId: string, sourceHandle: string | null | undefined): boolean | undefined => {
    const node = nodeById.get(nodeId)
    if (!node) return undefined

    if (node.type === 'input-variable' || node.type === 'output-variable' || node.type === 'inout-variable') {
      const variableData = node.data as { variable?: { name: string } }
      const variableName = variableData.variable?.name
      if (!variableName) return undefined

      const variable = variablesByName.get(variableName.toLowerCase())
      if (!variable || variable.type.value.toUpperCase() !== 'BOOL') return undefined

      const compositeKey = ctx.getCompositeKey(variableName)

      if (ctx.forcedValues.has(compositeKey)) {
        return ctx.forcedValues.get(compositeKey)
      }

      const value = ctx.boolValues.get(compositeKey)
      if (value === undefined) return undefined

      return value === '1' || value.toUpperCase() === 'TRUE'
    }

    if (node.type === 'block') {
      const blockData = node.data as {
        variable?: { name: string }
        variant?: { name: string; type: string; variables: Array<{ name: string }> }
      }
      if (!sourceHandle) return undefined

      if (!ctx.isFunctionBlockPou && !ctx.hasProgramInstance) return undefined

      if (!blockData.variant?.variables.some((v) => v.name === sourceHandle)) return undefined

      if (blockData.variant?.type === 'function-block') {
        const blockVariableName = blockData.variable?.name
        if (!blockVariableName) return undefined

        const compositeKey = ctx.getCompositeKey(`${blockVariableName}.${sourceHandle}`)
        const value = ctx.boolValues.get(compositeKey)

        if (value === undefined) return undefined

        return value === '1' || value.toUpperCase() === 'TRUE'
      } else if (blockData.variant?.type === 'function') {
        const blockName = blockData.variant.name.toUpperCase()
        const numericId = (node.data as { numericId?: string }).numericId
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

  const isPassThroughNode = (node: FBDRungState['nodes'][number]): boolean => {
    return node.type === 'connector' || node.type === 'continuation'
  }

  const edgeStates = new Map<string, boolean>()

  const determineEdgeState = (edgeId: string, visited: Set<string>): boolean => {
    if (edgeStates.has(edgeId)) {
      return edgeStates.get(edgeId)!
    }

    if (visited.has(edgeId)) {
      return false
    }
    visited.add(edgeId)

    const edge = edgeById.get(edgeId)
    if (!edge) {
      visited.delete(edgeId)
      return false
    }

    const sourceNode = nodeById.get(edge.source)
    if (!sourceNode) {
      visited.delete(edgeId)
      return false
    }

    const incomingEdges = edgesByTarget.get(edge.source) ?? []
    const isInputGreen = incomingEdges.some((incomingEdge) => determineEdgeState(incomingEdge.id, visited))

    const sourceOutputState = getNodeOutputState(edge.source, edge.sourceHandle)

    const isGreen = isPassThroughNode(sourceNode) ? isInputGreen : sourceOutputState === true

    edgeStates.set(edgeId, isGreen)
    visited.delete(edgeId)
    return isGreen
  }

  edges.forEach((edge) => {
    determineEdgeState(edge.id, new Set())
  })

  return edgeStates
}
