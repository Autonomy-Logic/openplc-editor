import { useOpenPLCStore } from '@root/renderer/store'
import type { PLCDataType, PLCPou, PLCVariable } from '@root/types/PLC/open-plc'
import {
  findFunctionBlockVariables,
  findStructureVariables,
  isBaseType,
  isEnumerationType,
  isFunctionBlockType,
  type PouVariable,
} from '@root/utils/pou-helpers'
import { useMemo } from 'react'

/**
 * Type for array data extracted from PLCVariable array type.
 * This is the shape of the 'data' property when type.definition === 'array'.
 */
type ArrayData = {
  baseType: { definition: 'base-type'; value: string } | { definition: 'user-data-type'; value: string }
  dimensions: Array<{ dimension: string }>
}

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
  variableClass?: string
  initialValue?: string | null
  arrayInfo?: {
    dimensions: string[]
    elementType: string
    totalLength: number
  }
  structureInfo?: {
    structTypeName: string
    fieldCount: number
  }
}

/**
 * Get the type name from a variable's type field.
 */
const getTypeName = (variable: { type: { value: string } }): string => {
  return variable.type.value
}

/**
 * Get display type string for a variable.
 */
const _getDisplayType = (variable: PLCVariable | { type: PLCVariable['type']; name: string }): string => {
  if (variable.type.definition === 'base-type') {
    return variable.type.value.toUpperCase()
  } else if (variable.type.definition === 'array' && variable.type.data) {
    const dimensions = variable.type.data.dimensions.map((d) => d.dimension).join(', ')
    const baseType =
      variable.type.data.baseType.definition === 'base-type'
        ? variable.type.data.baseType.value.toUpperCase()
        : variable.type.data.baseType.value
    return `ARRAY[${dimensions}] OF ${baseType}`
  }
  return variable.type.value
}

/**
 * Parse array dimension string to get bounds.
 */
const parseArrayDimension = (dimension: string): { min: number; max: number; length: number } => {
  const parts = dimension.split('..')
  if (parts.length === 2) {
    const min = parseInt(parts[0], 10)
    const max = parseInt(parts[1], 10)
    return { min, max, length: max - min + 1 }
  }
  const len = parseInt(dimension, 10) || 1
  return { min: 0, max: len - 1, length: len }
}

const MAX_ARRAY_EXPANSION = 50

/**
 * Recursively build a tree node for any variable type.
 * This is the universal handler that works with ANY FB (standard or custom).
 */
const buildVariableNode = (
  name: string,
  typeName: string,
  typeDefinition: string,
  pouName: string,
  parentPath: string,
  dataTypes: PLCDataType[],
  pous: PLCPou[],
  variableClass?: string,
  initialValue?: PLCVariable['initialValue'],
  arrayData?: ArrayData,
): VariableTreeNode | null => {
  const variablePath = parentPath ? `${parentPath}.${name}` : name

  // Filter out enumerations
  if (isEnumerationType(typeName, dataTypes)) {
    return null
  }

  // Handle arrays
  if (typeDefinition === 'array' && arrayData) {
    return buildArrayNode(name, pouName, parentPath, dataTypes, pous, variableClass, initialValue, arrayData)
  }

  // Base type - this is a selectable leaf
  if (isBaseType(typeName)) {
    return {
      id: `${pouName}-${variablePath}`,
      name,
      type: 'variable',
      variableType: typeName.toUpperCase(),
      pouName,
      variablePath,
      isSelectable: true,
      variableClass,
      initialValue,
    }
  }

  // Check if it's a structure
  const structVariables = findStructureVariables(typeName, dataTypes)
  if (structVariables) {
    return buildStructureNode(
      name,
      typeName,
      pouName,
      parentPath,
      structVariables,
      dataTypes,
      pous,
      variableClass,
      initialValue,
    )
  }

  // Check if it's a function block (standard OR custom - universal lookup)
  const fbVariables = findFunctionBlockVariables(typeName, pous)
  if (fbVariables) {
    return buildFunctionBlockNode(name, typeName, pouName, parentPath, fbVariables, dataTypes, pous, variableClass)
  }

  // Unknown type - not selectable
  return null
}

