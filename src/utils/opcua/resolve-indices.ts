import type { OpcUaNodeConfig } from '@root/types/PLC/open-plc'
import {
  buildDebugPath,
  buildGlobalDebugPath,
  type DebugVariableEntry,
  findDebugVariable,
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
 * Try to find a debug variable using multiple path strategies.
 * First tries FB-style paths (no .value.), then structure-style paths (with .value.).
 * Returns the match and which style worked.
 */
const findWithFallback = (
  debugEntries: DebugVariableEntry[],
  instanceName: string,
  fullFieldPath: string,
): { match: DebugVariableEntry | null; usedStructureStyle: boolean } => {
  // First try FB-style path (no .value. insertion)
  const fbPath = buildDebugPath(instanceName, fullFieldPath, { isStructureField: false })
  const fbMatch = findDebugVariable(debugEntries, fbPath)
  if (fbMatch) {
    return { match: fbMatch, usedStructureStyle: false }
  }

  // Try structure-style path (with .value. insertion)
  const structPath = buildDebugPath(instanceName, fullFieldPath, { isStructureField: true })
  const structMatch = findDebugVariable(debugEntries, structPath)
  if (structMatch) {
    return { match: structMatch, usedStructureStyle: true }
  }

  return { match: null, usedStructureStyle: false }
}

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

  // Build the debug path - simple path for variables and FB instances (no .value.)
  const debugPath = buildDebugPath(instanceName, node.variablePath, {
    isStructureField: false,
    isArrayElement: false,
  })

  const match = findDebugVariable(debugEntries, debugPath)

  if (match) {
    return match.index
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

/**
 * Resolve indices for all fields in a structure or function block instance.
 *
 * @param node - The OPC-UA node configuration for the structure/FB
 * @param debugVariables - Parsed debug variables from debug.c
 * @param instances - Array of PLC instances from Resources configuration
 * @returns Array of resolved fields with indices
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
    // Build the full path for this field
    // Handle case where field.fieldPath already contains the parent variablePath (legacy configs)
    let fullFieldPath: string
    if (field.fieldPath.toUpperCase().startsWith(node.variablePath.toUpperCase() + '.')) {
      // Field path already includes parent, use it directly
      fullFieldPath = field.fieldPath
    } else {
      fullFieldPath = `${node.variablePath}.${field.fieldPath}`
    }

    let match: DebugVariableEntry | null = null
    let debugPath: string = ''

    if (node.pouName === 'GVL' || node.pouName === 'CONFIG') {
      // Global structure/FB field
      debugPath = buildGlobalDebugPath(fullFieldPath)
      match = findDebugVariable(debugEntries, debugPath)
    } else {
      // Try both FB-style (no .value.) and structure-style (with .value.) paths
      const result = findWithFallback(debugEntries, instanceName!, fullFieldPath)
      match = result.match
      debugPath = result.usedStructureStyle
        ? buildDebugPath(instanceName!, fullFieldPath, { isStructureField: true })
        : buildDebugPath(instanceName!, fullFieldPath, { isStructureField: false })
    }

    if (!match) {
      throw new OpcUaConfigError(
        `${node.pouName}:${fullFieldPath}`,
        debugPath,
        `Cannot resolve OPC-UA structure/FB field index.\n` +
          `  Variable: ${node.pouName}:${node.variablePath}\n` +
          `  Field: ${field.fieldPath}\n` +
          `  Tried paths:\n` +
          `    - FB style: ${buildDebugPath(instanceName!, fullFieldPath, { isStructureField: false })}\n` +
          `    - Struct style: ${buildDebugPath(instanceName!, fullFieldPath, { isStructureField: true })}`,
      )
    }

    resolvedFields.push({
      name: field.fieldPath,
      datatype: match.type ? debugTypeToIecType(match.type) : node.variableType,
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
