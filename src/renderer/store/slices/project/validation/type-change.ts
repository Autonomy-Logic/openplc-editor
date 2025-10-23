import { validateVariableType } from '@root/renderer/components/_atoms/graphical-editor/utils'
import { FBDFlowState, LadderFlowState } from '@root/renderer/store/slices'
import type { PLCVariable } from '@root/types/PLC/open-plc'
import { Node } from '@xyflow/react'

export type NodeUsage = {
  pouName: string
  rungId?: string
  nodeId: string
  nodeType: string
  expectedType: string
  isCompatible: boolean
  compatibilityMessage?: string
}

export type TypeChangeValidationResult = {
  canChange: boolean
  affectedNodes: NodeUsage[]
  compatibleCount: number
  incompatibleCount: number
  warnings: string[]
}

const getBlockExpectedType = (node: Node): string => {
  const variant = (node.data as { variant?: { name?: string } }).variant

  if (node.type === 'contact' || node.type === 'coil') {
    return 'BOOL'
  }

  if (variant && typeof variant.name === 'string') {
    return variant.name.trim().toUpperCase()
  }

  return ''
}

const checkTypeCompatibility = (
  variableType: string,
  expectedType: string,
): { isCompatible: boolean; message?: string } => {
  if (!expectedType) {
    return { isCompatible: true }
  }

  const validation = validateVariableType(variableType, expectedType)

  return {
    isCompatible: validation.isValid,
    message: validation.error,
  }
}

export const validateTypeChange = (
  variableName: string,
  oldType: PLCVariable['type'],
  newType: PLCVariable['type'],
  ladderFlows: LadderFlowState['ladderFlows'],
  fbdFlows: FBDFlowState['fbdFlows'],
): TypeChangeValidationResult => {
  const affectedNodes: NodeUsage[] = []
  const warnings: string[] = []

  ladderFlows.forEach((flow) => {
    flow.rungs.forEach((rung) => {
      rung.nodes.forEach((node) => {
        const nodeVar = (node.data as { variable?: PLCVariable }).variable

        if (!nodeVar || nodeVar.name.toLowerCase() !== variableName.toLowerCase()) {
          return
        }

        const expectedType = getBlockExpectedType(node)
        const compatibility = checkTypeCompatibility(newType.value, expectedType)

        affectedNodes.push({
          pouName: flow.name,
          rungId: rung.id,
          nodeId: node.id,
          nodeType: node.type || 'unknown',
          expectedType,
          isCompatible: compatibility.isCompatible,
          compatibilityMessage: compatibility.message,
        })
      })
    })
  })

  fbdFlows.forEach((flow) => {
    flow.rung.nodes.forEach((node) => {
      const nodeVar = (node.data as { variable?: PLCVariable }).variable

      if (!nodeVar || nodeVar.name.toLowerCase() !== variableName.toLowerCase()) {
        return
      }

      const expectedType = getBlockExpectedType(node)
      const compatibility = checkTypeCompatibility(newType.value, expectedType)

      affectedNodes.push({
        pouName: flow.name,
        nodeId: node.id,
        nodeType: node.type || 'unknown',
        expectedType,
        isCompatible: compatibility.isCompatible,
        compatibilityMessage: compatibility.message,
      })
    })
  })

  const compatibleCount = affectedNodes.filter((node) => node.isCompatible).length
  const incompatibleCount = affectedNodes.filter((node) => !node.isCompatible).length

  if (incompatibleCount > 0) {
    warnings.push(`${incompatibleCount} node(s) will become incompatible with the new type "${newType.value}".`)
  }

  if (oldType.definition === 'base-type' && newType.definition === 'derived') {
    warnings.push('Changing to a derived type will clear the location field.')
  }

  return {
    canChange: true,
    affectedNodes,
    compatibleCount,
    incompatibleCount,
    warnings,
  }
}

export const validateNodeVariableCompatibility = (
  node: Node,
  variable: PLCVariable,
): { isCompatible: boolean; message?: string; suggestedFix?: string } => {
  const expectedType = getBlockExpectedType(node)

  if (!expectedType) {
    return { isCompatible: true }
  }

  const validation = validateVariableType(variable.type.value, expectedType)

  let suggestedFix: string | undefined

  if (!validation.isValid) {
    if (node.type === 'contact' || node.type === 'coil') {
      suggestedFix = 'Change variable type to BOOL or select a different variable'
    } else {
      suggestedFix = `Change variable type to ${expectedType} or select a different variable`
    }
  }

  return {
    isCompatible: validation.isValid,
    message: validation.error,
    suggestedFix,
  }
}
