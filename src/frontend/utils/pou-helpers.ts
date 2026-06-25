/**
 * Shared utilities for POU (Program Organization Unit) lookup and variable iteration.
 * Used by both the debugger and OPC-UA config generator.
 */

import type { SystemLibrary } from '../../middleware/shared/ports/library-types'
import type { PLCDataType, PLCPou } from '../../middleware/shared/ports/types'

/**
 * Variable definition from a POU or library FB.
 */
export interface PouVariable {
  name: string
  class?: string
  type: {
    definition: string
    value: string
    data?: {
      baseType: { definition: string; value: string }
      dimensions: Array<{ dimension: string }>
    }
  }
}

/**
 * Normalizes type strings for case-insensitive comparison.
 */
export const normalizeTypeString = (typeStr: string): string => {
  return typeStr.toLowerCase().replace(/[-_]/g, '')
}

/**
 * Base IEC types that are directly accessible in debug.c
 */
const BASE_TYPES = [
  'BOOL',
  'SINT',
  'INT',
  'DINT',
  'LINT',
  'USINT',
  'UINT',
  'UDINT',
  'ULINT',
  'REAL',
  'LREAL',
  'TIME',
  'DATE',
  'TOD',
  'DT',
  'STRING',
  'BYTE',
  'WORD',
  'DWORD',
  'LWORD',
  '__XWORD',
]

/**
 * Check if a type is a base IEC type.
 */
export const isBaseType = (typeName: string): boolean => {
  return BASE_TYPES.includes(typeName.toUpperCase())
}

/**
 * Variable classes that are reachable through the runtime debug surface.
 *
 * Mirrors STruC++'s debug-table-gen contract
 * (strucpp/src/backend/debug-table-gen.ts):
 *
 *  - Library FBs: only their public interface
 *    (input / output / inOut). Locals are implementation details
 *    that stay inside the compiled .stlib archive — the debugger
 *    treats library FBs as black boxes, so VAR / VAR_TEMP /
 *    VAR_EXTERNAL members of TON, R_TRIG, CTU, etc. are NOT
 *    enumerated in debug-map.json and cannot be polled or written.
 *
 *  - User-defined FBs: every persistent member
 *    (input / output / inOut / local). Excludes temp (VAR_TEMP) and
 *    external (VAR_EXTERNAL — those point at globals handled
 *    separately) since neither survives across scan cycles.
 *
 * Used by both the debugger watch panel and the OPC-UA variable
 * picker — keeps both views consistent with what the runtime can
 * actually address.
 */
const LIBRARY_FB_INTERFACE_CLASSES: ReadonlySet<string> = new Set(['input', 'output', 'inOut'])
const USER_FB_PERSISTENT_CLASSES: ReadonlySet<string> = new Set(['input', 'output', 'inOut', 'local'])

/**
 * Find a function block definition by name.
 * Searches BOTH the built-in library AND project POUs.
 * Returns the variables array from the FB definition, filtered to
 * match the debugger's variable-enumeration contract (see comment on
 * LIBRARY_FB_INTERFACE_CLASSES). Returns null if not found.
 */
export const findFunctionBlockVariables = (
  typeName: string,
  projectPous: PLCPou[],
  systemLibraries: SystemLibrary[],
): PouVariable[] | null => {
  const typeNameUpper = typeName.toUpperCase()

  // Check system library FBs across every loaded .stlib bundle —
  // interface only.  Callers thread the loaded library set down from
  // the store (or from a TraversalContext that already carries it) —
  // utils don't import the store directly so the architecture
  // validator stays clean.  We search every library because a
  // typeName may belong to standard, additional, OSCAT, or a future
  // user-installed lib; first match wins, and FB names are unique
  // across IEC libraries by convention.
  for (const lib of systemLibraries) {
    const systemFB = lib.pous.find(
      (pou) => pou.name.toUpperCase() === typeNameUpper && normalizeTypeString(pou.type) === 'functionblock',
    )
    if (systemFB) {
      return (systemFB.variables as PouVariable[]).filter((v) =>
        v.class === undefined ? false : LIBRARY_FB_INTERFACE_CLASSES.has(v.class),
      )
    }
  }

  // Check project POUs (user-defined FBs) — interface + locals,
  // dropping temp / external.
  const customFB = projectPous.find(
    (pou) => normalizeTypeString(pou.pouType) === 'functionblock' && pou.name.toUpperCase() === typeNameUpper,
  )
  if (customFB && customFB.pouType === 'function-block') {
    return ((customFB.interface?.variables ?? []) as PouVariable[]).filter((v) =>
      v.class === undefined ? true : USER_FB_PERSISTENT_CLASSES.has(v.class),
    )
  }

  return null
}

/**
 * Check if a type name is a function block (library or project).
 */
export const isFunctionBlockType = (
  typeName: string,
  projectPous: PLCPou[],
  systemLibraries: SystemLibrary[],
): boolean => {
  return findFunctionBlockVariables(typeName, projectPous, systemLibraries) !== null
}

