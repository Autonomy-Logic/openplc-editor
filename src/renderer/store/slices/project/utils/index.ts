import { PLCDataType, PLCVariable } from '@root/types/PLC/open-plc'

/**
 * Legacy function for backward compatibility.
 * Looks up variables by EITHER row index OR variable ID.
 * @deprecated Use getVariableByNameAndType for new code
 */
export const getVariableBasedOnRowIdOrVariableId = (
  variables: PLCVariable[] | Omit<PLCVariable, 'class'>[],
  rowId?: number,
  _variableId?: string,
): PLCVariable | Omit<PLCVariable, 'class'> | null => {
  if (rowId !== undefined) {
    const variable = variables[rowId]
    if (!variable) {
      return null
    }
    return variable
  }

  console.error('variableId or rowId not given')
  return null
}

/**
 * Type compatibility result.
 */
export type TypeCompatibility = {
  isCompatible: boolean
  reason?: string
}

/**
 * Extract type name from a type object.
 */
function getTypeName(type: PLCVariable['type']): string {
  return type.value
}

/**
 * Checks if a variable type is compatible with an expected type (simple string form).
 * Handles base types, derived types, and user-defined types.
 */
function checkSimpleTypeCompatibility(
  variableType: PLCVariable['type'],
  expectedTypeName: string,
  dataTypes: PLCDataType[],
): TypeCompatibility {
  const varTypeName = getTypeName(variableType)
  const expectedNormalized = expectedTypeName.toUpperCase()
  const varNormalized = varTypeName.toUpperCase()

  if (varNormalized === expectedNormalized) {
    return { isCompatible: true }
  }

  const userType = dataTypes.find((dt) => dt.name.toUpperCase() === expectedNormalized)
  if (userType) {
    if (
      variableType.definition === 'user-data-type' &&
      variableType.value.toUpperCase() === userType.name.toUpperCase()
    ) {
      return { isCompatible: true }
    }
  }

  return {
    isCompatible: false,
    reason: `Type mismatch: expected ${expectedTypeName}, got ${varTypeName}`,
  }
}

/**
 * Checks if a variable type is compatible with an expected type (full type object form).
 * TODO: Implement array dimension checking. Currently, array types are compared only by name, (important-comment)
 * but we should also validate that array dimensions match (e.g., ARRAY[0..9] vs ARRAY[0..19]). (important-comment)
 * This will require parsing the array bounds from the type value and comparing them. (important-comment)
 */
function checkComplexTypeCompatibility(
  variableType: PLCVariable['type'],
  expectedType: PLCVariable['type'],
  _dataTypes: PLCDataType[],
): TypeCompatibility {
  if (variableType.definition !== expectedType.definition) {
    return {
      isCompatible: false,
      reason: `Definition mismatch: expected ${expectedType.definition}, got ${variableType.definition}`,
    }
  }

  const varValue = variableType.value.toUpperCase()
  const expectedValue = expectedType.value.toUpperCase()

  if (varValue !== expectedValue) {
    return {
      isCompatible: false,
      reason: `Type mismatch: expected ${expectedType.value}, got ${variableType.value}`,
    }
  }

  return { isCompatible: true }
}

/**
 * Checks if a variable type is compatible with an expected type.
 * Handles base types, derived types, user-defined types, and arrays.
 */
export function checkTypeCompatibility(
  variableType: PLCVariable['type'],
  expectedType: PLCVariable['type'] | string,
  dataTypes: PLCDataType[],
): TypeCompatibility {
  if (typeof expectedType === 'string') {
    return checkSimpleTypeCompatibility(variableType, expectedType, dataTypes)
  }

  return checkComplexTypeCompatibility(variableType, expectedType, dataTypes)
}

/**
 * Finds a variable by name and type within a list of variables.
 * Replaces ID-based lookups with name+type composite key.
 *
 * @param variables - Array of variables to search
 * @param variableName - Variable name (case-insensitive)
 * @param expectedType - Optional type to match (can be string or full type object)
 * @param dataTypes - Optional array of user-defined data types for type checking
 * @returns The matching variable or null if not found
 */
export function getVariableByNameAndType(
  variables: PLCVariable[] | Omit<PLCVariable, 'class'>[],
  variableName: string,
  expectedType?: PLCVariable['type'] | string,
  dataTypes?: PLCDataType[],
): PLCVariable | Omit<PLCVariable, 'class'> | null {
  if (!variableName) {
    return null
  }

  const normalizedName = variableName.toLowerCase()

  const matchingVariables = variables.filter((v) => v.name.toLowerCase() === normalizedName)

  if (matchingVariables.length === 0) {
    return null
  }

  if (!expectedType) {
    return matchingVariables[0]
  }

  for (const variable of matchingVariables) {
    const compatibility = checkTypeCompatibility(variable.type, expectedType, dataTypes || [])

    if (compatibility.isCompatible) {
      return variable
    }
  }

  return null
}
