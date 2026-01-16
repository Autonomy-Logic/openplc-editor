import { useOpenPLCStore } from '@root/renderer/store'
import type { PLCDataType, PLCPou, PLCVariable } from '@root/types/PLC/open-plc'
import { useMemo } from 'react'

/**
 * Tree node type for variable tree display
 */
export interface VariableTreeNode {
  id: string
  name: string
  type: 'program' | 'function_block' | 'global' | 'variable' | 'structure' | 'array'
  variableType?: string // IEC type for variables
  children?: VariableTreeNode[]
  pouName: string
  variablePath: string
  isSelectable: boolean
  isExpanded?: boolean
  // Additional metadata for OPC-UA node configuration
  variableClass?: string
  initialValue?: string | null
  // Phase 5: Complex types metadata
  arrayInfo?: {
    dimensions: string[] // e.g., ["1..10"] or ["0..4", "0..2"] for multi-dimensional
    elementType: string // Base type of array elements
    totalLength: number // Total number of elements
  }
  structureInfo?: {
    structTypeName: string // Name of the structure type
    fieldCount: number // Number of fields
  }
}

/**
 * Check if a type is a base IEC type (reserved for Phase 5 - Complex Types)
 */
const _isBaseType = (typeName: string): boolean => {
  const baseTypes = [
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
  return baseTypes.includes(typeName.toLowerCase())
}

/**
 * Check if a type is a standard function block (TON, TOF, CTU, etc.)
 * Reserved for Phase 5 - Complex Types
 */
const _isStandardFunctionBlock = (typeName: string): boolean => {
  const standardFBs = ['ton', 'tof', 'tp', 'ctu', 'ctd', 'ctud', 'r_trig', 'f_trig', 'sr', 'rs']
  return standardFBs.includes(typeName.toLowerCase())
}

/**
 * Find a data type by name in the project's data types
 */
const findDataType = (typeName: string, dataTypes: PLCDataType[]): PLCDataType | undefined => {
  return dataTypes.find((dt) => dt.name.toLowerCase() === typeName.toLowerCase())
}

/**
 * Find a function block by name in the project's POUs
 */
const findFunctionBlock = (typeName: string, pous: PLCPou[]): PLCPou | undefined => {
  return pous.find((pou) => pou.type === 'function-block' && pou.data.name.toLowerCase() === typeName.toLowerCase())
}

/**
 * Get the type name from a PLCVariable's type field
 */
const getTypeName = (variable: PLCVariable | { type: PLCVariable['type']; name: string }): string => {
  if (variable.type.definition === 'base-type') {
    return variable.type.value
  } else if (variable.type.definition === 'array') {
    return variable.type.value
  } else {
    return variable.type.value
  }
}

/**
 * Get display type string for a variable
 */
const getDisplayType = (variable: PLCVariable | { type: PLCVariable['type']; name: string }): string => {
  if (variable.type.definition === 'base-type') {
    return variable.type.value.toUpperCase()
  } else if (variable.type.definition === 'array' && variable.type.data) {
    const dimensions = variable.type.data.dimensions.map((d) => d.dimension).join(', ')
    const baseType =
      variable.type.data.baseType.definition === 'base-type'
        ? variable.type.data.baseType.value.toUpperCase()
        : variable.type.data.baseType.value
    return `ARRAY[${dimensions}] OF ${baseType}`
  } else if (variable.type.definition === 'user-data-type' || variable.type.definition === 'derived') {
    return variable.type.value
  }
  return variable.type.value
}

/**
 * Build a tree node for a structure type
 */
const buildStructureNode = (
  variable: PLCVariable,
  pouName: string,
  dataType: PLCDataType,
  dataTypes: PLCDataType[],
  pous: PLCPou[],
  parentPath: string = '',
): VariableTreeNode => {
  if (dataType.derivation !== 'structure') {
    throw new Error('Expected structure data type')
  }

  const variablePath = parentPath ? `${parentPath}.${variable.name}` : variable.name

  return {
    id: `${pouName}-${variablePath}`,
    name: variable.name,
    type: 'structure',
    variableType: dataType.name,
    pouName,
    variablePath,
    isSelectable: true,
    variableClass: 'class' in variable ? variable.class : undefined,
    initialValue: variable.initialValue,
    structureInfo: {
      structTypeName: dataType.name,
      fieldCount: dataType.variable.length,
    },
    children: dataType.variable.map((field) => {
      const fieldTypeName = getTypeName(field)
      const fieldPath = `${variablePath}.${field.name}`

      // Check if field is a nested structure
      const nestedDataType = findDataType(fieldTypeName, dataTypes)
      if (nestedDataType && nestedDataType.derivation === 'structure') {
        return buildStructureNode(
          { ...field, location: '', documentation: '' } as PLCVariable,
          pouName,
          nestedDataType,
          dataTypes,
          pous,
          variablePath,
        )
      }

      // Check if field is an array
      if (field.type.definition === 'array' && field.type.data) {
        return buildArrayNode(
          { ...field, location: '', documentation: '' } as PLCVariable,
          pouName,
          dataTypes,
          pous,
          variablePath,
        )
      }

      // Simple variable field
      return {
        id: `${pouName}-${fieldPath}`,
        name: field.name,
        type: 'variable' as const,
        variableType: getDisplayType(field),
        pouName,
        variablePath: fieldPath,
        isSelectable: true,
        initialValue: field.initialValue?.simpleValue?.value,
      }
    }),
  }
}

/**
 * Parse array dimension string (e.g., "1..10" or "0..5") to get bounds
 */
const parseArrayDimension = (dimension: string): { min: number; max: number; length: number } => {
  const parts = dimension.split('..')
  if (parts.length === 2) {
    const min = parseInt(parts[0], 10)
    const max = parseInt(parts[1], 10)
    return { min, max, length: max - min + 1 }
  }
  // Fallback for single number (length)
  const len = parseInt(dimension, 10) || 1
  return { min: 0, max: len - 1, length: len }
}

/**
 * Maximum number of array elements to expand in the tree
 * Larger arrays will show as a single selectable node
 */
const MAX_ARRAY_EXPANSION = 50

/**
 * Build a tree node for an array type
 * Phase 5: Now includes array element expansion for reasonably sized arrays
 */
const buildArrayNode = (
  variable: PLCVariable,
  pouName: string,
  dataTypes: PLCDataType[],
  pous: PLCPou[],
  parentPath: string = '',
): VariableTreeNode => {
  const variablePath = parentPath ? `${parentPath}.${variable.name}` : variable.name

  // Extract array info from type
  if (variable.type.definition !== 'array' || !variable.type.data) {
    // Fallback for unexpected type
    return {
      id: `${pouName}-${variablePath}`,
      name: variable.name,
      type: 'array',
      variableType: getDisplayType(variable),
      pouName,
      variablePath,
      isSelectable: true,
      variableClass: 'class' in variable ? variable.class : undefined,
      initialValue: variable.initialValue,
    }
  }

  const dimensions = variable.type.data.dimensions.map((d) => d.dimension)
  const elementBaseType = variable.type.data.baseType

  // Get element type name
  const elementTypeName =
    elementBaseType.definition === 'base-type' ? elementBaseType.value.toUpperCase() : elementBaseType.value

  // Calculate total length (for multi-dimensional, multiply all dimensions)
  let totalLength = 1
  const parsedDimensions = dimensions.map((d) => {
    const parsed = parseArrayDimension(d)
    totalLength *= parsed.length
    return parsed
  })

  // Build array info
  const arrayInfo = {
    dimensions,
    elementType: elementTypeName,
    totalLength,
  }

  // For single-dimensional arrays with reasonable size, expand elements
  const shouldExpand = dimensions.length === 1 && totalLength <= MAX_ARRAY_EXPANSION

  let children: VariableTreeNode[] | undefined

  if (shouldExpand) {
    const { min, max } = parsedDimensions[0]

    // Check if element type is a structure or FB
    const elementDataType =
      elementBaseType.definition !== 'base-type' ? findDataType(elementBaseType.value, dataTypes) : undefined
    const elementFbPou =
      elementBaseType.definition !== 'base-type' ? findFunctionBlock(elementBaseType.value, pous) : undefined

    children = []
    for (let i = min; i <= max; i++) {
      const elementPath = `${variablePath}[${i}]`

      if (elementDataType && elementDataType.derivation === 'structure') {
        // Array of structures
        children.push({
          id: `${pouName}-${elementPath}`,
          name: `[${i}]`,
          type: 'structure',
          variableType: elementTypeName,
          pouName,
          variablePath: elementPath,
          isSelectable: true,
          structureInfo: {
            structTypeName: elementDataType.name,
            fieldCount: elementDataType.variable.length,
          },
          children: elementDataType.variable.map((field) => {
            const fieldPath = `${elementPath}.${field.name}`
            return {
              id: `${pouName}-${fieldPath}`,
              name: field.name,
              type: 'variable' as const,
              variableType: getDisplayType(field),
              pouName,
              variablePath: fieldPath,
              isSelectable: true,
            }
          }),
        })
      } else if (elementFbPou) {
        // Array of function blocks
        children.push(
          buildFunctionBlockNode(
            {
              name: `[${i}]`,
              type: { definition: 'derived', value: elementFbPou.data.name },
              location: '',
              documentation: '',
            } as PLCVariable,
            pouName,
            elementFbPou,
            dataTypes,
            pous,
            variablePath,
          ),
        )
      } else {
        // Array of simple types
        children.push({
          id: `${pouName}-${elementPath}`,
          name: `[${i}]`,
          type: 'variable',
          variableType: elementTypeName,
          pouName,
          variablePath: elementPath,
          isSelectable: true,
        })
      }
    }
  }

  return {
    id: `${pouName}-${variablePath}`,
    name: variable.name,
    type: 'array',
    variableType: getDisplayType(variable),
    pouName,
    variablePath,
    isSelectable: true,
    variableClass: 'class' in variable ? variable.class : undefined,
    initialValue: variable.initialValue,
    arrayInfo,
    children,
  }
}

/**
 * Build a tree node for a function block instance
 */
const buildFunctionBlockNode = (
  variable: PLCVariable,
  pouName: string,
  fbPou: PLCPou,
  dataTypes: PLCDataType[],
  pous: PLCPou[],
  parentPath: string = '',
): VariableTreeNode => {
  if (fbPou.type !== 'function-block') {
    throw new Error('Expected function block POU')
  }

  const variablePath = parentPath ? `${parentPath}.${variable.name}` : variable.name

  return {
    id: `${pouName}-${variablePath}`,
    name: variable.name,
    type: 'function_block',
    variableType: fbPou.data.name,
    pouName,
    variablePath,
    isSelectable: true,
    variableClass: 'class' in variable ? variable.class : undefined,
    children: fbPou.data.variables.map((fbVar) => {
      return buildVariableNode(fbVar, pouName, dataTypes, pous, variablePath)
    }),
  }
}

/**
 * Build a tree node for any variable type
 */
const buildVariableNode = (
  variable: PLCVariable,
  pouName: string,
  dataTypes: PLCDataType[],
  pous: PLCPou[],
  parentPath: string = '',
): VariableTreeNode => {
  const typeName = getTypeName(variable)
  const variablePath = parentPath ? `${parentPath}.${variable.name}` : variable.name

  // Check if it's an array
  if (variable.type.definition === 'array') {
    return buildArrayNode(variable, pouName, dataTypes, pous, parentPath)
  }

  // Check if it's a user-defined structure
  const dataType = findDataType(typeName, dataTypes)
  if (dataType && dataType.derivation === 'structure') {
    return buildStructureNode(variable, pouName, dataType, dataTypes, pous, parentPath)
  }

  // Check if it's a function block instance
  const fbPou = findFunctionBlock(typeName, pous)
  if (fbPou) {
    return buildFunctionBlockNode(variable, pouName, fbPou, dataTypes, pous, parentPath)
  }

  // Check if it's a standard function block (TON, TOF, etc.)
  // For now, we treat standard FBs as simple variables since we don't expose their internal state
  // This can be expanded in Phase 5

  // Simple variable
  return {
    id: `${pouName}-${variablePath}`,
    name: variable.name,
    type: 'variable',
    variableType: getDisplayType(variable),
    pouName,
    variablePath,
    isSelectable: true,
    variableClass: variable.class,
    initialValue: variable.initialValue,
  }
}

/**
 * Build a tree node for a program POU
 */
const buildProgramNode = (pou: PLCPou, dataTypes: PLCDataType[], pous: PLCPou[]): VariableTreeNode => {
  if (pou.type !== 'program') {
    throw new Error('Expected program POU')
  }

  return {
    id: `pou-${pou.data.name}`,
    name: pou.data.name,
    type: 'program',
    pouName: pou.data.name,
    variablePath: '',
    isSelectable: false,
    children: pou.data.variables.map((v) => buildVariableNode(v, pou.data.name, dataTypes, pous)),
  }
}

/**
 * Build a tree node for global variables
 */
const buildGlobalVariablesNode = (
  globalVariables: PLCVariable[],
  dataTypes: PLCDataType[],
  pous: PLCPou[],
): VariableTreeNode => {
  return {
    id: 'global-variables',
    name: 'GVL (Global Variables)',
    type: 'global',
    pouName: 'GVL',
    variablePath: '',
    isSelectable: false,
    children: globalVariables.map((v) => buildVariableNode({ ...v, class: 'global' }, 'GVL', dataTypes, pous)),
  }
}

/**
 * Hook to extract variables from the project for OPC-UA address space configuration.
 * Returns a hierarchical tree structure of all selectable variables.
 */
export const useProjectVariables = (): VariableTreeNode[] => {
  const {
    project: { data: projectData },
  } = useOpenPLCStore()

  return useMemo(() => {
    const nodes: VariableTreeNode[] = []

    // Programs with their variables
    for (const pou of projectData.pous) {
      if (pou.type === 'program') {
        nodes.push(buildProgramNode(pou, projectData.dataTypes, projectData.pous))
      }
    }

    // Global Variables
    const globalVars = projectData.configuration.resource.globalVariables
    if (globalVars && globalVars.length > 0) {
      nodes.push(
        buildGlobalVariablesNode(
          globalVars.map((v) => ({ ...v, class: 'global' })) as PLCVariable[],
          projectData.dataTypes,
          projectData.pous,
        ),
      )
    }

    return nodes
  }, [projectData.pous, projectData.dataTypes, projectData.configuration.resource.globalVariables])
}

/**
 * Helper to find a tree node by its ID
 */
export const findTreeNodeById = (nodes: VariableTreeNode[], id: string): VariableTreeNode | undefined => {
  for (const node of nodes) {
    if (node.id === id) {
      return node
    }
    if (node.children) {
      const found = findTreeNodeById(node.children, id)
      if (found) {
        return found
      }
    }
  }
  return undefined
}

/**
 * Helper to get all selectable leaf node IDs from a tree
 */
export const getAllSelectableIds = (nodes: VariableTreeNode[]): string[] => {
  const ids: string[] = []
  const traverse = (node: VariableTreeNode) => {
    if (node.isSelectable) {
      ids.push(node.id)
    }
    node.children?.forEach(traverse)
  }
  nodes.forEach(traverse)
  return ids
}

/**
 * Helper to check if a node ID or any of its children are selected
 */
export const isNodeOrChildrenSelected = (node: VariableTreeNode, selectedIds: Set<string>): boolean => {
  if (selectedIds.has(node.id)) {
    return true
  }
  if (node.children) {
    return node.children.some((child) => isNodeOrChildrenSelected(child, selectedIds))
  }
  return false
}

/**
 * Helper to get all child IDs (including nested children) for a node
 */
export const getAllChildIds = (node: VariableTreeNode): string[] => {
  const ids: string[] = []
  const traverse = (n: VariableTreeNode) => {
    if (n.isSelectable) {
      ids.push(n.id)
    }
    n.children?.forEach(traverse)
  }
  traverse(node)
  return ids
}

/**
 * Phase 5: Get only the selectable descendants (excluding the node itself)
 */
export const getSelectableDescendantIds = (node: VariableTreeNode): string[] => {
  const ids: string[] = []
  const traverse = (n: VariableTreeNode, isRoot: boolean) => {
    if (!isRoot && n.isSelectable) {
      ids.push(n.id)
    }
    n.children?.forEach((child) => traverse(child, false))
  }
  traverse(node, true)
  return ids
}

/**
 * Phase 5: Check if all selectable descendants are selected
 */
export const areAllChildrenSelected = (node: VariableTreeNode, selectedIds: Set<string>): boolean => {
  const descendantIds = getSelectableDescendantIds(node)
  if (descendantIds.length === 0) return false
  return descendantIds.every((id) => selectedIds.has(id))
}

/**
 * Phase 5: Check if any selectable descendants are selected
 */
export const areAnyChildrenSelected = (node: VariableTreeNode, selectedIds: Set<string>): boolean => {
  const descendantIds = getSelectableDescendantIds(node)
  return descendantIds.some((id) => selectedIds.has(id))
}

/**
 * Phase 5: Selection state for complex types
 */
export type SelectionState = 'none' | 'some' | 'all'

/**
 * Phase 5: Get the selection state of a node and its descendants
 */
export const getSelectionState = (node: VariableTreeNode, selectedIds: Set<string>): SelectionState => {
  // Check if the node itself is selected
  if (selectedIds.has(node.id)) {
    return 'all'
  }

  // For nodes with children, check descendants
  if (node.children && node.children.length > 0) {
    const descendantIds = getSelectableDescendantIds(node)
    if (descendantIds.length === 0) {
      return 'none'
    }

    const selectedCount = descendantIds.filter((id) => selectedIds.has(id)).length
    if (selectedCount === 0) return 'none'
    if (selectedCount === descendantIds.length) return 'all'
    return 'some'
  }

  return 'none'
}

/**
 * Phase 5: Check if a variable type is a complex type (structure, array, or FB)
 */
export const isComplexType = (node: VariableTreeNode): boolean => {
  return node.type === 'structure' || node.type === 'array' || node.type === 'function_block'
}