/**
 * Find a structure definition by name in the project's data types.
 * Returns the variables array from the structure, or null if not found.
 */
export const findStructureVariables = (typeName: string, dataTypes: PLCDataType[]): PouVariable[] | null => {
  const dataType = dataTypes.find((dt) => dt.name.toLowerCase() === typeName.toLowerCase())
  if (dataType?.derivation === 'structure') {
    return dataType.variable as PouVariable[]
  }
  return null
}

/**
 * Check if a type name is a structure.
 */
export const isStructureType = (typeName: string, dataTypes: PLCDataType[]): boolean => {
  return findStructureVariables(typeName, dataTypes) !== null
}

/**
 * Check if a type name is an enumeration.
 */
export const isEnumerationType = (typeName: string, dataTypes: PLCDataType[]): boolean => {
  const dataType = dataTypes.find((dt) => dt.name.toLowerCase() === typeName.toLowerCase())
  return dataType?.derivation === 'enumerated'
}

/**
 * Represents a leaf variable (base type) found during recursive traversal.
 */
export interface LeafVariable {
  /** Relative path from the parent (e.g., "TON0.Q" or "MY_STRUCT.field1") */
  relativePath: string
  /** The base type name (e.g., "BOOL", "INT", "TIME") */
  typeName: string
}

/**
 * Recursively find all base-type leaf variables within a complex type (FB or structure).
 * This is the core shared logic for both debugger and OPC-UA.
 *
 * @param typeName - The type name to expand (e.g., "TON", "MY_CUSTOM_FB", "MY_STRUCT")
 * @param projectPous - Project POUs for looking up custom FBs
 * @param dataTypes - Project data types for looking up structures
 * @param pathPrefix - Current path prefix for building relative paths
 * @param visited - Set of already visited type names to prevent infinite recursion on circular references
 * @returns Array of leaf variables with their relative paths
 */
export const findLeafVariables = (
  typeName: string,
  projectPous: PLCPou[],
  dataTypes: PLCDataType[],
  systemLibraries: SystemLibrary[],
  pathPrefix: string = '',
  visited: Set<string> = new Set(),
): LeafVariable[] => {
  const leaves: LeafVariable[] = []
  const typeNameNormalized = typeName.toLowerCase()

  // Prevent infinite recursion on circular type references
  if (visited.has(typeNameNormalized)) {
    console.warn(`Circular type reference detected for type: ${typeName}`)
    return leaves
  }
  visited.add(typeNameNormalized)

  // Try to find as FB first
  const fbVariables = findFunctionBlockVariables(typeName, projectPous, systemLibraries)
  if (fbVariables) {
    for (const fbVar of fbVariables) {
      const varPath = pathPrefix ? `${pathPrefix}.${fbVar.name}` : fbVar.name
      const varTypeName = fbVar.type.value

      if (fbVar.type.definition === 'base-type' && isBaseType(varTypeName)) {
        leaves.push({ relativePath: varPath, typeName: varTypeName.toUpperCase() })
      } else if (fbVar.type.definition === 'array' && fbVar.type.data) {
        // For arrays, we need the first element's path - handled separately
        // Skip for now as arrays need special handling
      } else if (!isEnumerationType(varTypeName, dataTypes)) {
        // Recurse into nested FBs or structures
        const nestedLeaves = findLeafVariables(
          varTypeName,
          projectPous,
          dataTypes,
          systemLibraries,
          varPath,
          new Set(visited),
        )
        leaves.push(...nestedLeaves)
      }
    }
    return leaves
  }

  // Try to find as structure
  const structVariables = findStructureVariables(typeName, dataTypes)
  if (structVariables) {
    for (const field of structVariables) {
      const fieldPath = pathPrefix ? `${pathPrefix}.${field.name}` : field.name
      const fieldTypeName = field.type.value

      if (field.type.definition === 'base-type' && isBaseType(fieldTypeName)) {
        leaves.push({ relativePath: fieldPath, typeName: fieldTypeName.toUpperCase() })
      } else if (!isEnumerationType(fieldTypeName, dataTypes)) {
        // Recurse into nested types
        const nestedLeaves = findLeafVariables(
          fieldTypeName,
          projectPous,
          dataTypes,
          systemLibraries,
          fieldPath,
          new Set(visited),
        )
        leaves.push(...nestedLeaves)
      }
    }
    return leaves
  }

  // If it's a base type itself, return it as a leaf
  if (isBaseType(typeName)) {
    leaves.push({ relativePath: pathPrefix, typeName: typeName.toUpperCase() })
  }

  return leaves
}

/**
 * Get all variables from a POU (program or function block).
 */
export const getPouVariables = (pou: PLCPou): PouVariable[] => {
  if (pou.pouType === 'program' || pou.pouType === 'function-block') {
    return (pou.interface?.variables ?? []) as PouVariable[]
  }
  return []
}
