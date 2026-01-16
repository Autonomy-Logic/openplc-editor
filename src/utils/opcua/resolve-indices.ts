import type { OpcUaNodeConfig } from '@root/types/PLC/open-plc'

import type { DebugVariable, ResolvedField } from './types'

/**
 * Custom error class for OPC-UA configuration errors
 */
export class OpcUaConfigError extends Error {
  constructor(
    public readonly variableRef: string,
    public readonly expectedPath: string,
    message: string,
  ) {
    super(message)
    this.name = 'OpcUaConfigError'
  }
}

/**
 * Build the debug path for a program/FB instance variable.
 * Handles nested structures, arrays, and function blocks.
 *
 * @param pouName - Name of the POU (program or FB)
 * @param variablePath - Path to the variable (e.g., "MOTOR_SPEED" or "CTRL.OUTPUT")
 * @returns The expected debug.c path
 */
const buildInstancePath = (pouName: string, variablePath: string): string => {
  // The instance name in debug.c is uppercase
  // Format: RES0__INSTANCE0.VARIABLE_PATH
  // Note: INSTANCE0 is typically the program name, but for simplicity we use the standard format

  const pathParts = variablePath.split('.')
  let debugPath = `RES0__${pouName.toUpperCase()}`

  for (const part of pathParts) {
    // Check if this part is an array index like "[0]"
    if (part.includes('[')) {
      // Handle array access: VAR[0] -> VAR.value.table[0]
      const bracketIndex = part.indexOf('[')
      const varName = part.substring(0, bracketIndex)
      const arrayIndex = part.substring(bracketIndex)
      debugPath += `.${varName.toUpperCase()}.value.table${arrayIndex}`
    } else {
      debugPath += `.${part.toUpperCase()}`
    }
  }

  return debugPath
}

/**
 * Build the debug path for a structure field.
 * Structure fields have ".value." inserted before each field access.
 *
 * @param pouName - Name of the POU
 * @param variablePath - Path including structure and field (e.g., "SENSOR.temperature")
 * @returns The expected debug.c path
 */
const buildStructFieldPath = (pouName: string, variablePath: string): string => {
  const pathParts = variablePath.split('.')
  let debugPath = `RES0__${pouName.toUpperCase()}`

  // First part is the variable name
  debugPath += `.${pathParts[0].toUpperCase()}`

  // Subsequent parts are fields, need .value. prefix
  for (let i = 1; i < pathParts.length; i++) {
    const part = pathParts[i]

    // Check if this part is an array index
    if (part.includes('[')) {
      const bracketIndex = part.indexOf('[')
      const fieldName = part.substring(0, bracketIndex)
      const arrayIndex = part.substring(bracketIndex)

      if (fieldName) {
        debugPath += `.value.${fieldName.toUpperCase()}.value.table${arrayIndex}`
      } else {
        // Just an array index like "[0]"
        debugPath += `.value.table${arrayIndex}`
      }
    } else {
      debugPath += `.value.${part.toUpperCase()}`
    }
  }

  return debugPath
}

/**
 * Build the debug path for an array's first element.
 *
 * @param pouName - Name of the POU
 * @param variablePath - Path to the array variable
 * @returns The expected debug.c path for element [0]
 */
const buildArrayElementPath = (pouName: string, variablePath: string): string => {
  // Array elements are stored as VAR.value.table[i]
  return `RES0__${pouName.toUpperCase()}.${variablePath.toUpperCase()}.value.table[0]`
}

/**
 * Build the debug path for a global variable.
 * Global variables use CONFIG0__ prefix.
 *
 * @param variablePath - Path to the global variable
 * @returns The expected debug.c path
 */
const buildGlobalPath = (variablePath: string): string => {
  return `CONFIG0__${variablePath.toUpperCase()}`
}

/**
 * Determine if a variable path looks like a structure field access.
 * Structure fields contain dots but aren't arrays or simple FB variables.
 */
const isStructureFieldPath = (variablePath: string): boolean => {
  // If it contains a dot and doesn't look like an array element
  return variablePath.includes('.') && !variablePath.includes('[')
}

/**
 * Resolve the index for a simple variable node.
 *
 * @param node - The OPC-UA node configuration
 * @param debugVariables - Parsed debug variables from debug.c
 * @returns The resolved index
 * @throws OpcUaConfigError if the variable cannot be resolved
 */
