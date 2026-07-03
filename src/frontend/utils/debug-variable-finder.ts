/**
 * Shared utilities for finding variables in a DebugVariableEntry[] list
 * (produced by debugMapToEntries from a debug-map.json).
 */

export { type DebugVariableEntry } from './debug-parser'

import type { DebugVariableEntry } from './debug-parser'

export interface PLCInstanceMapping {
  /** Instance name (e.g., "INSTANCE0"). Appears at the root of every path
   *  emitted by STruC++ into debug-map.json. */
  name: string
  /** Program POU name being instantiated. */
  program: string
}

/**
 * Find the instance name for a program POU from the instances mapping.
 *
 * @param pouName - Name of the program POU
 * @param instances - Array of PLC instances from Resources
 * @returns The instance name or null if not found
 */
export function findInstanceName(pouName: string, instances: PLCInstanceMapping[]): string | null {
  const instance = instances.find((inst) => inst.program.toUpperCase() === pouName.toUpperCase())
  return instance ? instance.name : null
}

/**
 * Check if a path part is an array index (e.g., "[0]", "[1]", etc.)
 */
const isArrayIndex = (part: string): boolean => {
  return /^\[\d+\]$/.test(part)
}

/**
 * Build the debug path for a variable, matching the convention STruC++
 * emits into debug-map.json:
 *
 *   Simple program variable:  INSTANCE0.VAR_NAME
 *   FB field:                 INSTANCE0.FB_INSTANCE.FIELD
 *   Nested FB field:          INSTANCE0.FB1.FB2.VAR_NAME
 *   Struct field:             INSTANCE0.STRUCT.FIELD
 *   Array element:            INSTANCE0.ARR[5]
 *   Array of FBs field:       INSTANCE0.FB_ARR[0].FIELD
 *
 * Paths are uppercased end-to-end; callers must pass identifiers in whichever
 * case they have them.
 *
 * @param instanceName - Instance name from Resources (e.g., "INSTANCE0")
 * @param variablePath - Variable path (e.g., "BLINK", "FB.Q", "ARR.[0].ET")
 * @param isArrayElement - True when resolving a specific array element
 * @param arrayIndex - IEC-indexed array element (respecting the bounds' lower)
 */
export function buildDebugPath(
  instanceName: string,
  variablePath: string,
  options: {
    /** Kept for compatibility with the old signature; STruC++'s path format
     *  doesn't distinguish struct vs. FB-field — both are `.FIELD`. */
    isStructureField?: boolean
    isArrayElement?: boolean
    arrayIndex?: number
  } = {},
): string {
  const { isArrayElement = false, arrayIndex = 0 } = options

  const pathParts = variablePath.split('.')
  let debugPath = instanceName.toUpperCase()

  if (isArrayElement && pathParts.length === 1) {
    debugPath += `.${pathParts[0].toUpperCase()}[${arrayIndex}]`
    return debugPath
  }

  for (const part of pathParts) {
    if (isArrayIndex(part)) {
      debugPath += part
    } else {
      debugPath += `.${part.toUpperCase()}`
    }
  }

  return debugPath
}

/**
 * Build the debug path for a global variable. STruC++ emits CONFIGURATION
 * VAR_GLOBALs into debug-map.json under their bare (unprefixed) uppercase name,
 * so a VAR_EXTERNAL reference resolves to the same address from every program.
 */
export function buildGlobalDebugPath(variablePath: string): string {
  return variablePath.toUpperCase()
}

/**
 * The single path rule for a program variable: a shared global (VAR_EXTERNAL →
 * CONFIGURATION VAR_GLOBAL) addresses by its bare name; everything else is
 * instance-prefixed. Both the tree traversal and the base-path shim resolve
 * through here so the "is this a global?" decision (and thus the address) can't
 * drift between them. OPC-UA reaches the same two primitives but derives
 * global-ness from its own node model (pouName GVL/CONFIG), not variable class.
 */
export function buildVariableDebugPath(isGlobal: boolean, instanceName: string, variableName: string): string {
  return isGlobal ? buildGlobalDebugPath(variableName) : buildDebugPath(instanceName, variableName)
}

/**
 * Find a debug variable by its expected path (case-insensitive).
 *
 * @param debugVariables - Parsed debug variables from debug.c
 * @param expectedPath - The expected debug path
 * @returns The matching debug variable or null
 */