/**
 * Build a tree node for a structure type.
 */
const buildStructureNode = (
  name: string,
  structTypeName: string,
  pouName: string,
  parentPath: string,
  structVariables: PouVariable[],
  dataTypes: PLCDataType[],
  pous: PLCPou[],
  variableClass?: string,
  initialValue?: PLCVariable['initialValue'],
): VariableTreeNode => {
  const variablePath = parentPath ? `${parentPath}.${name}` : name

  const children = structVariables
    .map((field) => {
      const fieldTypeName = field.type.value
      // Use type assertion since PouVariable has a simplified type structure
      const fieldType = field.type as { definition: string; value: string; data?: ArrayData }
      const arrayData = fieldType.definition === 'array' && fieldType.data ? fieldType.data : undefined
      return buildVariableNode(
        field.name,
        fieldTypeName,
        field.type.definition,
        pouName,
        variablePath,
        dataTypes,
        pous,
        undefined,
        undefined,
        arrayData,
      )
    })
    .filter((node): node is VariableTreeNode => node !== null)

  return {
    id: `${pouName}-${variablePath}`,
    name,
    type: 'structure',
    variableType: structTypeName,
    pouName,
    variablePath,
    isSelectable: true, // Selectable - will expand to leaf variables during index resolution
    variableClass,
    initialValue,
    structureInfo: {
      structTypeName: structTypeName,
      fieldCount: children.length,
    },
    children,
  }
}

/**
 * Build a tree node for a function block instance.
 * Works with ANY FB - standard library or custom user-defined.
 */
const buildFunctionBlockNode = (
  name: string,
  fbTypeName: string,
  pouName: string,
  parentPath: string,
  fbVariables: PouVariable[],
  dataTypes: PLCDataType[],
  pous: PLCPou[],
  variableClass?: string,
): VariableTreeNode => {
  const variablePath = parentPath ? `${parentPath}.${name}` : name

  // Recursively build children for each FB variable
  const children = fbVariables
    .map((fbVar) => {
      const varTypeName = fbVar.type.value

      // Determine the actual type definition
      // Library FBs may use 'derived-type', project FBs use 'derived' or other values
      let effectiveDefinition = fbVar.type.definition

      // For 'user-data-type', check if it's actually an FB
      if (effectiveDefinition === 'user-data-type') {
        if (isFunctionBlockType(varTypeName, pous)) {
          effectiveDefinition = 'derived'
        }
      }

      // Use type assertion since PouVariable has a simplified type structure
      const fbVarType = fbVar.type as { definition: string; value: string; data?: ArrayData }
      const arrayData = effectiveDefinition === 'array' && fbVarType.data ? fbVarType.data : undefined
      return buildVariableNode(
        fbVar.name,
        varTypeName,
        effectiveDefinition,
        pouName,
        variablePath,
        dataTypes,
        pous,
        fbVar.class,
        undefined,
        arrayData,
      )
    })
    .filter((node): node is VariableTreeNode => node !== null)

  return {
    id: `${pouName}-${variablePath}`,
    name,
    type: 'function_block',
    variableType: fbTypeName,
    pouName,
    variablePath,
    isSelectable: true, // Selectable - will expand to leaf variables during index resolution
    variableClass,
    children,
  }
}

/**
 * Build a tree node for an array type.
 */