export const resolveVariableIndex = (node: OpcUaNodeConfig, debugVariables: DebugVariable[]): number => {
  let debugPath: string

  // Determine the debug path based on variable location
  if (node.pouName === 'GVL' || node.pouName === 'CONFIG' || node.pouName.toUpperCase() === 'GVL') {
    // Global variable
    debugPath = buildGlobalPath(node.variablePath)
  } else if (isStructureFieldPath(node.variablePath)) {
    // Structure field access
    debugPath = buildStructFieldPath(node.pouName, node.variablePath)
  } else {
    // Simple instance variable
    debugPath = buildInstancePath(node.pouName, node.variablePath)
  }

  // Find matching entry in debug.c (case-insensitive comparison)
  const match = debugVariables.find((dv) => dv.name.toUpperCase() === debugPath.toUpperCase())

  if (!match) {
    // Try alternative paths
    // Sometimes the path might be simpler without .value. insertions
    const simplePath = `RES0__${node.pouName.toUpperCase()}.${node.variablePath.toUpperCase()}`
    const simpleMatch = debugVariables.find((dv) => dv.name.toUpperCase() === simplePath.toUpperCase())

    if (simpleMatch) {
      return simpleMatch.index
    }

    throw new OpcUaConfigError(
      `${node.pouName}:${node.variablePath}`,
      debugPath,
      `Cannot resolve OPC-UA variable index.\n` +
        `  Variable: ${node.pouName}:${node.variablePath}\n` +
        `  Expected debug path: ${debugPath}\n` +
        `  This may happen if:\n` +
        `    - The PLC program was modified after configuring OPC-UA\n` +
        `    - The variable name is incorrect\n` +
        `    - The variable was removed from the program\n` +
        `  Please verify the variable exists in the program.`,
    )
  }

  return match.index
}

/**
 * Resolve indices for all fields in a structure.
 *
 * @param node - The OPC-UA node configuration for the structure
 * @param debugVariables - Parsed debug variables from debug.c
 * @returns Array of resolved fields with indices
 * @throws OpcUaConfigError if any field cannot be resolved
 */
export const resolveStructureIndices = (node: OpcUaNodeConfig, debugVariables: DebugVariable[]): ResolvedField[] => {
  if (!node.fields || node.fields.length === 0) {
    // If no field configs, try to resolve the structure variable itself
    const index = resolveVariableIndex(node, debugVariables)
    return [
      {
        name: node.variablePath,
        datatype: node.variableType,
        initialValue: node.initialValue,
        index,
        permissions: node.permissions,
      },
    ]
  }

  const resolvedFields: ResolvedField[] = []

  for (const field of node.fields) {
    // Build the full path for this field
    const fullFieldPath = `${node.variablePath}.${field.fieldPath}`

    let debugPath: string

    if (node.pouName === 'GVL' || node.pouName === 'CONFIG') {
      // Global structure field
      debugPath = buildGlobalPath(fullFieldPath)
    } else {
      // Instance structure field
      debugPath = buildStructFieldPath(node.pouName, fullFieldPath)
    }

    // Find matching entry
    const match = debugVariables.find((dv) => dv.name.toUpperCase() === debugPath.toUpperCase())

    if (!match) {
      // Try simpler path
      const simplePath = `RES0__${node.pouName.toUpperCase()}.${fullFieldPath.toUpperCase()}`
      const simpleMatch = debugVariables.find((dv) => dv.name.toUpperCase() === simplePath.toUpperCase())

      if (simpleMatch) {
        resolvedFields.push({
          name: field.fieldPath,
          datatype: node.variableType, // Will be refined by caller
          initialValue: field.initialValue,
          index: simpleMatch.index,
          permissions: field.permissions,
        })
        continue
      }

      throw new OpcUaConfigError(
        `${node.pouName}:${fullFieldPath}`,
        debugPath,
        `Cannot resolve OPC-UA structure field index.\n` +
          `  Structure: ${node.pouName}:${node.variablePath}\n` +
          `  Field: ${field.fieldPath}\n` +
          `  Expected debug path: ${debugPath}`,
      )
    }

    resolvedFields.push({
      name: field.fieldPath,
      datatype: match.type || node.variableType,
      initialValue: field.initialValue,
      index: match.index,
      permissions: field.permissions,
    })
  }

  return resolvedFields
}

/**
 * Resolve the starting index for an array.
 * Arrays are stored sequentially, so we only need the first element's index.
 *
 * @param node - The OPC-UA node configuration for the array
 * @param debugVariables - Parsed debug variables from debug.c
 * @returns The index of the first array element
 * @throws OpcUaConfigError if the array cannot be resolved
 */
export const resolveArrayIndex = (node: OpcUaNodeConfig, debugVariables: DebugVariable[]): number => {
  let debugPath: string

  if (node.pouName === 'GVL' || node.pouName === 'CONFIG') {
    // Global array - first element
    debugPath = `CONFIG0__${node.variablePath.toUpperCase()}.value.table[0]`
  } else {
    // Instance array - first element
    debugPath = buildArrayElementPath(node.pouName, node.variablePath)
  }

  // Find matching entry
  const match = debugVariables.find((dv) => dv.name.toUpperCase() === debugPath.toUpperCase())

  if (!match) {
    // Try alternative: maybe the array path is simpler
    const simplePath = `RES0__${node.pouName.toUpperCase()}.${node.variablePath.toUpperCase()}[0]`
    const simpleMatch = debugVariables.find(
      (dv) =>
        dv.name.toUpperCase() === simplePath.toUpperCase() ||
        dv.name.toUpperCase().endsWith(`${node.variablePath.toUpperCase()}.value.table[0]`),
    )

    if (simpleMatch) {
      return simpleMatch.index
    }

    throw new OpcUaConfigError(
      `${node.pouName}:${node.variablePath}`,
      debugPath,
      `Cannot resolve OPC-UA array index.\n` +
        `  Array: ${node.pouName}:${node.variablePath}\n` +
        `  Expected debug path: ${debugPath}\n` +
        `  Looking for first element [0] of the array.`,
    )
  }

  return match.index
}
