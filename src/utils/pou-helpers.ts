/**
 * Shared utilities for POU (Program Organization Unit) lookup and variable iteration.
 * Used by both the debugger and OPC-UA config generator.
 */

import { StandardFunctionBlocks } from '@root/renderer/data/library'
import type { PLCDataType, PLCPou } from '@root/types/PLC/open-plc'

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
  'bool',
  'sint',
  'int',
  'dint',
  'lint',
  'usint',
  'uint',
  'udint',
  'ulint',
  'real',
  'lreal',
  'time',
  'date',
  'tod',
  'dt',
  'string',
  'byte',
  'word',
  'dword',
  'lword',
]

/**
 * Check if a type is a base IEC type.
 */
export const isBaseType = (typeName: string): boolean => {
  return BASE_TYPES.includes(typeName.toLowerCase())
}

/**
 * Find a function block definition by name.
 * Searches BOTH the built-in library AND project POUs.
 * Returns the variables array from the FB definition, or null if not found.
 */
export const findFunctionBlockVariables = (typeName: string, projectPous: PLCPou[]): PouVariable[] | null => {
  const typeNameUpper = typeName.toUpperCase()

  // Check standard library FBs
  const standardFB = StandardFunctionBlocks.pous.find(
    (pou) => pou.name.toUpperCase() === typeNameUpper && normalizeTypeString(pou.type) === 'functionblock',
  )
  if (standardFB) {
    return standardFB.variables as PouVariable[]
  }

  // Check project POUs (user-defined FBs)
  const customFB = projectPous.find(
    (pou) => normalizeTypeString(pou.type) === 'functionblock' && pou.data.name.toUpperCase() === typeNameUpper,
  )
  if (customFB && customFB.type === 'function-block') {
    return customFB.data.variables as PouVariable[]
  }

  return null
}

/**
 * Check if a type name is a function block (library or project).
 */
export const isFunctionBlockType = (typeName: string, projectPous: PLCPou[]): boolean => {
  return findFunctionBlockVariables(typeName, projectPous) !== null
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
  const fbVariables = findFunctionBlockVariables(typeName, projectPous)
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
        const nestedLeaves = findLeafVariables(varTypeName, projectPous, dataTypes, varPath, new Set(visited))
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
        const nestedLeaves = findLeafVariables(fieldTypeName, projectPous, dataTypes, fieldPath, new Set(visited))
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
  if (pou.type === 'program' || pou.type === 'function-block') {
    return pou.data.variables as PouVariable[]
  }
  return []
}
