import type { OpcUaFieldConfig, OpcUaNodeConfig } from '@root/types/PLC/open-plc'
import {
  buildDebugPath,
  buildGlobalDebugPath,
  type DebugVariableEntry,
  findDebugVariable,
  findDebugVariableWithFallback,
  findInstanceName,
  type PLCInstanceMapping,
} from '@root/utils/debug-variable-finder'

import type { DebugVariable, PLCInstanceInfo, ResolvedField } from './types'

/**
 * Convert debug.c type enum to IEC type name.
 * debug.c uses types like "INT_ENUM", "BOOL_ENUM", "REAL_ENUM"
 * but the OPC-UA runtime expects "INT", "BOOL", "REAL".
 */
const debugTypeToIecType = (debugType: string): string => {
  // Remove _ENUM suffix if present
  if (debugType.endsWith('_ENUM')) {
    return debugType.slice(0, -5)
  }
  // Remove _P_ENUM or _O_ENUM suffix for pointer/output types
  if (debugType.endsWith('_P_ENUM') || debugType.endsWith('_O_ENUM')) {
    return debugType.slice(0, -7)
  }
  return debugType
}

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
 * Convert PLCInstanceInfo to PLCInstanceMapping for the shared utility
 */
const toInstanceMapping = (instances: PLCInstanceInfo[]): PLCInstanceMapping[] =>
  instances.map((inst) => ({ name: inst.name, program: inst.program }))

/**
 * Convert DebugVariable to DebugVariableEntry for the shared utility
 */
const toDebugEntries = (debugVariables: DebugVariable[]): DebugVariableEntry[] =>
  debugVariables.map((dv) => ({ name: dv.name, type: dv.type, index: dv.index }))

/**
 * Resolve the index for a simple variable node.
 *
 * @param node - The OPC-UA node configuration
 * @param debugVariables - Parsed debug variables from debug.c
 * @param instances - Array of PLC instances from Resources configuration
 * @returns The resolved index
 * @throws OpcUaConfigError if the variable cannot be resolved
 */
export const resolveVariableIndex = (
  node: OpcUaNodeConfig,
  debugVariables: DebugVariable[],
  instances: PLCInstanceInfo[],
): number => {
  const debugEntries = toDebugEntries(debugVariables)
  const instanceMappings = toInstanceMapping(instances)

  // Handle global variables
  if (node.pouName === 'GVL' || node.pouName === 'CONFIG' || node.pouName.toUpperCase() === 'GVL') {
    const debugPath = buildGlobalDebugPath(node.variablePath)
    const match = findDebugVariable(debugEntries, debugPath)

    if (match) {
      return match.index
    }

    throw new OpcUaConfigError(
      `${node.pouName}:${node.variablePath}`,
      debugPath,
      `Cannot resolve OPC-UA global variable index.\n` +
        `  Variable: ${node.pouName}:${node.variablePath}\n` +
        `  Expected debug path: ${debugPath}`,
    )
  }

  // Look up the instance name for this program
  const instanceName = findInstanceName(node.pouName, instanceMappings)

  if (!instanceName) {
    throw new OpcUaConfigError(
      node.pouName,
      'unknown',
      `Cannot find instance for program "${node.pouName}" in Resources.\n` +
        `  Make sure the program is instantiated in the Resources configuration.`,
    )
  }

  // Use shared fallback function - tries FB-style first, then struct-style
  const result = findDebugVariableWithFallback(debugEntries, instanceName, node.variablePath)

  if (result.match) {
    return result.match.index
  }

  throw new OpcUaConfigError(
    `${node.pouName}:${node.variablePath}`,
    result.matchedPath,
    `Cannot resolve OPC-UA variable index.\n` +
      `  Variable: ${node.pouName}:${node.variablePath}\n` +
      `  Tried paths:\n` +
      `    - FB style: ${buildDebugPath(instanceName, node.variablePath, { isStructureField: false })}\n` +
      `    - Struct style: ${buildDebugPath(instanceName, node.variablePath, { isStructureField: true })}\n` +
      `  This may happen if:\n` +
      `    - The PLC program was modified after configuring OPC-UA\n` +
      `    - The variable name is incorrect\n` +
      `    - The variable was removed from the program\n` +
      `  Please verify the variable exists in the program.`,
  )
}

/**
 * Resolve a single field, recursively handling nested fields for complex types.
 *
 * @param field - The field configuration
 * @param parentPath - The full path to the parent (e.g., "IRRIGATION_MAIN_CONTROLLER0")
 * @param pouName - The POU name (e.g., "MAIN" or "GVL")
 * @param debugEntries - Converted debug variable entries
 * @param instanceName - Instance name (null for global variables)
 * @returns Resolved field with index and possibly nested fields
 */
