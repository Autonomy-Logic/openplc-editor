import type { EditorModel, FlowType } from '@root/renderer/store/slices'
import { genericTypeSchema } from '@root/types/PLC'
import type { PLCPou } from '@root/types/PLC/open-plc'
import type { PLCVariable } from '@root/types/PLC/units/variable'

import { BlockVariant } from '../block'
import { BasicNodeData } from './types'

export const getPouVariablesRungNodeAndEdges = (
  editor: EditorModel,
  pous: PLCPou[],
  flows: FlowType[],
  data: { nodeId: string; variableName?: string },
): {
  pou: PLCPou | undefined
  rung: FlowType['rungs'][0] | undefined
  variables: { all: PLCVariable[]; selected: PLCVariable | undefined }
  edges: { source: FlowType['rungs'][0]['edges'] | undefined; target: FlowType['rungs'][0]['edges'] | undefined }
  node: FlowType['rungs'][0]['nodes'][0] | undefined
} => {
  const pou = pous.find((pou) => pou.data.name === editor.meta.name)

  const rung = flows
    .find((flow) => flow.name === editor.meta.name)
    ?.rungs.find((rung) => rung.nodes.some((node) => node.id === data.nodeId))

  const node = rung?.nodes.find((node) => node.id === data.nodeId)

  const variables: PLCVariable[] = pou?.data.variables as PLCVariable[]
  const variable = variables.find((variable) => {
    if (!node) return undefined
    switch (node.type) {
      case 'block':
        return (
          (node.data as BasicNodeData).variable.id !== undefined &&
          (node.data as BasicNodeData).variable.id === variable.id
        )
      // case 'variable':
      //   return variable.name === data.variableName && variable.type.definition !== 'derived'
      default:
        return (
          ((node.data as BasicNodeData).variable.id !== undefined
            ? variable.id === (node.data as BasicNodeData).variable.id
            : variable.name === data.variableName) && variable.type.definition !== 'derived'
        )
    }
  })

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

export const getVariableByName = (variables: PLCVariable[], name: string): PLCVariable | undefined =>
  variables.find((variable) => variable.name === name && variable.type.definition !== 'derived')

export const validateVariableType = (
  selectedType: string,
  expectedType: BlockVariant['variables'][0],
): { isValid: boolean; error?: string } => {
  const upperSelectedType = selectedType.toUpperCase()
  const upperExpectedType = expectedType.type.value.toUpperCase()

  if (upperExpectedType === 'ANY') {
    return {
      isValid: true,
      error: undefined,
    }
  }

  // Handle generic types
  if (upperExpectedType.includes('ANY')) {
    const validTypes = genericTypeSchema.shape[upperExpectedType as keyof typeof genericTypeSchema.shape].options
    if (validTypes.length > 1) {
      const subValues: string[] = []
      validTypes.forEach((value) => {
        ;(genericTypeSchema.shape[value.value as keyof typeof genericTypeSchema.shape].options as string[]).forEach(
          (subValue) => {
            subValues.push(subValue.toLowerCase())
          },
        )
      })
      return {
        isValid: subValues.includes(upperSelectedType.toLowerCase()),
        error: subValues.includes(upperSelectedType.toLowerCase())
          ? undefined
          : `Expected one of: ${subValues.join(', ')}`,
      }
    }
    console.log('types', validTypes)
    return {
      isValid: Object.values(validTypes).includes(upperSelectedType),
      error: Object.values(validTypes).includes(upperSelectedType)
        ? undefined
        : `Expected one of: ${Object.values(validTypes).join(', ')}`,
    }
  }

  // Handle specific types
  return {
    isValid: upperSelectedType === upperExpectedType,
    error:
      upperSelectedType === upperExpectedType ? undefined : `Expected: ${upperExpectedType}, Got: ${upperSelectedType}`,
  }
}

export const getVariableRestrictionType = (variableType: string) => {
  if (variableType === 'ANY') {
    return {
      values: undefined,
      definition: undefined,
    }
  }

  if (variableType.includes('ANY_')) {
    const values = genericTypeSchema.shape[variableType as keyof typeof genericTypeSchema.shape].options
    if (values.length > 1) {
      const subValues: string[] = []
      values.forEach((value) => {
        ;(genericTypeSchema.shape[value.value as keyof typeof genericTypeSchema.shape].options as string[]).forEach(
          (subValue) => {
            subValues.push(subValue.toLowerCase())
          },
        )
      })
      return {
        values: subValues,
        definition: 'base-type',
      }
    }
    return {
      values: (values as string[]).map((value) => value.toLowerCase()),
      definition: 'base-type',
    }
  }

  return {
    values: variableType.toLowerCase(),
    definition: 'base-type',
  }
}
