/**
 * Shared tree traversal utilities for debug variable resolution.
 *
 * This module provides a visitor-pattern based traversal for complex PLC types
 * (function blocks, structures, arrays). Both the debugger and OPC-UA systems
 * can use these utilities to traverse variable hierarchies consistently.
 */

import type { PLCDataType, PLCPou, PLCVariable } from '@root/types/PLC/open-plc'
import { parseDimensionRange } from '@root/utils/PLC/array-variable-utils'

import type { DebugVariableEntry } from './debug-parser'
import {
  buildDebugPath,
  buildGlobalDebugPath,
  findDebugVariable,
  findDebugVariableForField,
} from './debug-variable-finder'
import { findFunctionBlockVariables, findStructureVariables, normalizeTypeString } from './pou-helpers'

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
   */
  visitLeaf(name: string, fullPath: string, compositeKey: string, typeName: string, debugIndex: number | undefined): T

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
function isFunctionBlock(typeName: string, projectPous: PLCPou[]): boolean {
  const typeNameUpper = typeName.toUpperCase()

  // Check standard library - import dynamically to avoid circular deps in main process
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const module = require('@root/renderer/data/library/standard-function-blocks') as {
      StandardFunctionBlocks: { pous: Array<{ name: string; type: string }> }
    }
    const isStandard = module.StandardFunctionBlocks.pous.some(
      (pou) => pou.name.toUpperCase() === typeNameUpper && normalizeTypeString(pou.type) === 'functionblock',
    )
    if (isStandard) return true
  } catch {
    // StandardFunctionBlocks not available in main process
  }

  // Check custom FBs
  return projectPous.some(
    (pou) => normalizeTypeString(pou.type) === 'functionblock' && pou.data.name.toUpperCase() === typeNameUpper,
  )
}

/**
 * Parse array dimension string (e.g., "1..10" or "-5..5") into start and end indices.
 * Delegates to the shared parseDimensionRange utility.
 */
function parseArrayDimension(dimension: string): [number, number] | null {
  const range = parseDimensionRange(dimension)
  if (!range) return null
  return [range.lower, range.upper]
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
  const { debugVariables, projectPous, dataTypes } = context

  if (typeDefinition === 'derived') {
    // Function block type
    const fbVariables = findFunctionBlockVariables(typeName, projectPous)

    if (!fbVariables) {
      // FB definition not found - treat as leaf
      const debugVar = findDebugVariable(debugVariables, fullPath)
      return visitor.visitLeaf(name, fullPath, compositeKey, typeName, debugVar?.index)
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
          const childTypeDef = isFunctionBlock(fbVar.type.value, projectPous) ? 'derived' : 'user-data-type'
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
    // Structure type - fields use .value. prefix in debug path
    const structVariables = findStructureVariables(typeName, dataTypes)

    if (!structVariables) {
      const debugVar = findDebugVariable(debugVariables, fullPath)
      return visitor.visitLeaf(name, fullPath, compositeKey, typeName, debugVar?.index)
    }

    const children: T[] = []

    for (const field of structVariables) {
      const fieldCompositeKey = `${compositeKey}.${field.name}`

      if (field.type.definition === 'base-type') {
        // Use fallback to try both struct-style (.value.) and FB-style paths.
        // The xml2st compiler converts structs to FBs, so debug.c may use either path style.
        const result = findDebugVariableForField(debugVariables, fullPath, field.name)
        children.push(
          visitor.visitLeaf(
            field.name,
            result.matchedPath,
            fieldCompositeKey,
            field.type.value.toUpperCase(),
            result.match?.index,
          ),
        )
      } else if (field.type.definition === 'user-data-type') {
        // Try FB-style path first (compiler may have converted struct to FB)
        const fbStylePath = `${fullPath}.${field.name.toUpperCase()}`
        const structStylePath = `${fullPath}.value.${field.name.toUpperCase()}`
        const hasFbMatch = debugVariables.some(
          (dv) =>
            dv.name.toUpperCase().startsWith(fbStylePath.toUpperCase() + '.') ||
            dv.name.toUpperCase() === fbStylePath.toUpperCase(),
        )
        const fieldFullPath = hasFbMatch ? fbStylePath : structStylePath

        const childTypeDef = isFunctionBlock(field.type.value, projectPous) ? 'derived' : 'user-data-type'
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
        // Use fallback path for array fields too
        const fbStylePath = `${fullPath}.${field.name.toUpperCase()}`
        const structStylePath = `${fullPath}.value.${field.name.toUpperCase()}`
        const hasFbMatch = debugVariables.some(
          (dv) =>
            dv.name.toUpperCase().startsWith(fbStylePath.toUpperCase() + '.') ||
            dv.name.toUpperCase() === fbStylePath.toUpperCase(),
        )
        const fieldFullPath = hasFbMatch ? fbStylePath : structStylePath

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
    // Array type - elements use .value.table[i] pattern
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
      const elementFullPath = `${fullPath}.value.table[${i}]`
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
        const childTypeDef = isFunctionBlock(baseType.value, projectPous) ? 'derived' : 'user-data-type'
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
  return visitor.visitLeaf(name, fullPath, compositeKey, typeName, debugVar?.index)
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
  const { debugVariables, projectPous, pouName, instanceName } = context
  const compositeKey = `${pouName}:${variable.name}`

  // Build the base path
  const fullPath =
    variable.class === 'external' ? buildGlobalDebugPath(variable.name) : buildDebugPath(instanceName, variable.name)

  if (variable.type.definition === 'base-type') {
    const baseType = variable.type.value.toUpperCase()
    const debugVar = findDebugVariable(debugVariables, fullPath)
    return visitor.visitLeaf(variable.name, fullPath, compositeKey, baseType, debugVar?.index)
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
    const typeDef = isFunctionBlock(variable.type.value, projectPous) ? 'derived' : 'user-data-type'
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