const resolveFieldRecursively = (
  field: OpcUaFieldConfig,
  parentPath: string,
  pouName: string,
  debugEntries: DebugVariableEntry[],
  instanceName: string | null,
): ResolvedField => {
  // Build the full path for this field.
  // Note: This code path only processes new hierarchical configs where field.fieldPath
  // contains just the field name (e.g., "TON0", "IN"). Legacy flat configs don't have
  // nested `fields` arrays, so they won't reach this recursive function.
  const fullFieldPath = `${parentPath}.${field.fieldPath}`

  // If this field has nested fields, it's a complex type (FB or struct)
  if (field.fields && field.fields.length > 0) {
    // Recursively resolve nested fields
    const nestedFields: ResolvedField[] = []
    for (const nestedField of field.fields) {
      nestedFields.push(resolveFieldRecursively(nestedField, fullFieldPath, pouName, debugEntries, instanceName))
    }

    // Complex types have null index - only leaf fields have indices
    return {
      name: field.fieldPath,
      datatype: field.datatype || 'UNKNOWN',
      initialValue: field.initialValue,
      index: null,
      permissions: field.permissions,
      fields: nestedFields,
    }
  }

  // This is a leaf field - resolve its index
  let match: DebugVariableEntry | null = null
  let debugPath: string = ''

  if (pouName === 'GVL' || pouName === 'CONFIG') {
    // Global structure/FB field
    debugPath = buildGlobalDebugPath(fullFieldPath)
    match = findDebugVariable(debugEntries, debugPath)
  } else {
    // Use shared fallback function - tries FB-style first, then struct-style
    const result = findDebugVariableWithFallback(debugEntries, instanceName!, fullFieldPath)
    match = result.match
    debugPath = result.matchedPath
  }

  if (!match) {
    throw new OpcUaConfigError(
      `${pouName}:${fullFieldPath}`,
      debugPath,
      `Cannot resolve OPC-UA structure/FB field index.\n` +
        `  Field path: ${fullFieldPath}\n` +
        `  Tried paths:\n` +
        `    - FB style: ${buildDebugPath(instanceName!, fullFieldPath, { isStructureField: false })}\n` +
        `    - Struct style: ${buildDebugPath(instanceName!, fullFieldPath, { isStructureField: true })}`,
    )
  }

  return {
    name: field.fieldPath,
    datatype: match.type ? debugTypeToIecType(match.type) : field.datatype || 'UNKNOWN',
    initialValue: field.initialValue,
    index: match.index,
    permissions: field.permissions,
  }
}

/**
 * Resolve indices for all fields in a structure or function block instance.
 * Supports nested fields for complex types (FBs within FBs, structs within structs).
 *
 * @param node - The OPC-UA node configuration for the structure/FB
 * @param debugVariables - Parsed debug variables from debug.c
 * @param instances - Array of PLC instances from Resources configuration
 * @returns Array of resolved fields with indices (may be hierarchical)
 * @throws OpcUaConfigError if any field cannot be resolved
 */
export const resolveStructureIndices = (
  node: OpcUaNodeConfig,
  debugVariables: DebugVariable[],
  instances: PLCInstanceInfo[],
): ResolvedField[] => {
  const debugEntries = toDebugEntries(debugVariables)
  const instanceMappings = toInstanceMapping(instances)

  if (!node.fields || node.fields.length === 0) {
    // If no field configs, try to resolve the structure variable itself
    const index = resolveVariableIndex(node, debugVariables, instances)
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

  // Look up the instance name for this program
  let instanceName: string | null = null
  if (node.pouName !== 'GVL' && node.pouName !== 'CONFIG') {
    instanceName = findInstanceName(node.pouName, instanceMappings)
    if (!instanceName) {
      throw new OpcUaConfigError(
        node.pouName,
        'unknown',
        `Cannot find instance for program "${node.pouName}" in Resources.`,
      )
    }
  }

  const resolvedFields: ResolvedField[] = []

  for (const field of node.fields) {
    resolvedFields.push(resolveFieldRecursively(field, node.variablePath, node.pouName, debugEntries, instanceName))
  }

  return resolvedFields
}

/**
 * Resolve the starting index for an array.
 * Arrays are stored sequentially, so we only need the first element's index.
 *
 * @param node - The OPC-UA node configuration for the array
 * @param debugVariables - Parsed debug variables from debug.c
 * @param instances - Array of PLC instances from Resources configuration
 * @returns The index of the first array element
 * @throws OpcUaConfigError if the array cannot be resolved
 */
export const resolveArrayIndex = (
  node: OpcUaNodeConfig,
  debugVariables: DebugVariable[],
  instances: PLCInstanceInfo[],
): number => {
  const debugEntries = toDebugEntries(debugVariables)
  const instanceMappings = toInstanceMapping(instances)

  let debugPath: string

  if (node.pouName === 'GVL' || node.pouName === 'CONFIG') {
    // Global array - first element: CONFIG0__VAR.value.table[0]
    debugPath = `${buildGlobalDebugPath(node.variablePath)}.value.table[0]`
  } else {
    // Look up the instance name for this program
    const instanceName = findInstanceName(node.pouName, instanceMappings)

    if (!instanceName) {
      throw new OpcUaConfigError(
        node.pouName,
        'unknown',
        `Cannot find instance for program "${node.pouName}" in Resources.`,
      )
    }

    // Instance array - first element
    debugPath = buildDebugPath(instanceName, node.variablePath, {
      isArrayElement: true,
      arrayIndex: 0,
    })
  }

  const match = findDebugVariable(debugEntries, debugPath)

  if (match) {
    return match.index
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
