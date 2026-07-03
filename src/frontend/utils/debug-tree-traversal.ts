/**
 * Shared tree traversal utilities for debug variable resolution.
 *
 * This module provides a visitor-pattern based traversal for complex PLC types
 * (function blocks, structures, arrays). Both the debugger and OPC-UA systems
 * can use these utilities to traverse variable hierarchies consistently.
 */

import type { SystemLibrary } from '../../middleware/shared/ports/library-types'
import type { PLCDataType, PLCPou, PLCVariable } from '../../middleware/shared/ports/types'
import type { DebugVariableEntry } from './debug-parser'
import { buildVariableDebugPath, findDebugVariable, findDebugVariableForField } from './debug-variable-finder'
import { findFunctionBlockVariables, findStructureVariables, normalizeTypeString } from './pou-helpers'

/**
 * Pick the right type name for a leaf. The debug-map records the IEC base
 * type that STruC++ actually emits to C++ (INT for an enum, etc.), which is
 * what the wire-format parser needs. The project's type may be a user-data
 * type name like "Irrigation_State" that the parser can't decode, so prefer
 * the debug-map type whenever a match exists.
 *
 * Exported for testing; callers in other modules should go through the
 * visitor APIs defined below.
 */
export function resolveLeafType(projectType: string, debugVar: DebugVariableEntry | null): string {
  if (!debugVar?.type) return projectType
  // DebugVariableEntry.type is suffixed with `_ENUM` (legacy MatIEC encoding).
  return debugVar.type.replace(/_(O|P)_ENUM$/, '').replace(/_ENUM$/, '')
}

/**
 * If `projectType` names an enumerated data type, return its member names
 * indexed by the underlying integer value. Returns undefined for any other
 * type so callers can attach the result unconditionally.
 *
 * Exported for testing.
 */
export function lookupEnumValues(projectType: string, dataTypes: PLCDataType[]): string[] | undefined {
  const target = projectType.toUpperCase()
  for (const dt of dataTypes) {
    if (dt.name.toUpperCase() !== target) continue
    if (dt.derivation !== 'enumerated') return undefined
    return dt.values.map((v) => v.description)
  }
  return undefined
}

/**
 * Context for tree traversal containing all necessary lookup data.
 */
export interface TraversalContext {
  /** Parsed debug variables from debug.c */
  debugVariables: DebugVariableEntry[]
  /** Project POUs for FB lookup */
  projectPous: PLCPou[]
  /** Project data types for struct lookup */
  dataTypes: PLCDataType[]
  /** Loaded system libraries (bundled + user-installed) — passed in
   *  by the caller so this utility module doesn't import the store
   *  directly (arch validator forbids utils → store). */
  systemLibraries: SystemLibrary[]
  /** Instance name from Resources configuration */
  instanceName: string
  /** POU name for composite key generation */
  pouName: string
}

/**
 * Visitor interface for handling different node types during traversal.
 * Implement this interface to produce custom output from tree traversal.
 */
export interface DebugNodeVisitor<T> {
  /**
   * Called for leaf nodes (base types that have a debug index).
   *
   * `enumValues` is set when the variable's project type is an enumerated
   * data type. The wire still carries the underlying INT — consumers map
   * the integer to `enumValues[i]` for display and reverse-map for force.
   */
  visitLeaf(
    name: string,
    fullPath: string,
    compositeKey: string,
    typeName: string,
    debugIndex: number | undefined,
    enumValues?: string[],
  ): T

  /**
   * Called for complex nodes (FBs, structs) with children.
   */
  visitComplex(name: string, fullPath: string, compositeKey: string, typeName: string, children: T[]): T

  /**
   * Called for array nodes with indexed children.
   */
  visitArray(
    name: string,
    fullPath: string,
    compositeKey: string,
    elementTypeName: string,
    arrayIndices: [number, number],
    children: T[],
  ): T
}

/**
 * Array data structure from PLCVariable type definition.
 */
interface ArrayTypeData {
  baseType: { definition: 'base-type' | 'user-data-type'; value: string }
  dimensions: Array<{ dimension: string }>
}

/**
 * Check if a type is a function block (standard library or custom).
 */
function isFunctionBlock(typeName: string, projectPous: PLCPou[], systemLibraries: SystemLibrary[]): boolean {
  const typeNameUpper = typeName.toUpperCase()

  // Check every system library loaded from bundled .stlib archives
  // (standard FBs, additional FBs, OSCAT, std-functions, plus any
  // future user-installed library).  Libraries are passed in via
  // TraversalContext rather than read from the store so this utility
  // module stays store-free (arch validator forbids utils → store).
  // FB names are globally unique across IEC libraries by convention,
  // so first match wins.
  for (const lib of systemLibraries) {
    const matched = lib.pous.some(
      (pou) => pou.name.toUpperCase() === typeNameUpper && normalizeTypeString(pou.type) === 'functionblock',
    )
    if (matched) return true
  }

  // Check custom FBs
  return projectPous.some(
    (pou) => normalizeTypeString(pou.pouType) === 'functionblock' && pou.name.toUpperCase() === typeNameUpper,
  )
}

