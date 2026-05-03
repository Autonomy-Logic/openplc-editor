/**
 * OPC-UA address resolver — variables → (arr, elem) lookups.
 *
 * Reuses the debugger's shared path-matching utilities
 * (debug-variable-finder.ts) so the OPC-UA editor and the debugger
 * watch panel resolve variables identically. No OPC-UA-specific
 * path conventions, no duplicate buildDebugPath / findDebugVariable.
 *
 * Output addresses are unpacked from the debugger's packed
 * `index: number` (arrayIdx<<16 | elemIdx) into explicit (arr, elem)
 * tuples — that's the shape the runtime's strucpp_debug_* C
 * functions take, and the shape the OPC-UA plugin's per-variable
 * config carries.
 */

import type { OpcUaFieldConfig, OpcUaNodeConfig } from '@root/middleware/shared/ports/open-plc-types'

import {
  type DebugVariableEntry,
  unpackDebugAddr,
} from '../debug-parser'
import {
  buildDebugPath,
  buildGlobalDebugPath,
  findDebugVariable,
  findInstanceName,
  type PLCInstanceMapping,
} from '../debug-variable-finder'
import type { PLCInstanceInfo, ResolvedField } from './types'

/**
 * Address of a leaf in the STruC++ debugger Entry tables.
 */
export interface LeafAddress {
  arr: number
  elem: number
}

/**
 * Custom error class for OPC-UA configuration errors.
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
 * Convert a debug variable's packed index into an explicit
 * { arr, elem } tuple — the shape the OPC-UA runtime config carries
 * per variable. Mirror image of debug-parser.packDebugAddr.
 */
const addressOf = (entry: DebugVariableEntry): LeafAddress => {
  const { arrayIdx, elemIdx } = unpackDebugAddr(entry.index)
  return { arr: arrayIdx, elem: elemIdx }
}

/**
 * The debugger emits type strings with a trailing `_ENUM` suffix
 * (e.g. "INT_ENUM") — strip it for OPC-UA where IEC type names like
 * "INT" / "BOOL" / "REAL" are expected.
 */
const stripEnumSuffix = (type: string): string => {
  if (type.endsWith('_ENUM')) return type.slice(0, -5)
  return type
}

/**
 * Resolve the address for a simple variable node.
 *
 * @throws OpcUaConfigError if the variable cannot be resolved.
 */
export const resolveVariableAddress = (
  node: OpcUaNodeConfig,
  debugVariables: DebugVariableEntry[],
  instances: PLCInstanceInfo[],
): LeafAddress => {
  const instanceMappings = toInstanceMapping(instances)

  if (node.pouName === 'GVL' || node.pouName === 'CONFIG' || node.pouName.toUpperCase() === 'GVL') {
    const debugPath = buildGlobalDebugPath(node.variablePath)
    const match = findDebugVariable(debugVariables, debugPath)
    if (match) return addressOf(match)
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
  if (match) return addressOf(match)

  throw new OpcUaConfigError(
    `${node.pouName}:${node.variablePath}`,
    debugPath,
    `Cannot resolve OPC-UA variable address.\n` +
      `  Variable: ${node.pouName}:${node.variablePath}\n` +
      `  Expected debug path: ${debugPath}\n` +
      `  This may happen if the program was modified after configuring OPC-UA.`,
  )
}

/**
 * Resolve a single field, recursively handling nested fields.
 *
 * Returns null when the field path doesn't resolve in the debug map
 * (library-FB internals, renamed/deleted vars, etc.). Caller filters
 * the nulls and surfaces them as build warnings rather than aborting.
 *
 * `droppedPaths` is an out-param accumulating the unresolvable paths
 * for the build log to warn about.
 */
const resolveFieldRecursively = (
  field: OpcUaFieldConfig,
  parentPath: string,
  pouName: string,
  debugVariables: DebugVariableEntry[],
  instanceName: string | null,
  droppedPaths: string[],
): ResolvedField | null => {
  const fullFieldPath = `${parentPath}.${field.fieldPath}`

  // Complex field — recurse and filter out nulls. If every leaf
  // dropped, the parent has nothing meaningful to expose so it
  // collapses too.
  if (field.fields && field.fields.length > 0) {
    const nestedFields = field.fields
      .map((nestedField) =>
        resolveFieldRecursively(nestedField, fullFieldPath, pouName, debugVariables, instanceName, droppedPaths),
      )
      .filter((f): f is ResolvedField => f !== null)

    if (nestedFields.length === 0) {
      return null
    }

    return {
      name: field.fieldPath,
      datatype: field.datatype || 'UNKNOWN',
      arr: null,
      elem: null,
      permissions: field.permissions,
      fields: nestedFields,
    }
  }

  // Leaf field.
  const debugPath =
    pouName === 'GVL' || pouName === 'CONFIG'
      ? buildGlobalDebugPath(fullFieldPath)
      : buildDebugPath(instanceName!, fullFieldPath)
  const match = findDebugVariable(debugVariables, debugPath)

  if (!match) {
    droppedPaths.push(`${pouName}:${fullFieldPath}`)
    return null
  }

  const addr = addressOf(match)
  return {
    name: field.fieldPath,
    datatype: stripEnumSuffix(match.type) || field.datatype || 'UNKNOWN',
    arr: addr.arr,
    elem: addr.elem,
    permissions: field.permissions,
  }
}

/**
 * Resolve addresses for all fields in a structure / FB / array.
 * Field-level resolution failures accumulate into `droppedPaths`.
 */
export const resolveStructureAddresses = (
  node: OpcUaNodeConfig,
  debugVariables: DebugVariableEntry[],
  instances: PLCInstanceInfo[],
  droppedPaths: string[] = [],
): ResolvedField[] => {
  const instanceMappings = toInstanceMapping(instances)

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

  return node.fields
    .map((field) =>
      resolveFieldRecursively(
        field,
        node.variablePath,
        node.pouName,
        debugVariables,
        instanceName,
        droppedPaths,
      ),
    )
    .filter((f): f is ResolvedField => f !== null)
}

/**
 * Resolve the starting address for an array. Returns the (arr, elem)
 * of element [0]; subsequent elements live at (arr, elem + i) within
 * the same debug array (STruC++ guarantees per-array contiguity).
 */
export const resolveArrayAddress = (
  node: OpcUaNodeConfig,
  debugVariables: DebugVariableEntry[],
  instances: PLCInstanceInfo[],
): LeafAddress => {
  const instanceMappings = toInstanceMapping(instances)

  let debugPath: string
  if (node.pouName === 'GVL' || node.pouName === 'CONFIG') {
    debugPath = buildGlobalDebugPath(node.variablePath) + '[0]'
  } else {
    const instanceName = findInstanceName(node.pouName, instanceMappings)
    if (!instanceName) {
      throw new OpcUaConfigError(
        node.pouName,
        'unknown',
        `Cannot find instance for program "${node.pouName}" in Resources.`,
      )
    }
    debugPath = buildDebugPath(instanceName, node.variablePath) + '[0]'
  }

  const match = findDebugVariable(debugVariables, debugPath)
  if (match) return addressOf(match)

  throw new OpcUaConfigError(
    `${node.pouName}:${node.variablePath}`,
    debugPath,
    `Cannot resolve OPC-UA array address.\n` +
      `  Array: ${node.pouName}:${node.variablePath}\n` +
      `  Expected debug path: ${debugPath}\n` +
      `  Looking for first element [0] of the array.`,
  )
}
