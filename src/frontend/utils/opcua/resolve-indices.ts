import type { OpcUaFieldConfig, OpcUaNodeConfig } from '@root/middleware/shared/ports/open-plc-types'

import {
  buildDebugPath,
  buildGlobalDebugPath,
  findDebugVariable,
  findInstanceName,
  type PLCInstanceMapping,
} from './debug-paths'
import type { DebugVariable, PLCInstanceInfo, ResolvedField } from './types'

/**
 * Address of a leaf in the STruC++ debugger Entry tables. Replaces
 * the MatIEC-era flat `index: number` with the (arr, elem) tuple
 * exposed by the new debug surface (debug_dispatch.hpp).
 */
export interface LeafAddress {
  arr: number
  elem: number
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

const toInstanceMapping = (instances: PLCInstanceInfo[]): PLCInstanceMapping[] =>
  instances.map((inst) => ({ name: inst.name, program: inst.program }))

/**
 * Resolve the address for a simple variable node.
 *
 * @param node - The OPC-UA node configuration
 * @param debugVariables - Leaves parsed from debug-map.json
 * @param instances - PLC instances from Resources
 * @returns The (arr, elem) address into the debugger Entry tables
 * @throws OpcUaConfigError if the variable cannot be resolved
 */
export const resolveVariableAddress = (
  node: OpcUaNodeConfig,
  debugVariables: DebugVariable[],
  instances: PLCInstanceInfo[],
): LeafAddress => {
  const instanceMappings = toInstanceMapping(instances)

  // Globals — VAR_GLOBAL declared at the configuration level. The
  // editor flags them with the pseudo-pouName "GVL" / "CONFIG".
  if (node.pouName === 'GVL' || node.pouName === 'CONFIG' || node.pouName.toUpperCase() === 'GVL') {
    const debugPath = buildGlobalDebugPath(node.variablePath)
    const match = findDebugVariable(debugVariables, debugPath)
    if (match) return { arr: match.arr, elem: match.elem }

    throw new OpcUaConfigError(
      `${node.pouName}:${node.variablePath}`,
      debugPath,
      `Cannot resolve OPC-UA global variable address.\n` +
        `  Variable: ${node.pouName}:${node.variablePath}\n` +
        `  Expected debug path: ${debugPath}`,
    )
  }

  const instanceName = findInstanceName(node.pouName, instanceMappings)
  if (!instanceName) {
    throw new OpcUaConfigError(
      node.pouName,
      'unknown',
      `Cannot find instance for program "${node.pouName}" in Resources.\n` +
        `  Make sure the program is instantiated in the Resources configuration.`,
    )
  }

  const debugPath = buildDebugPath(instanceName, node.variablePath)
  const match = findDebugVariable(debugVariables, debugPath)
  if (match) return { arr: match.arr, elem: match.elem }

  throw new OpcUaConfigError(
    `${node.pouName}:${node.variablePath}`,
    debugPath,
    `Cannot resolve OPC-UA variable address.\n` +
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
 * Resolve a single field, recursively handling nested fields for complex types.
 */
const resolveFieldRecursively = (
  field: OpcUaFieldConfig,
  parentPath: string,
  pouName: string,
  debugVariables: DebugVariable[],
  instanceName: string | null,
): ResolvedField => {
  const fullFieldPath = `${parentPath}.${field.fieldPath}`

  // Complex type — only its leaves have addresses; the parent's own
  // (arr, elem) is meaningless.
  if (field.fields && field.fields.length > 0) {
    const nestedFields: ResolvedField[] = field.fields.map((nestedField) =>
      resolveFieldRecursively(nestedField, fullFieldPath, pouName, debugVariables, instanceName),
    )
    return {
      name: field.fieldPath,
      datatype: field.datatype || 'UNKNOWN',
      arr: null,
      elem: null,
      permissions: field.permissions,
      fields: nestedFields,
    }
  }

  // Leaf field — resolve its address.
  const debugPath =
    pouName === 'GVL' || pouName === 'CONFIG'
      ? buildGlobalDebugPath(fullFieldPath)
      : buildDebugPath(instanceName!, fullFieldPath)
  const match = findDebugVariable(debugVariables, debugPath)

  if (!match) {
    throw new OpcUaConfigError(
      `${pouName}:${fullFieldPath}`,
      debugPath,
      `Cannot resolve OPC-UA structure/FB field address.\n` +
        `  Field path: ${fullFieldPath}\n` +
        `  Expected debug path: ${debugPath}`,
    )
  }

  return {
    name: field.fieldPath,
    datatype: match.type || field.datatype || 'UNKNOWN',
    arr: match.arr,
    elem: match.elem,
    permissions: field.permissions,
  }
}

/**
 * Resolve addresses for all fields in a structure or function block instance.
 * Supports nested fields for complex types (FBs within FBs, structs within structs).
 */
export const resolveStructureAddresses = (
  node: OpcUaNodeConfig,
  debugVariables: DebugVariable[],
  instances: PLCInstanceInfo[],
): ResolvedField[] => {
  const instanceMappings = toInstanceMapping(instances)

  // No field configs — fall back to resolving the structure variable
  // itself as a single leaf (only meaningful for arrays of base types
  // disguised as "structure"; otherwise the resolver throws).
  if (!node.fields || node.fields.length === 0) {
    const addr = resolveVariableAddress(node, debugVariables, instances)
    return [
      {
        name: node.variablePath,
        datatype: node.variableType,
        arr: addr.arr,
        elem: addr.elem,
        permissions: node.permissions,
      },
    ]
  }

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

  return node.fields.map((field) =>
    resolveFieldRecursively(field, node.variablePath, node.pouName, debugVariables, instanceName),
  )
}

/**
 * Resolve the starting address for an array. Returns the (arr, elem)
 * of the first element; all subsequent elements live at
 * (arr, elem + i) within the same debug array (STruC++ guarantees
 * contiguity for arrays up to 8000 elements per
 * src/backend/debug-table-gen.ts).
 */
export const resolveArrayAddress = (
  node: OpcUaNodeConfig,
  debugVariables: DebugVariable[],
  instances: PLCInstanceInfo[],
): LeafAddress => {
  const instanceMappings = toInstanceMapping(instances)

  let debugPath: string
  if (node.pouName === 'GVL' || node.pouName === 'CONFIG') {
    debugPath = `${buildGlobalDebugPath(node.variablePath)}[0]`
  } else {
    const instanceName = findInstanceName(node.pouName, instanceMappings)
    if (!instanceName) {
      throw new OpcUaConfigError(
        node.pouName,
        'unknown',
        `Cannot find instance for program "${node.pouName}" in Resources.`,
      )
    }
    debugPath = `${buildDebugPath(instanceName, node.variablePath)}[0]`
  }

  const match = findDebugVariable(debugVariables, debugPath)
  if (match) return { arr: match.arr, elem: match.elem }

  throw new OpcUaConfigError(
    `${node.pouName}:${node.variablePath}`,
    debugPath,
    `Cannot resolve OPC-UA array address.\n` +
      `  Array: ${node.pouName}:${node.variablePath}\n` +
      `  Expected debug path: ${debugPath}\n` +
      `  Looking for first element [0] of the array.`,
  )
}
