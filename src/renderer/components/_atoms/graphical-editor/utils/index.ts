import { baseTypeSchema, genericTypeSchema } from '@root/types/PLC'
import type { PLCVariable } from '@root/types/PLC/units/variable'
import { ZodLiteral } from 'zod'

import { BlockVariant } from '../ladder/block'
import { BlockVariant as newBlockVariant } from '../types/block'

export const getVariableByName = (variables: PLCVariable[], name: string): PLCVariable | undefined =>
  variables.find((variable) => variable.name === name && variable.type.definition !== 'derived')

export const getBlockDocumentation = (blockVariant: newBlockVariant): string => {
  const inputVariables = blockVariant.variables.filter(
    (variable) => variable.class === 'input' || variable.class === 'inOut',
  )

  const outputVariables = blockVariant.variables.filter(
    (variable) => variable.class === 'output' || variable.class === 'inOut',
  )

  const documentationString = `${blockVariant.documentation ? `${blockVariant.documentation}\n\n` : ''}INPUT:
      ${inputVariables
        .map(
          (variable, index) =>
            `${variable.name}: ${variable.type.value}${index < inputVariables.length - 1 ? '\n' : ''}`,
        )
        .join('')}

      OUTPUT:
      ${outputVariables
        .map(
          (variable, index) =>
            `${variable.name}: ${variable.type.value}${index < outputVariables.length - 1 ? '\n' : ''}`,
        )
        .join('')}`

  return documentationString
}

/**
 * Type validation function for the graphical editor.
 */
export const validateVariableType = (
  selectedType: string,
  expectedType: BlockVariant['variables'][0] | string,
): { isValid: boolean; error?: string } => {
  const upperSelectedType = selectedType.toUpperCase()
  const upperExpectedType = typeof expectedType === 'string' ? expectedType : expectedType.type.value.toUpperCase()

  if (upperExpectedType === 'ANY') {
    return {
      isValid: true,
      error: undefined,
    }
  }

  // Handle generic types
  if (upperExpectedType.includes('ANY_')) {
    const validTypes = genericTypeSchema.shape[upperExpectedType as keyof typeof genericTypeSchema.shape].options
    if (validTypes.length > 1) {
      const subValues: string[] = []
      validTypes.forEach((value) => {
        if (typeof value === 'string') {
          subValues.push(value.toLowerCase())
          return
        }

        if (value instanceof ZodLiteral) {
          ;(genericTypeSchema.shape[value.value as keyof typeof genericTypeSchema.shape].options as string[]).forEach(
            (subValue) => {
              subValues.push(subValue.toLowerCase())
            },
          )
          return
        }
      })

      return {
        isValid: subValues.includes(upperSelectedType.toLowerCase()),
        error: subValues.includes(upperSelectedType.toLowerCase())
          ? undefined
          : `Expected one of: ${subValues.join(', ')}`,
      }
    }
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
        if (typeof value === 'string') {
          subValues.push(value.toLowerCase())
          return
        }

        if (value instanceof ZodLiteral) {
          ;(genericTypeSchema.shape[value.value as keyof typeof genericTypeSchema.shape].options as string[]).forEach(
            (subValue) => {
              subValues.push(subValue.toLowerCase())
            },
          )
          return
        }
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

  const isABaseType = baseTypeSchema.safeParse(variableType)

  return {
    values: variableType.toLowerCase(),
    definition: isABaseType.success ? 'base-type' : 'derived',
  }
}
