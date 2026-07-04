/**
 * Debug tree builder for the debugger UI.
 *
 * This module uses the shared traversal visitor pattern from debug-tree-traversal.ts
 * to build DebugTreeNode structures for displaying variables in the debugger.
 */

import type { SystemLibrary } from '../../middleware/shared/ports/library-types'
import type { DebugTreeNode, PLCPou, PLCVariable } from '../../middleware/shared/ports/types'
import type { DebugVariableEntry } from './debug-parser'
import type { DebugNodeVisitor, TraversalContext } from './debug-tree-traversal'
import { traverseVariable } from './debug-tree-traversal'
import { buildGlobalDebugPath, buildVariableDebugPath } from './debug-variable-finder'

/**
 * Project data shape expected by the debug tree builder.
 * Accepts either the middleware PLCPou type or the store's PLCProjectData.pous.
 */
interface DebugProjectData {
  dataTypes: TraversalContext['dataTypes']
  pous: PLCPou[]
}

const DEBUG_TREE_LOGGING = false

/**
 * Logs debug tree information to console (dev-only).
 */
/* istanbul ignore next -- dev-only: guarded by DEBUG_TREE_LOGGING constant */
function logDebugTree(node: DebugTreeNode, indent = 0): void {
  if (!DEBUG_TREE_LOGGING) return

  const prefix = '  '.repeat(indent)
  const complexMarker = node.isComplex ? '[COMPLEX]' : '[LEAF]'
  const indexInfo = node.debugIndex !== undefined ? ` debugIndex=${node.debugIndex}` : ''
  const arrayInfo = node.arrayIndices ? ` arrayIndices=[${node.arrayIndices[0]}..${node.arrayIndices[1]}]` : ''

  console.log(`${prefix}${complexMarker} ${node.name} (${node.type})${indexInfo}${arrayInfo}`)
  console.log(`${prefix}  fullPath: ${node.fullPath}`)
  console.log(`${prefix}  compositeKey: ${node.compositeKey}`)

  if (node.arrayIndices) {
    const [start] = node.arrayIndices
    const sampleIEC = start + 1
    const sampleC = sampleIEC - start
    console.log(`${prefix}  Example: IEC [${sampleIEC}] → table[${sampleC}]`)
  }

  if (node.children && node.children.length > 0) {
    console.log(`${prefix}  children (${node.children.length}):`)
    for (const child of node.children) {
      logDebugTree(child, indent + 2)
    }
  }
}

/**
 * Visitor implementation that produces DebugTreeNode objects.
 * Used with the shared traversal to build the debug tree structure.
 */
class DebugTreeNodeVisitor implements DebugNodeVisitor<DebugTreeNode> {
  visitLeaf(
    name: string,
    fullPath: string,
    compositeKey: string,
    typeName: string,
    debugIndex: number | undefined,
    enumValues?: string[],
  ): DebugTreeNode {
    return {
      name,
      fullPath,
      compositeKey,
      type: typeName,
      isComplex: false,
      debugIndex,
      ...(enumValues ? { enumValues } : {}),
    }
  }

  visitComplex(
    name: string,
    fullPath: string,
    compositeKey: string,
    typeName: string,
    children: DebugTreeNode[],
  ): DebugTreeNode {
    return {
      name,
      fullPath,
      compositeKey,
      type: typeName,
      isComplex: true,
      children,
    }
  }

  visitArray(
    name: string,
    fullPath: string,
    compositeKey: string,
    _elementTypeName: string,
    arrayIndices: [number, number],
    children: DebugTreeNode[],
  ): DebugTreeNode {
    return {
      name,
      fullPath,
      compositeKey,
      type: 'ARRAY',
      isComplex: true,
      children,
      arrayIndices,
    }
  }
}

/**
 * Builds a debug tree structure for a PLC variable.
 * Uses the shared traversal with a visitor pattern to recursively process
 * complex types (arrays, structs, function blocks).
 *
 * @param variable - The PLC variable definition
 * @param pouName - Name of the POU containing the variable
 * @param instanceName - Instance name from Resources configuration
 * @param debugVariables - Parsed variables from debug.c
 * @param projectData - The PLC project data containing all type definitions
 * @returns A DebugTreeNode representing the variable and its children
 */
export function buildDebugTree(
  variable: PLCVariable,
  pouName: string,
  instanceName: string,
  debugVariables: DebugVariableEntry[],
  projectData: DebugProjectData,
  systemLibraries: SystemLibrary[],
): DebugTreeNode {
  // Handle external variables specially - they use global path
  // For external variables, we need to adjust the traversal
  if (variable.class === 'external') {
    // External variables use CONFIG0__ prefix instead of RES0__INSTANCE
    // Create a modified variable traversal for external variables
    const fullPath = buildGlobalDebugPath(variable.name)
    const compositeKey = `${pouName}:${variable.name}`

    if (variable.type.definition === 'base-type') {
      const debugVar = debugVariables.find((dv) => dv.name === fullPath)
      const node: DebugTreeNode = {
        name: variable.name,
        fullPath,
        compositeKey,
        type: variable.type.value.toUpperCase(),
        isComplex: false,
        debugIndex: debugVar?.index,
      }

      /* istanbul ignore next -- dev-only: guarded by DEBUG_TREE_LOGGING constant */
      if (DEBUG_TREE_LOGGING) {
        console.groupCollapsed(`Debug Tree for ${variable.name} (external)`)
        logDebugTree(node)
        console.groupEnd()
      }

      return node
    }

    // For complex external variables, use the standard traversal
    // but we need to handle this specially since external vars use CONFIG0__ prefix
    // The shared traversal handles external class automatically
  }

  // Create traversal context
  const context: TraversalContext = {
    debugVariables,
    projectPous: projectData.pous,
    dataTypes: projectData.dataTypes,
    systemLibraries,
    instanceName,
    pouName,
  }

  // Use the shared traversal with our visitor
  const visitor = new DebugTreeNodeVisitor()
  const node = traverseVariable(variable, context, visitor)

  /* istanbul ignore next -- dev-only: guarded by DEBUG_TREE_LOGGING constant */
  if (DEBUG_TREE_LOGGING) {
    console.groupCollapsed(`Debug Tree for ${variable.name}`)
    logDebugTree(node)
    console.groupEnd()
  }

  return node
}

/**
 * Build the base path for a variable - exposed for backward compatibility.
 * External variables use CONFIG0__ prefix, local variables use RES0__INSTANCE. prefix.
 */
export function buildVariableBasePath(variableName: string, instanceName: string, variableClass?: string): string {
  return buildVariableDebugPath(variableClass === 'external', instanceName, variableName)
}