/**
 * Parse array dimension string (e.g., "1..10" or "-5..5") into start and end indices.
 * IEC 61131-3 allows negative array indices.
 */
function parseArrayDimension(dimension: string): [number, number] | null {
  const match = dimension.match(/^(-?\d+)\.\.(-?\d+)$/)
  if (!match) return null
  return [parseInt(match[1], 10), parseInt(match[2], 10)]
}

/**
 * Traverse a nested node (used recursively for FB fields, struct fields, array elements).
 */
function traverseNestedNode<T>(
  name: string,
  fullPath: string,
  compositeKey: string,
  typeName: string,
  typeDefinition: 'derived' | 'user-data-type' | 'array',
  context: TraversalContext,
  visitor: DebugNodeVisitor<T>,
  arrayData?: ArrayTypeData,
): T {
  const { debugVariables, projectPous, dataTypes, systemLibraries } = context

  if (typeDefinition === 'derived') {
    // Function block type
    const fbVariables = findFunctionBlockVariables(typeName, projectPous, systemLibraries)

    if (!fbVariables) {
      // FB definition not found - treat as leaf
      const debugVar = findDebugVariable(debugVariables, fullPath)
      return visitor.visitLeaf(
        name,
        fullPath,
        compositeKey,
        resolveLeafType(typeName, debugVar),
        debugVar?.index,
        lookupEnumValues(typeName, dataTypes),
      )
    }

    const children: T[] = []

    for (const fbVar of fbVariables) {
      const childCompositeKey = `${compositeKey}.${fbVar.name}`

      if (fbVar.type.definition === 'base-type') {
        // Use fallback to try both FB-style and struct-style paths
        // This ensures consistent behavior with OPC-UA index resolution
        const result = findDebugVariableForField(debugVariables, fullPath, fbVar.name)
        children.push(
          visitor.visitLeaf(
            fbVar.name,
            result.matchedPath,
            childCompositeKey,
            fbVar.type.value.toUpperCase(),
            result.match?.index,
          ),
        )
      } else {
        // For non-base-types, build the child path for recursive traversal
        const childFullPath = `${fullPath}.${fbVar.name.toUpperCase()}`

        if (fbVar.type.definition === 'derived' || fbVar.type.definition === 'derived-type') {
          children.push(
            traverseNestedNode(
              fbVar.name,
              childFullPath,
              childCompositeKey,
              fbVar.type.value,
              'derived',
              context,
              visitor,
            ),
          )
        } else if (fbVar.type.definition === 'user-data-type') {
          // Could be FB or struct - check
          const childTypeDef = isFunctionBlock(fbVar.type.value, projectPous, systemLibraries)
            ? 'derived'
            : 'user-data-type'
          children.push(
            traverseNestedNode(
              fbVar.name,
              childFullPath,
              childCompositeKey,
              fbVar.type.value,
              childTypeDef,
              context,
              visitor,
            ),
          )
        } else if (fbVar.type.definition === 'array' && fbVar.type.data) {
          children.push(
            traverseNestedNode(
              fbVar.name,
              childFullPath,
              childCompositeKey,
              'ARRAY',
              'array',
              context,
              visitor,
              fbVar.type.data as ArrayTypeData,
            ),
          )
        }
      }
    }

    return visitor.visitComplex(name, fullPath, compositeKey, typeName, children)
  } else if (typeDefinition === 'user-data-type') {
    // Structure type — STruC++ emits struct fields as `PARENT.FIELD`
    // (same convention as FB fields), no `.value.` shim.
    const structVariables = findStructureVariables(typeName, dataTypes)

    if (!structVariables) {
      const debugVar = findDebugVariable(debugVariables, fullPath)
      return visitor.visitLeaf(
        name,
        fullPath,
        compositeKey,
        resolveLeafType(typeName, debugVar),
        debugVar?.index,
        lookupEnumValues(typeName, dataTypes),
      )
    }

    const children: T[] = []

    for (const field of structVariables) {
      const fieldFullPath = `${fullPath}.${field.name.toUpperCase()}`
      const fieldCompositeKey = `${compositeKey}.${field.name}`

      if (field.type.definition === 'base-type') {
        const debugVar = findDebugVariable(debugVariables, fieldFullPath)
        children.push(
          visitor.visitLeaf(
            field.name,
            fieldFullPath,
            fieldCompositeKey,
            field.type.value.toUpperCase(),
            debugVar?.index,
          ),
        )
      } else if (field.type.definition === 'user-data-type') {
        const childTypeDef = isFunctionBlock(field.type.value, projectPous, systemLibraries)
          ? 'derived'
          : 'user-data-type'
        children.push(
          traverseNestedNode(
            field.name,
            fieldFullPath,
            fieldCompositeKey,
            field.type.value,
            childTypeDef,
            context,
            visitor,
          ),
        )
      } else if (field.type.definition === 'array' && field.type.data) {
        children.push(
          traverseNestedNode(
            field.name,
            fieldFullPath,
            fieldCompositeKey,
            'ARRAY',
            'array',
            context,
            visitor,
            field.type.data as ArrayTypeData,
          ),
        )
      }
    }

    return visitor.visitComplex(name, fullPath, compositeKey, typeName, children)
  } else if (typeDefinition === 'array' && arrayData) {
    // Array type — STruC++ emits array elements as `PARENT[iec_idx]` using
    // IEC-based indexing (the start of the declared range, not 0).
    const dimensions = arrayData.dimensions
    if (dimensions.length === 0) {
      return visitor.visitLeaf(name, fullPath, compositeKey, 'ARRAY', undefined)
    }

    const indices = parseArrayDimension(dimensions[0].dimension)
    if (!indices) {
      return visitor.visitLeaf(name, fullPath, compositeKey, 'ARRAY', undefined)
    }

    const [startIndex, endIndex] = indices
    const arraySize = endIndex - startIndex + 1
    const baseType = arrayData.baseType
    const elementTypeName = baseType.definition === 'base-type' ? baseType.value.toUpperCase() : baseType.value

    const children: T[] = []

    for (let i = 0; i < arraySize; i++) {
      const elementIndex = startIndex + i
      const elementFullPath = `${fullPath}[${elementIndex}]`
      const elementCompositeKey = `${compositeKey}[${elementIndex}]`

      if (baseType.definition === 'base-type') {
        const debugVar = findDebugVariable(debugVariables, elementFullPath)
        children.push(
          visitor.visitLeaf(
            `[${elementIndex}]`,
            elementFullPath,
            elementCompositeKey,
            elementTypeName,
            debugVar?.index,
          ),
        )
      } else if (baseType.definition === 'user-data-type') {
        // Array of complex elements — could be FB instances or structs.
        // The PLCVariableType.data.baseType union only allows
        // 'base-type' | 'user-data-type' (see middleware/.../types.ts),
        // so 'user-data-type' is the single entry point for both shapes;
        // disambiguate by name lookup against the project's POUs.
        const childTypeDef = isFunctionBlock(baseType.value, projectPous, systemLibraries)
          ? 'derived'
          : 'user-data-type'
        children.push(
          traverseNestedNode(
            `[${elementIndex}]`,
            elementFullPath,
            elementCompositeKey,
            baseType.value,
            childTypeDef,
            context,
            visitor,
          ),
        )
      }
    }

    return visitor.visitArray(name, fullPath, compositeKey, elementTypeName, [startIndex, endIndex], children)
  }

  // Unknown type - treat as leaf
  const debugVar = findDebugVariable(debugVariables, fullPath)
  return visitor.visitLeaf(
    name,
    fullPath,
    compositeKey,
    resolveLeafType(typeName, debugVar),
    debugVar?.index,
    lookupEnumValues(typeName, dataTypes),
  )
}

