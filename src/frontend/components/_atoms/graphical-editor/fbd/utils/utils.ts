import { Position } from '@xyflow/react'

import type { PLCPou } from '../../../../../../middleware/shared/ports/types'
import type { PLCVariable } from '../../../../../../middleware/shared/ports/types'
import type { FBDFlowType } from '../../../../../store/slices/fbd'
import type { LadderFlowType } from '../../../../../store/slices/ladder'
import { resolveArrayVariableByName } from '../../../../../utils/PLC/array-variable-utils'
import { BlockVariant } from '../../types/block'
import { customNodeTypes } from '..'
import { buildHandle } from '../handle'
import { DEFAULT_BLOCK_CONNECTOR_Y, DEFAULT_BLOCK_CONNECTOR_Y_OFFSET, DEFAULT_BLOCK_WIDTH } from './constants'
import type { BasicNodeData } from './types'

// `pouName` is the bound POU for the caller's editor instance (from
// `useBoundPou()` under multi-mount, or the active editor's name for
// legacy single-mount call sites).  Taking it as a string instead of
// the full `EditorModel` avoids leaking the *global* `state.editor`
// into hidden multi-mounted nodes — that was the root cause of the
// "Node or rung not found for ID:" spam we used to see.
export const getFBDPouVariablesRungNodeAndEdges = (
  pouName: string,
  pous: PLCPou[],
  fbdFlows: FBDFlowType[],
  data: { nodeId: string; variableName?: string },
): {
  pou: PLCPou | undefined
  rung: FBDFlowType['rung'] | undefined
  variables: { all: PLCVariable[]; selected: PLCVariable | undefined }
  edges: {
    source: LadderFlowType['rungs'][0]['edges'] | undefined
    target: LadderFlowType['rungs'][0]['edges'] | undefined
  }
  node: LadderFlowType['rungs'][0]['nodes'][0] | undefined
} => {
  const pou = pous.find((pou) => pou.name === pouName)
  const rung = fbdFlows.find((flow) => flow.name === pouName)?.rung
  const node = rung?.nodes.find((node) => node.id === data.nodeId)

  const variables: PLCVariable[] = pou?.interface?.variables ?? []
  let variable = variables.find((variable) => {
    if (!node) return undefined
    switch (node.type as keyof typeof customNodeTypes) {
      case 'block':
        return (
          (node.data as BasicNodeData).variable.name !== undefined &&
          (node.data as BasicNodeData).variable.name.toLowerCase() === variable.name.toLowerCase()
        )
      case 'connector':
      case 'continuation':
        return undefined
      case 'comment':
        return undefined
      case 'input-variable':
      case 'output-variable':
      case 'inout-variable':
        // Variable nodes - allow all types including derived (user-defined types)
        return (node.data as BasicNodeData).variable.name !== undefined
          ? variable.name.toLowerCase() === (node.data as BasicNodeData).variable.name.toLowerCase()
          : variable.name === data.variableName
      default:
        // Other node types - only allow base types (not derived/user-defined)
        return (
          ((node.data as BasicNodeData).variable.name !== undefined
            ? variable.name.toLowerCase() === (node.data as BasicNodeData).variable.name.toLowerCase()
            : variable.name === data.variableName) && variable.type.definition !== 'derived'
        )
    }
  })

  // Fallback: try to resolve as array element access (e.g. "Sensor[0]")
  if (!variable && node) {
    const nodeType = node.type as keyof typeof customNodeTypes
    if (nodeType !== 'connector' && nodeType !== 'continuation' && nodeType !== 'comment') {
      const varName = (node.data as BasicNodeData).variable.name || data.variableName
      if (varName) {
        const resolved = resolveArrayVariableByName(variables, varName)
        if (
          resolved &&
          (nodeType === 'block' ||
            nodeType === 'input-variable' ||
            nodeType === 'output-variable' ||
            nodeType === 'inout-variable' ||
            resolved.type.definition !== 'derived')
        ) {
          variable = resolved
        }
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
    Math.max(variableInputWidth + 12 + variableOutputWidth, blockNameWidth),
    DEFAULT_BLOCK_WIDTH,
  )

  const leftHandles = inputConnectors.map((connector, index) =>
    buildHandle({
      id: `${connector}`,
      position: Position.Left,
      type: 'target',
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
  const variant = { ...variantLib }

  if (executionControl) {
    const existingEN = variant.variables.find((variable) => variable.name === 'EN')
    const existingENO = variant.variables.find((variable) => variable.name === 'ENO')
    const otherVariables = variant.variables.filter((variable) => variable.name !== 'EN' && variable.name !== 'ENO')

    const EN = existingEN || {
      name: 'EN',
      class: 'input',
      type: { definition: 'base-type', value: 'BOOL' },
    }
    const ENO = existingENO || {
      name: 'ENO',
      class: 'output',
      type: { definition: 'base-type', value: 'BOOL' },
    }

    variant.variables = [EN, ENO, ...otherVariables]
  } else {
    variant.variables = variant.variables.filter((variable) => variable.name !== 'EN' && variable.name !== 'ENO')
  }

  return {
    variant: variant,
    executionControl: executionControl,
  }
}
