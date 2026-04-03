import { ZodLiteral } from 'zod'

import { baseTypeSchema, genericTypeSchema } from '../../../middleware/shared/ports/plc-schemas'

export const validateVariableType = (
  selectedType: string,
  expectedType: string,
): { isValid: boolean; error?: string } => {
  const upperSelectedType = selectedType.toUpperCase()
  const upperExpectedType = expectedType.toUpperCase()

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
          subValues.push(value.toUpperCase())
          return
        }

        /* istanbul ignore next -- unreachable: schema values are always string | ZodLiteral */
        if (value instanceof ZodLiteral) {
          ;(genericTypeSchema.shape[value.value as keyof typeof genericTypeSchema.shape].options as string[]).forEach(
            (subValue) => {
              subValues.push(subValue.toUpperCase())
            },
          )
          return
        }
      })

      return {
        isValid: subValues.includes(upperSelectedType),
        error: subValues.includes(upperSelectedType) ? undefined : `Expected one of: ${subValues.join(', ')}`,
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
          subValues.push(value.toUpperCase())
          return
        }

        /* istanbul ignore next -- unreachable: schema values are always string | ZodLiteral */
        if (value instanceof ZodLiteral) {
          ;(genericTypeSchema.shape[value.value as keyof typeof genericTypeSchema.shape].options as string[]).forEach(
            (subValue) => {
              subValues.push(subValue.toUpperCase())
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
      values: (values as string[]).map((value) => value.toUpperCase()),
      definition: 'base-type',
    }
  }

  const isABaseType = baseTypeSchema.safeParse(variableType.toUpperCase())

  return {
    values: isABaseType.success ? variableType.toUpperCase() : variableType,
    definition: isABaseType.success ? 'base-type' : 'derived',
  }
}