/**
 * Traverse a PLC variable and its nested structure using the visitor pattern.
 *
 * @param variable - The PLC variable to traverse
 * @param context - Traversal context with lookup data
 * @param visitor - Visitor implementation for handling nodes
 * @returns The result produced by the visitor
 */
export function traverseVariable<T>(variable: PLCVariable, context: TraversalContext, visitor: DebugNodeVisitor<T>): T {
  const { debugVariables, projectPous, pouName, instanceName, systemLibraries } = context
  const compositeKey = `${pouName}:${variable.name}`

  // Build the base path (single rule — see buildVariableDebugPath)
  const fullPath = buildVariableDebugPath(variable.class === 'external', instanceName, variable.name)

  if (variable.type.definition === 'base-type') {
    const baseType = variable.type.value.toUpperCase()
    const debugVar = findDebugVariable(debugVariables, fullPath)
    return visitor.visitLeaf(
      variable.name,
      fullPath,
      compositeKey,
      resolveLeafType(baseType, debugVar),
      debugVar?.index,
    )
  } else if (variable.type.definition === 'derived') {
    return traverseNestedNode(variable.name, fullPath, compositeKey, variable.type.value, 'derived', context, visitor)
  } else if (variable.type.definition === 'array') {
    return traverseNestedNode(
      variable.name,
      fullPath,
      compositeKey,
      'ARRAY',
      'array',
      context,
      visitor,
      variable.type.data as ArrayTypeData,
    )
  } else if (variable.type.definition === 'user-data-type') {
    // Could be FB or struct
    const typeDef = isFunctionBlock(variable.type.value, projectPous, systemLibraries) ? 'derived' : 'user-data-type'
    return traverseNestedNode(variable.name, fullPath, compositeKey, variable.type.value, typeDef, context, visitor)
  }

  // Unknown type
  return visitor.visitLeaf(variable.name, fullPath, compositeKey, 'UNKNOWN', undefined)
}

/**
 * Traverse a nested type starting from a given path (for internal FB/struct traversal).
 * Useful when you already have the base path and need to traverse children.
 */
export function traverseNestedType<T>(
  name: string,
  basePath: string,
  baseCompositeKey: string,
  typeName: string,
  typeDefinition: 'derived' | 'user-data-type' | 'array',
  context: TraversalContext,
  visitor: DebugNodeVisitor<T>,
  arrayData?: ArrayTypeData,
): T {
  return traverseNestedNode(name, basePath, baseCompositeKey, typeName, typeDefinition, context, visitor, arrayData)
}
