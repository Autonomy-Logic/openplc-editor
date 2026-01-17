/**
 * Shared utilities for finding debug variable indices from debug.c
 * Used by both the debugger (renderer) and OPC-UA config generator (main).
 */

export interface DebugVariableEntry {
  /** Full path in debug.c (e.g., "RES0__INSTANCE0.MOTOR_SPEED") */
  name: string
  /** IEC type enum (e.g., "INT_ENUM", "BOOL_ENUM") */
  type: string
  /** Index in the debug_vars array */
  index: number
}

export interface PLCInstanceMapping {
  /** Instance name (e.g., "INSTANCE0") - this appears in debug.c */
  name: string
  /** Program POU name being instantiated */
  program: string
}

/**
 * Parse the debug.c file content to extract debug variables.
 * This is the canonical parser used by both debugger and OPC-UA.
 */
export function parseDebugVariables(content: string): DebugVariableEntry[] {
  const variables: DebugVariableEntry[] = []

  const debugVarsMatch = content.match(/debug_vars\[\]\s*=\s*\{([\s\S]*?)\};/)

  if (!debugVarsMatch) {
    console.warn('Could not find debug_vars[] array in debug.c')
    return []
  }

  const arrayContent = debugVarsMatch[1]
  const entryRegex = /\{\s*&\(([^)]+)\)\s*,\s*(\w+)\s*\}/g

  let match
  let index = 0

  while ((match = entryRegex.exec(arrayContent)) !== null) {
    variables.push({
      name: match[1].trim(),
      type: match[2].trim(),
      index,
    })
    index++
  }

  return variables
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