export function findDebugVariable(
  debugVariables: DebugVariableEntry[],
  expectedPath: string,
): DebugVariableEntry | null {
  const upperPath = expectedPath.toUpperCase()
  return debugVariables.find((dv) => dv.name.toUpperCase() === upperPath) || null
}

/**
 * Lookup result for variable-finding helpers. The `usedStructureStyle` field
 * is kept for API compatibility (always false — STruC++ uses a single path
 * convention for both struct and FB fields).
 */
export interface DebugVariableFallbackResult {
  match: DebugVariableEntry | null
  matchedPath: string
  usedStructureStyle: boolean
}

/**
 * Find a debug variable by instance + variable path.
 * STruC++ uses a single path format (no .value./struct vs FB distinction),
 * so there's no longer a need for multi-strategy fallback.
 */
export function findDebugVariableWithFallback(
  debugVariables: DebugVariableEntry[],
  instanceName: string,
  fieldPath: string,
): DebugVariableFallbackResult {
  const path = buildDebugPath(instanceName, fieldPath)
  const match = findDebugVariable(debugVariables, path)
  return { match, matchedPath: path, usedStructureStyle: false }
}

/** Convenience: just the index, null when not found. */
export function findVariableIndexWithFallback(
  instanceName: string,
  fieldPath: string,
  debugVariables: DebugVariableEntry[],
): number | null {
  const result = findDebugVariableWithFallback(debugVariables, instanceName, fieldPath)
  return result.match ? result.match.index : null
}

/** Append a child field to a base path (used during tree traversal). */
export function findDebugVariableForField(
  debugVariables: DebugVariableEntry[],
  basePath: string,
  fieldName: string,
): DebugVariableFallbackResult {
  const path = `${basePath}.${fieldName.toUpperCase()}`
  const match = findDebugVariable(debugVariables, path)
  return { match, matchedPath: path, usedStructureStyle: false }
}

/** Map lookup by instance + variable path. */
export function getIndexFromMapWithFallback(
  indexMap: Map<string, number>,
  instanceName: string,
  fieldPath: string,
): number | undefined {
  return indexMap.get(buildDebugPath(instanceName, fieldPath))
}

/** Map lookup by base path + child field. */
export function getFieldIndexFromMapWithFallback(
  indexMap: Map<string, number>,
  basePath: string,
  fieldName: string,
): number | undefined {
  return indexMap.get(`${basePath}.${fieldName.toUpperCase()}`)
}

/**
 * Find the index for a program/FB variable.
 *
 * @param instanceName - The instance name from Resources
 * @param variablePath - The variable path (e.g., "MOTOR_SPEED" or "TIMER0.Q")
 * @param debugVariables - Parsed debug variables
 * @param options - Options for structure fields and array elements
 * @returns The index or null if not found
 */
export function findVariableIndex(
  instanceName: string,
  variablePath: string,
  debugVariables: DebugVariableEntry[],
  options: {
    isStructureField?: boolean
    isArrayElement?: boolean
    arrayIndex?: number
  } = {},
): number | null {
  const debugPath = buildDebugPath(instanceName, variablePath, options)
  const match = findDebugVariable(debugVariables, debugPath)
  return match ? match.index : null
}

/**
 * Find the index for a global variable.
 *
 * @param variablePath - The global variable path
 * @param debugVariables - Parsed debug variables
 * @returns The index or null if not found
 */
export function findGlobalVariableIndex(variablePath: string, debugVariables: DebugVariableEntry[]): number | null {
  const debugPath = buildGlobalDebugPath(variablePath)
  const match = findDebugVariable(debugVariables, debugPath)
  return match ? match.index : null
}

/**
 * Build the base debug path prefix for an instance.
 * Returns the uppercased instance name — matches STruC++'s path convention.
 */
export function buildDebugPathPrefix(instanceName: string): string {
  return instanceName.toUpperCase()
}

/**
 * Append a child name to an existing debug path.
 * Handles the uppercase conversion automatically.
 *
 * @param basePath - The existing debug path (e.g., "RES0__INSTANCE0.FB_NAME")
 * @param childName - The child variable/field name to append
 * @returns The extended path (e.g., "RES0__INSTANCE0.FB_NAME.CHILD_NAME")
 */
export function appendToDebugPath(basePath: string, childName: string): string {
  return `${basePath}.${childName.toUpperCase()}`
}
