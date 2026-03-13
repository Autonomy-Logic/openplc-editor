/**
 * Shared utilities for finding debug variable indices from debug.c
 * Used by both the debugger (renderer) and OPC-UA config generator (main).
 */

// Re-export types and parser from canonical debug-parser module
export { type DebugVariableEntry, parseDebugVariables } from './debug-parser'

import type { DebugVariableEntry } from './debug-parser'

export interface PLCInstanceMapping {
  /** Instance name (e.g., "INSTANCE0") - this appears in debug.c */
  name: string
  /** Program POU name being instantiated */
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
 * Build the debug path for a variable.
 *
 * Path formats in debug.c:
 * - Global variable: CONFIG0__VAR_NAME
 * - Simple program variable: RES0__INSTANCE0.VAR_NAME
 * - FB instance variable: RES0__INSTANCE0.FB_INSTANCE.VAR_NAME (no .value.)
 * - Nested FB variable: RES0__INSTANCE0.FB1.FB2.VAR_NAME (no .value.)
 * - Structure field: RES0__INSTANCE0.STRUCT_VAR.value.FIELD_NAME
 * - Array element: RES0__INSTANCE0.ARRAY_VAR.value.table[i]
 * - Array of FBs field: RES0__INSTANCE0.FB_ARRAY.value.table[i].FIELD_NAME
 *
 * @param instanceName - The instance name from Resources (e.g., "INSTANCE0")
 * @param variablePath - The variable path (e.g., "MOTOR_SPEED" or "FB_INSTANCE.VAR" or "FB_ARRAY.[0].ET")
 * @param isStructureField - True if accessing a field of a user-defined structure
 * @param isArrayElement - True if accessing an array element
 * @param arrayIndex - The array index (0-based) if isArrayElement is true
 */
export function buildDebugPath(
  instanceName: string,
  variablePath: string,
  options: {
    isStructureField?: boolean
    isArrayElement?: boolean
    arrayIndex?: number
  } = {},
): string {
  const { isStructureField = false, isArrayElement = false, arrayIndex = 0 } = options

  const pathParts = variablePath.split('.')
  let debugPath = `RES0__${instanceName.toUpperCase()}`

  if (isArrayElement && pathParts.length === 1) {
    // Simple array: VAR_NAME -> RES0__INSTANCE.VAR_NAME.value.table[i]
    debugPath += `.${pathParts[0].toUpperCase()}.value.table[${arrayIndex}]`
  } else if (isStructureField) {
    // Structure field: STRUCT.FIELD -> RES0__INSTANCE.STRUCT.value.FIELD
    // First part is the struct variable name
    debugPath += `.${pathParts[0].toUpperCase()}`
    // Subsequent parts are fields, need .value. prefix (but handle array indices specially)
    for (let i = 1; i < pathParts.length; i++) {
      const part = pathParts[i]
      if (isArrayIndex(part)) {
        // Array index within structure: .value.table[i]
        debugPath += `.value.table${part}`
      } else {
        debugPath += `.value.${part.toUpperCase()}`
      }
    }
  } else {
    // Simple variable or FB instance variable: no .value. insertion
    // But handle array indices in the path: FB_ARRAY.[0].ET -> FB_ARRAY.value.table[0].ET
    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i]
      if (isArrayIndex(part)) {
        // Array index: insert .value.table before the index
        debugPath += `.value.table${part}`
      } else {
        debugPath += `.${part.toUpperCase()}`
      }
    }
  }

  return debugPath
}

/**
 * Build the debug path for a global variable.
 */
