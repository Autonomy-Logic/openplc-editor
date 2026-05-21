import { Position } from '@xyflow/react'

import type { PLCPou } from '../../../../../../middleware/shared/ports'
import type { PLCVariable } from '../../../../../../middleware/shared/ports'
import type { LadderFlowType } from '../../../../../store/slices/ladder'
import { resolveArrayVariableByName } from '../../../../../utils/PLC/array-variable-utils'
import {
  getVariableRestrictionType as _getVariableRestrictionType,
  validateVariableType as _validateVariableType,
} from '../../../../../utils/PLC/validate-variable-type'
import { buildHandle } from '../handle'
import { DEFAULT_BLOCK_CONNECTOR_Y, DEFAULT_BLOCK_CONNECTOR_Y_OFFSET, DEFAULT_BLOCK_WIDTH } from './constants'
import type { BasicNodeData, BlockVariant } from './types'

// `pouName` is the bound POU for the caller's editor instance — see
// the FBD helper next door for the full rationale.  In short: the
// editor used to be passed in so we could read `editor.meta.name`,
// but that always resolves to the globally-active editor and breaks
// multi-mounted instances.
export const getLadderPouVariablesRungNodeAndEdges = (
  pouName: string,
  pous: PLCPou[],
  ladderFlows: LadderFlowType[],
  data: { nodeId: string; variableName?: string },
): {
  pou: PLCPou | undefined
  rung: LadderFlowType['rungs'][0] | undefined
  variables: { all: PLCVariable[]; selected: PLCVariable | undefined }
  edges: {
    source: LadderFlowType['rungs'][0]['edges'] | undefined
    target: LadderFlowType['rungs'][0]['edges'] | undefined
  }
  node: LadderFlowType['rungs'][0]['nodes'][0] | undefined
} => {
  const pou = pous.find((pou) => pou.name === pouName)

  const rung = ladderFlows
    .find((flow) => flow.name === pouName)
    ?.rungs.find((rung) => rung.nodes.some((node) => node.id === data.nodeId))

  const node = rung?.nodes.find((node) => node.id === data.nodeId)

  const variables: PLCVariable[] = pou?.interface?.variables ?? []
  let variable = variables.find((variable) => {
    if (!node) return undefined
    const nodeVariable = (node.data as BasicNodeData).variable
    if (!nodeVariable) return undefined

    switch (node.type) {
      case 'block':
        return nodeVariable.name && variable.name.toLowerCase() === nodeVariable.name.toLowerCase()
      case 'variable': {
        // Variable nodes connected to block pins - allow all types including derived (user-defined types)
        const nameToMatch = data.variableName || nodeVariable.name
        return nameToMatch && variable.name.toLowerCase() === nameToMatch.toLowerCase()
      }
      default: {
        // Contacts and coils - only allow base types (not derived/user-defined)
        const nameToMatch = data.variableName || nodeVariable.name
        return (
          nameToMatch &&
          variable.name.toLowerCase() === nameToMatch.toLowerCase() &&
          variable.type.definition !== 'derived'
        )
      }
    }
  })

  // Fallback: try to resolve as array element access (e.g. "Sensor[0]")
  if (!variable && node) {
    const nodeVariable = (node.data as BasicNodeData).variable
    const varName = nodeVariable?.name || data.variableName
    if (varName) {
      const resolved = resolveArrayVariableByName(variables, varName)
      if (resolved && (node.type === 'block' || node.type === 'variable' || resolved.type.definition !== 'derived')) {
        variable = resolved
      }
    }
  }

  const edgesThatNodeIsSource = rung?.edges.filter((edge) => edge.source === data.nodeId)
  const edgesThatNodeIsTarget = rung?.edges.filter((edge) => edge.target === data.nodeId)

  return {
    pou,
    rung,
    variables: { all: variables, selected: variable },
    edges: { source: edgesThatNodeIsSource, target: edgesThatNodeIsTarget },
    node,
  }
}

export const getVariableByName = (variables: PLCVariable[], name: string): PLCVariable | undefined => {
  const exact = variables.find((variable) => variable.name === name && variable.type.definition !== 'derived')
  if (exact) return exact

  return resolveArrayVariableByName(variables, name)
}

/** Validate a selected type against a block input/output type.  Thin
 *  wrapper around the shared PLC validator so callers can pass either
 *  a `BlockVariant` variable object or a bare type-name string.  The
 *  shared validator walks `genericTypeSchema` recursively, so composite
 *  generics like `ANY_NUM` / `ANY_MAGNITUDE` / `ANY_ELEMENTARY` (whose
 *  `.options` are unions of other generic literals, not flat strings)
 *  resolve correctly. */
