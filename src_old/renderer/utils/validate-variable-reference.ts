import type { PLCPou, PLCVariable } from '@root/types/PLC/open-plc'

export type VariableValidationResult = {
  isValid: boolean
  variable?: PLCVariable
  error?: string
  errorType?: 'not-found' | 'type-mismatch'
}

export function validateVariableExists(
  variableName: string,
  pouName: string,
  pous: PLCPou[],
  globalVariables: PLCVariable[],
): VariableValidationResult {
  if (!variableName) {
    return {
      isValid: false,
      error: 'Variable name is empty',
      errorType: 'not-found',
    }
  }

  const normalizedName = variableName.toLowerCase()

  const pou = pous.find((p) => p.data.name === pouName)
  if (!pou) {
    return {
      isValid: false,
      error: `POU '${pouName}' not found`,
      errorType: 'not-found',
    }
  }

  let variable = pou.data.variables.find((v) => v.name.toLowerCase() === normalizedName)

  if (!variable) {
    variable = globalVariables.find((v) => v.name.toLowerCase() === normalizedName)
  }

  if (!variable) {
    return {
      isValid: false,
      error: `Variable '${variableName}' not found`,
      errorType: 'not-found',
    }
  }

  return {
    isValid: true,
    variable,
  }
}

export function validateContactCoilVariable(
  variableName: string,
  pouName: string,
  pous: PLCPou[],
  globalVariables: PLCVariable[],
): VariableValidationResult {
  const result = validateVariableExists(variableName, pouName, pous, globalVariables)

  if (!result.isValid || !result.variable) {
    return result
  }

  const typeName = result.variable.type.value.toUpperCase()
  if (typeName !== 'BOOL') {
    return {
      isValid: false,
      variable: result.variable,
      error: `Contacts and coils require BOOL type (got ${result.variable.type.value})`,
      errorType: 'type-mismatch',
    }
  }

  return result
}

export function validateBlockInstanceVariable(
  variableName: string,
  expectedType: string,
  pouName: string,
  pous: PLCPou[],
  globalVariables: PLCVariable[],
): VariableValidationResult {
  const result = validateVariableExists(variableName, pouName, pous, globalVariables)

  if (!result.isValid || !result.variable) {
    return result
  }

  const normalizedExpectedType = expectedType.toUpperCase()
  const normalizedVariableType = result.variable.type.value.toUpperCase()

  if (normalizedVariableType !== normalizedExpectedType) {
    return {
      isValid: false,
      variable: result.variable,
      error: `Type mismatch: expected ${expectedType}, got ${result.variable.type.value}`,
      errorType: 'type-mismatch',
    }
  }

  return result
}
