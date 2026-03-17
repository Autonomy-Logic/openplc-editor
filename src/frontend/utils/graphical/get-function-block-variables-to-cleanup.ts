import type { Node } from '@xyflow/react'

import type { BlockVariant } from '../../../middleware/shared/ports/block-types'
import type { PLCVariable } from '../../../middleware/shared/ports/types'

type BlockNode = Node<{ variable?: { name: string }; variant: BlockVariant }>

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
        const blockNode = node as BlockNode
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
      const blockNode = node as BlockNode
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