const buildArrayNode = (
  name: string,
  pouName: string,
  parentPath: string,
  dataTypes: PLCDataType[],
  pous: PLCPou[],
  variableClass?: string,
  initialValue?: PLCVariable['initialValue'],
  arrayData?: ArrayData,
): VariableTreeNode => {
  const variablePath = parentPath ? `${parentPath}.${name}` : name

  if (!arrayData) {
    return {
      id: `${pouName}-${variablePath}`,
      name,
      type: 'array',
      variableType: 'ARRAY',
      pouName,
      variablePath,
      isSelectable: true,
      variableClass,
      initialValue,
    }
  }

  const dimensions = arrayData.dimensions.map((d: { dimension: string }) => d.dimension)
  const elementBaseType = arrayData.baseType
  const elementTypeName =
    elementBaseType.definition === 'base-type' ? elementBaseType.value.toUpperCase() : elementBaseType.value

  let totalLength = 1
  const parsedDimensions = dimensions.map((d: string) => {
    const parsed = parseArrayDimension(d)
    totalLength *= parsed.length
    return parsed
  })

  const arrayInfo = { dimensions, elementType: elementTypeName, totalLength }

  // For arrays of base types, the array itself is selectable
  const elementsAreBaseType = elementBaseType.definition === 'base-type' && isBaseType(elementBaseType.value)
  if (elementsAreBaseType) {
    return {
      id: `${pouName}-${variablePath}`,
      name,
      type: 'array',
      variableType: `ARRAY[${dimensions.join(', ')}] OF ${elementTypeName}`,
      pouName,
      variablePath,
      isSelectable: true,
      variableClass,
      initialValue,
      arrayInfo,
    }
  }

  // For arrays of complex types, expand elements if reasonable size
  const shouldExpand = dimensions.length === 1 && totalLength <= MAX_ARRAY_EXPANSION
  let children: VariableTreeNode[] | undefined

  if (shouldExpand) {
    const { min, max } = parsedDimensions[0]
    children = []

    for (let i = min; i <= max; i++) {
      const elementNode = buildVariableNode(
        `[${i}]`,
        elementTypeName,
        elementBaseType.definition,
        pouName,
        variablePath,
        dataTypes,
        pous,
      )
      if (elementNode) {
        children.push(elementNode)
      }
    }
  }

  return {
    id: `${pouName}-${variablePath}`,
    name,
    type: 'array',
    variableType: `ARRAY[${dimensions.join(', ')}] OF ${elementTypeName}`,
    pouName,
    variablePath,
    isSelectable: true, // Selectable - will expand to leaf variables during index resolution
    variableClass,
    initialValue,
    arrayInfo,
    children,
  }
}

/**
 * Build a tree node from a PLCVariable.
 */
const buildVariableNodeFromPLC = (
  variable: PLCVariable,
  pouName: string,
  dataTypes: PLCDataType[],
  pous: PLCPou[],
  parentPath: string = '',
): VariableTreeNode | null => {
  const typeName = getTypeName(variable)
  return buildVariableNode(
    variable.name,
    typeName,
    variable.type.definition,
    pouName,
    parentPath,
    dataTypes,
    pous,
    variable.class,
    variable.initialValue,
    variable.type.definition === 'array' ? variable.type.data : undefined,
  )
}

/**
 * Build a tree node for a program POU.
 */
const buildProgramNode = (pou: PLCPou, dataTypes: PLCDataType[], pous: PLCPou[]): VariableTreeNode => {
  if (pou.type !== 'program') {
    throw new Error('Expected program POU')
  }

  const children = pou.data.variables
    .map((v) => buildVariableNodeFromPLC(v, pou.data.name, dataTypes, pous))
    .filter((node): node is VariableTreeNode => node !== null)

  return {
    id: `pou-${pou.data.name}`,
    name: pou.data.name,
    type: 'program',
    pouName: pou.data.name,
    variablePath: '',
    isSelectable: false,
    children,
  }
}

/**
 * Build a tree node for global variables.
 */