export function buildGlobalDebugPath(variablePath: string): string {
  return `CONFIG0__${variablePath.toUpperCase()}`
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
 * Result from findDebugVariableWithFallback indicating which path style worked.
 */
export interface DebugVariableFallbackResult {
  /** The matching debug variable, or null if not found */
  match: DebugVariableEntry | null
  /** The path that was used to find the match */
  matchedPath: string
  /** Whether the structure-style path (with .value.) was used */
  usedStructureStyle: boolean
}

/**
 * Find a debug variable using multiple path strategies.
 *
 * This is the CANONICAL function for resolving variable indices when the type
 * definition is ambiguous (e.g., user-data-type could be FB or struct).
 *
 * The function tries paths in this order:
 * 1. FB-style path (no .value. insertion) - for function block instances
 * 2. Structure-style path (with .value. insertion) - for user-defined structures
 *
 * Both the debugger and OPC-UA systems MUST use this function to ensure
 * consistent index resolution across the codebase.
 *
 * @param debugVariables - Parsed debug variables from debug.c
 * @param instanceName - The instance name from Resources
 * @param fieldPath - The variable path including any nested fields (e.g., "MY_FB.FIELD" or "MY_STRUCT.FIELD")
 * @returns Result indicating the match and which path style was used
 */
export function findDebugVariableWithFallback(
  debugVariables: DebugVariableEntry[],
  instanceName: string,
  fieldPath: string,
): DebugVariableFallbackResult {
  // First try FB-style path (no .value. insertion)
  const fbPath = buildDebugPath(instanceName, fieldPath, { isStructureField: false })
  const fbMatch = findDebugVariable(debugVariables, fbPath)
  if (fbMatch) {
    return { match: fbMatch, matchedPath: fbPath, usedStructureStyle: false }
  }

  // Try structure-style path (with .value. insertion)
  const structPath = buildDebugPath(instanceName, fieldPath, { isStructureField: true })
  const structMatch = findDebugVariable(debugVariables, structPath)
  if (structMatch) {
    return { match: structMatch, matchedPath: structPath, usedStructureStyle: true }
  }

  return { match: null, matchedPath: fbPath, usedStructureStyle: false }
}

/**
 * Find the index for a variable using fallback path strategies.
 *
 * This is the CANONICAL function for index lookup when the type definition
 * is ambiguous. Use this instead of findVariableIndex when you're not certain
 * whether the variable is an FB instance or a structure.
 *
 * @param instanceName - The instance name from Resources
 * @param fieldPath - The variable path
 * @param debugVariables - Parsed debug variables
 * @returns The index or null if not found
 */
export function findVariableIndexWithFallback(
  instanceName: string,
  fieldPath: string,
  debugVariables: DebugVariableEntry[],
): number | null {
  const result = findDebugVariableWithFallback(debugVariables, instanceName, fieldPath)
  return result.match ? result.match.index : null
}

/**
 * Find a debug variable for a field using fallback path strategies.
 *
 * This is used during tree traversal when we have a base path and need to
 * look up a child field. It tries both FB-style (no .value.) and struct-style
 * (with .value.) paths.
 *
 * @param debugVariables - Parsed debug variables from debug.c
 * @param basePath - The already-built base path (e.g., "RES0__INSTANCE0.MY_VAR")
 * @param fieldName - The field name to append
 * @returns Result with match and the path that worked
 */
export function findDebugVariableForField(
  debugVariables: DebugVariableEntry[],
  basePath: string,
  fieldName: string,
): DebugVariableFallbackResult {
  // Try FB-style path (no .value. insertion)
  const fbPath = `${basePath}.${fieldName.toUpperCase()}`
  const fbMatch = findDebugVariable(debugVariables, fbPath)
  if (fbMatch) {
    return { match: fbMatch, matchedPath: fbPath, usedStructureStyle: false }
  }

  // Try struct-style path (with .value. insertion)
  const structPath = `${basePath}.value.${fieldName.toUpperCase()}`
  const structMatch = findDebugVariable(debugVariables, structPath)
  if (structMatch) {
    return { match: structMatch, matchedPath: structPath, usedStructureStyle: true }
  }

  return { match: null, matchedPath: fbPath, usedStructureStyle: false }
}

/**
 * Look up an index in a map using fallback path strategies.
 *
 * This is used when you have a pre-built index map (like debugVariableIndexes)
 * and need to look up by path, trying both FB-style and struct-style paths.
 *
 * @param indexMap - A map from debug paths to indices
 * @param instanceName - The instance name from Resources
 * @param fieldPath - The variable path
 * @returns The index or undefined if not found
 */
export function getIndexFromMapWithFallback(
  indexMap: Map<string, number>,
  instanceName: string,
  fieldPath: string,
): number | undefined {
  // Try FB-style path (no .value. insertion)
  const fbPath = buildDebugPath(instanceName, fieldPath, { isStructureField: false })
  const fbIndex = indexMap.get(fbPath)
  if (fbIndex !== undefined) return fbIndex

  // Try struct-style path (with .value. insertion)
  const structPath = buildDebugPath(instanceName, fieldPath, { isStructureField: true })
  return indexMap.get(structPath)
}

/**
 * Look up an index in a map for a field, using fallback path strategies.
 *
 * This is used during polling when we have a base path and need to look up
 * a child field, trying both FB-style and struct-style paths.
 *
 * @param indexMap - A map from debug paths to indices
 * @param basePath - The already-built base path (e.g., "RES0__INSTANCE0.MY_VAR")
 * @param fieldName - The field name to append
 * @returns The index or undefined if not found
 */
export function getFieldIndexFromMapWithFallback(
  indexMap: Map<string, number>,
  basePath: string,
  fieldName: string,
): number | undefined {
  // Try FB-style path (no .value. insertion)
  const fbPath = `${basePath}.${fieldName.toUpperCase()}`
  const fbIndex = indexMap.get(fbPath)
  if (fbIndex !== undefined) return fbIndex

  // Try struct-style path (with .value. insertion)
  const structPath = `${basePath}.value.${fieldName.toUpperCase()}`
  return indexMap.get(structPath)
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
 * Returns "RES0__INSTANCE_NAME" without any variable path.
 *
 * @param instanceName - The instance name from Resources (e.g., "INSTANCE0")
 * @returns The base path prefix (e.g., "RES0__INSTANCE0")
 */
export function buildDebugPathPrefix(instanceName: string): string {
  return `RES0__${instanceName.toUpperCase()}`
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