export const validateVariableType = (
  selectedType: string,
  expectedType: BlockVariant['variables'][0] | string,
): { isValid: boolean; error?: string } => {
  const typeName = typeof expectedType === 'string' ? expectedType : expectedType.type.value
  return _validateVariableType(selectedType, typeName)
}

export const getVariableRestrictionType = _getVariableRestrictionType

export const getBlockSize = (
  variant: BlockVariant,
  handlePosition: {
    x: number
    y: number
  },
) => {
  const inputConnectors = variant.variables
    .filter((variable) => variable.class === 'input' || variable.class === 'inOut')
    .map((variable) => variable.name)
  const outputConnectors = variant.variables
    .filter((variable) => variable.class === 'output' || variable.class === 'inOut')
    .map((variable) => variable.name)

  const blockHeight =
    DEFAULT_BLOCK_CONNECTOR_Y +
    24 +
    Math.max(inputConnectors.length - 1, outputConnectors.length - 1) * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET

  let variableInputWidth = 0
  let variableOutputWidth = 0
  const blockNameWidth = variant.name.length * 12
  inputConnectors.forEach((input) => {
    const inputWidth = input.length * 12
    if (inputWidth > variableInputWidth) variableInputWidth = inputWidth
  })
  outputConnectors.forEach((output) => {
    const outputWidth = output.length * 12
    if (outputWidth > variableOutputWidth) variableOutputWidth = outputWidth
  })

  const blockWidth = Math.min(
    Math.max(variableInputWidth + 18 + variableOutputWidth, blockNameWidth),
    DEFAULT_BLOCK_WIDTH,
  )

  const leftHandles = inputConnectors.map((connector, index) =>
    buildHandle({
      id: `${connector}`,
      position: Position.Left,
      type: 'target',
      isConnectable: false,
      glbX: handlePosition.x,
      glbY: handlePosition.y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
      relX: 0,
      relY: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
      style: {
        top: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
        left: 0,
      },
    }),
  )

  const rightHandles = outputConnectors.map((connector, index) =>
    buildHandle({
      id: `${connector}`,
      position: Position.Right,
      type: 'source',
      isConnectable: false,
      glbX: handlePosition.x + blockWidth,
      glbY: handlePosition.y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
      relX: blockWidth,
      relY: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
      style: {
        top: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
        right: 0,
      },
    }),
  )

  const handles = [...leftHandles, ...rightHandles]

  return {
    handles,
    leftHandles,
    rightHandles,
    height: blockHeight,
    width: blockWidth,
  }
}

export const getBlockVariantAndExecutionControl = (variantLib: BlockVariant, executionControl: boolean) => {
  const inputConnectors = variantLib.variables
    .filter((variable) => variable.class === 'input' || variable.class === 'inOut')
    .map((variable) => ({
      name: variable.name,
      type: variable.type,
    }))
  const outputConnectors = variantLib.variables
    .filter((variable) => variable.class === 'output' || variable.class === 'inOut')
    .map((variable) => ({
      name: variable.name,
      type: variable.type,
    }))

  const mustHaveExecutionControlEnabled =
    inputConnectors.length === 0 ||
    !validateVariableType('BOOL', inputConnectors[0].type.value.toUpperCase()).isValid ||
    outputConnectors.length === 0 ||
    !validateVariableType('BOOL', outputConnectors[0].type.value.toUpperCase()).isValid

  const existingEN = variantLib.variables.find((v) => v.name === 'EN')
  const existingENO = variantLib.variables.find((v) => v.name === 'ENO')
  const others = variantLib.variables.filter((v) => v.name !== 'EN' && v.name !== 'ENO')

  let newVariables = others
  if (executionControl || mustHaveExecutionControlEnabled) {
    const EN = existingEN || {
      name: 'EN',
      class: 'input',
      type: { definition: 'generic-type', value: 'BOOL' },
    }
    const ENO = existingENO || {
      name: 'ENO',
      class: 'output',
      type: { definition: 'generic-type', value: 'BOOL' },
    }
    newVariables = [EN, ENO, ...others]
  }

  return {
    variant: { ...variantLib, variables: newVariables },
    executionControl: executionControl || mustHaveExecutionControlEnabled,
    lockExecutionControl: mustHaveExecutionControlEnabled,
  }
}
