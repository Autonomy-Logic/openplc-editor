/**
 * MatIEC-format debug path helpers — OPC-UA module only.
 *
 * The OPC-UA integration still consumes the MatIEC-style `debug.c` format
 * (flat debug_vars[] array with `RES0__` / `CONFIG0__` prefixes and
 * `.value.` field shims). Keep these helpers local to the OPC-UA module so
 * the shared debugger path (which moved to STruC++'s cleaner convention in
 * debug-variable-finder) can evolve independently.
 */

export type { DebugVariableEntry } from '../debug-parser'
import type { DebugVariableEntry } from '../debug-parser'

export interface PLCInstanceMapping {
  name: string
  program: string
}

const isArrayIndex = (part: string): boolean => /^\[\d+\]$/.test(part)

export function findInstanceName(
  pouName: string,
  instances: Array<{ name: string; program: string }>,
): string | null {
  const inst = instances.find((i) => i.program.toUpperCase() === pouName.toUpperCase())
  return inst ? inst.name : null
}

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
    debugPath += `.${pathParts[0].toUpperCase()}.value.table[${arrayIndex}]`
  } else if (isStructureField) {
    debugPath += `.${pathParts[0].toUpperCase()}`
    for (let i = 1; i < pathParts.length; i++) {
      const part = pathParts[i]
      if (isArrayIndex(part)) {
        debugPath += `.value.table${part}`
      } else {
        debugPath += `.value.${part.toUpperCase()}`
      }
    }
  } else {
    for (const part of pathParts) {
      if (isArrayIndex(part)) {
        debugPath += `.value.table${part}`
      } else {
        debugPath += `.${part.toUpperCase()}`
      }
    }
  }
  return debugPath
}

export function buildGlobalDebugPath(variablePath: string): string {
  return `CONFIG0__${variablePath.toUpperCase()}`
}

export function findDebugVariable(
  debugVariables: DebugVariableEntry[],
  expectedPath: string,
): DebugVariableEntry | null {
  const upperPath = expectedPath.toUpperCase()
  return debugVariables.find((dv) => dv.name.toUpperCase() === upperPath) || null
}

export interface DebugVariableFallbackResult {
  match: DebugVariableEntry | null
  matchedPath: string
  usedStructureStyle: boolean
}

export function findDebugVariableWithFallback(
  debugVariables: DebugVariableEntry[],
  instanceName: string,
  fieldPath: string,
): DebugVariableFallbackResult {
  const fbPath = buildDebugPath(instanceName, fieldPath, { isStructureField: false })
  const fbMatch = findDebugVariable(debugVariables, fbPath)
  if (fbMatch) {
    return { match: fbMatch, matchedPath: fbPath, usedStructureStyle: false }
  }
  const structPath = buildDebugPath(instanceName, fieldPath, { isStructureField: true })
  const structMatch = findDebugVariable(debugVariables, structPath)
  if (structMatch) {
    return { match: structMatch, matchedPath: structPath, usedStructureStyle: true }
  }
  return { match: null, matchedPath: fbPath, usedStructureStyle: false }
}