const buildGlobalVariablesNode = (
  globalVariables: PLCVariable[],
  dataTypes: PLCDataType[],
  pous: PLCPou[],
): VariableTreeNode => {
  const children = globalVariables
    .map((v) => buildVariableNodeFromPLC({ ...v, class: 'global' }, 'GVL', dataTypes, pous))
    .filter((node): node is VariableTreeNode => node !== null)

  return {
    id: 'global-variables',
    name: 'GVL (Global Variables)',
    type: 'global',
    pouName: 'GVL',
    variablePath: '',
    isSelectable: false,
    children,
  }
}

/**
 * Hook to extract variables from the project for OPC-UA address space configuration.
 * Returns a hierarchical tree structure of all selectable variables.
 * Base types, structures, FBs, and arrays are all selectable.
 * Complex types (structures, FBs, arrays) are expanded to their leaf variables during index resolution.
 */
export const useProjectVariables = (): VariableTreeNode[] => {
  const {
    project: { data: projectData },
  } = useOpenPLCStore()

  return useMemo(() => {
    const nodes: VariableTreeNode[] = []

    for (const pou of projectData.pous) {
      if (pou.type === 'program') {
        nodes.push(buildProgramNode(pou, projectData.dataTypes, projectData.pous))
      }
    }

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

// Helper exports for tree manipulation

export const findTreeNodeById = (nodes: VariableTreeNode[], id: string): VariableTreeNode | undefined => {
  for (const node of nodes) {
    if (node.id === id) return node
    if (node.children) {
      const found = findTreeNodeById(node.children, id)
      if (found) return found
    }
  }
  return undefined
}

export const getAllSelectableIds = (nodes: VariableTreeNode[]): string[] => {
  const ids: string[] = []
  const traverse = (node: VariableTreeNode) => {
    if (node.isSelectable) ids.push(node.id)
    node.children?.forEach(traverse)
  }
  nodes.forEach(traverse)
  return ids
}

export const isNodeOrChildrenSelected = (node: VariableTreeNode, selectedIds: Set<string>): boolean => {
  if (selectedIds.has(node.id)) return true
  return node.children?.some((child) => isNodeOrChildrenSelected(child, selectedIds)) ?? false
}

export const getAllChildIds = (node: VariableTreeNode): string[] => {
  const ids: string[] = []
  const traverse = (n: VariableTreeNode) => {
    if (n.isSelectable) ids.push(n.id)
    n.children?.forEach(traverse)
  }
  traverse(node)
  return ids
}

export const getSelectableDescendantIds = (node: VariableTreeNode): string[] => {
  const ids: string[] = []
  const traverse = (n: VariableTreeNode, isRoot: boolean) => {
    if (!isRoot && n.isSelectable) ids.push(n.id)
    n.children?.forEach((child) => traverse(child, false))
  }
  traverse(node, true)
  return ids
}

export const areAllChildrenSelected = (node: VariableTreeNode, selectedIds: Set<string>): boolean => {
  const descendantIds = getSelectableDescendantIds(node)
  if (descendantIds.length === 0) return false
  return descendantIds.every((id) => selectedIds.has(id))
}

export const areAnyChildrenSelected = (node: VariableTreeNode, selectedIds: Set<string>): boolean => {
  const descendantIds = getSelectableDescendantIds(node)
  return descendantIds.some((id) => selectedIds.has(id))
}

export type SelectionState = 'none' | 'some' | 'all'

export const getSelectionState = (node: VariableTreeNode, selectedIds: Set<string>): SelectionState => {
  if (selectedIds.has(node.id)) return 'all'

  if (node.children && node.children.length > 0) {
    const descendantIds = getSelectableDescendantIds(node)
    if (descendantIds.length === 0) return 'none'

    const selectedCount = descendantIds.filter((id) => selectedIds.has(id)).length
    if (selectedCount === 0) return 'none'
    if (selectedCount === descendantIds.length) return 'all'
    return 'some'
  }

  return 'none'
}

export const isComplexType = (node: VariableTreeNode): boolean => {
  return node.type === 'structure' || node.type === 'array' || node.type === 'function_block'
}
