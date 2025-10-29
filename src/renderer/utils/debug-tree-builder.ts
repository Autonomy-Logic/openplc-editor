import type { PLCProject, PLCVariable } from '@root/types/PLC/open-plc'

import { StandardFunctionBlocks } from '../data/library/standard-function-blocks'
import type { DebugVariable } from './parse-debug-file'

/**
 * Represents a node in the debug variable tree structure.
 * Used to organize complex variables (arrays, structs, function blocks) hierarchically.
 */
export interface DebugTreeNode {
  /** Display name (e.g., "TON0", "favorite_person", "name") */
  name: string
  /** Full debug path (e.g., "RES0__INSTANCE0.TON0.EN") */
  fullPath: string
  /** Editor key format (e.g., "main:TON0.EN") */
  compositeKey: string
  /** IEC type or "STRUCT", "ARRAY", "FB" */
  type: string
  /** true for arrays, structs, FBs */
  isComplex: boolean
  /** UI state (not stored in global state) */
  isExpanded?: boolean
  /** Sub-variables */
  children?: DebugTreeNode[]
  /** Only for leaf nodes */
  debugIndex?: number
  /** For array nodes [start, end] */
  arrayIndices?: number[]
}

/**
 * Builds a debug tree structure for a PLC variable.
 * Recursively processes complex types (arrays, structs, function blocks).
 *
 * @param variable - The PLC variable definition
 * @param pouName - Name of the POU containing the variable
 * @param instanceName - Instance name from Resources configuration
 * @param debugVariables - Parsed variables from debug.c
 * @param project - The PLC project containing all type definitions
 * @returns A DebugTreeNode representing the variable and its children
 */
export function buildDebugTree(
  variable: PLCVariable,
  pouName: string,
  instanceName: string,
  debugVariables: DebugVariable[],
  project: PLCProject,
): DebugTreeNode {
  const variableName = variable.name.toUpperCase()
  const instanceNameUpper = instanceName.toUpperCase()
  const pouNameUpper = pouName.toUpperCase()

  const compositeKey = `${pouNameUpper}:${variableName}`

  if (variable.type.definition === 'base-type') {
    const baseType = variable.type.value.toUpperCase()
    const fullPath = `RES0__${instanceNameUpper}.${variableName}`

    const debugVar = debugVariables.find((dv) => dv.name === fullPath)

    return {
      name: variable.name,
      fullPath,
      compositeKey,
      type: baseType,
      isComplex: false,
      debugIndex: debugVar?.index,
    }
  } else if (variable.type.definition === 'derived') {
    return buildFunctionBlockTree(variable, pouName, instanceName, debugVariables, project)
  } else if (variable.type.definition === 'array') {
    return buildArrayTree(variable, pouName, instanceName, debugVariables, project)
  } else if (variable.type.definition === 'user-data-type') {
    return buildStructTree(variable, pouName, instanceName, debugVariables, project)
  }

  return {
    name: variable.name,
    fullPath: `RES0__${instanceNameUpper}.${variableName}`,
    compositeKey,
    type: 'UNKNOWN',
    isComplex: false,
  }
}

/**
 * Builds a tree node for a Function Block variable.
 * Looks up the FB definition and recursively processes its variables.
 */
function buildFunctionBlockTree(
  variable: PLCVariable,
  pouName: string,
  instanceName: string,
  debugVariables: DebugVariable[],
  project: PLCProject,
): DebugTreeNode {
  if (variable.type.definition !== 'derived') {
    throw new Error('Expected derived type for function block')
  }

  const fbTypeName = variable.type.value
  const variableName = variable.name.toUpperCase()
  const instanceNameUpper = instanceName.toUpperCase()
  const pouNameUpper = pouName.toUpperCase()

  const compositeKey = `${pouNameUpper}:${variableName}`
  const fullPath = `RES0__${instanceNameUpper}.${variableName}`

  const standardFB = StandardFunctionBlocks.pous.find((pou) => pou.name === fbTypeName && pou.type === 'function-block')

  const customFB = project.data.pous.find((pou) => pou.type === 'function-block' && pou.data.name === fbTypeName)

  const fbDefinition = standardFB || (customFB?.type === 'function-block' ? customFB.data : null)

  if (!fbDefinition) {
    return {
      name: variable.name,
      fullPath,
      compositeKey,
      type: fbTypeName,
      isComplex: false,
    }
  }

  const children: DebugTreeNode[] = []

  for (const fbVar of fbDefinition.variables) {
    const childFullPath = `${fullPath}.${fbVar.name.toUpperCase()}`
    const childCompositeKey = `${compositeKey}.${fbVar.name}`

    const debugVar = debugVariables.find((dv) => dv.name === childFullPath)

    let childType = 'UNKNOWN'
    if (fbVar.type.definition === 'base-type') {
      childType = fbVar.type.value.toUpperCase()
    } else if (fbVar.type.definition === 'derived-type') {
      childType = fbVar.type.value
    }

    children.push({
      name: fbVar.name,
      fullPath: childFullPath,
      compositeKey: childCompositeKey,
      type: childType,
      isComplex: false,
      debugIndex: debugVar?.index,
    })
  }

  return {
    name: variable.name,
    fullPath,
    compositeKey,
    type: fbTypeName,
    isComplex: true,
    children,
  }
}

/**
 * Builds a tree node for an Array variable.
 * Creates child nodes for each array element using .value.table[i] naming.
 */
function buildArrayTree(
  variable: PLCVariable,
  pouName: string,
  instanceName: string,
  debugVariables: DebugVariable[],
  project: PLCProject,
): DebugTreeNode {
  if (variable.type.definition !== 'array') {
    throw new Error('Expected array type')
  }

  const variableName = variable.name.toUpperCase()
  const instanceNameUpper = instanceName.toUpperCase()
  const pouNameUpper = pouName.toUpperCase()

  const compositeKey = `${pouNameUpper}:${variableName}`
  const fullPath = `RES0__${instanceNameUpper}.${variableName}`

  const dimensions = variable.type.data.dimensions
  if (dimensions.length === 0) {
    throw new Error('Array must have at least one dimension')
  }

  const firstDimension = dimensions[0].dimension
  const dimensionMatch = firstDimension.match(/^(\d+)\.\.(\d+)$/)

  if (!dimensionMatch) {
    throw new Error(`Invalid array dimension format: ${firstDimension}`)
  }

  const startIndex = parseInt(dimensionMatch[1], 10)
  const endIndex = parseInt(dimensionMatch[2], 10)
  const arraySize = endIndex - startIndex + 1

  const baseType = variable.type.data.baseType
  let elementTypeName = 'UNKNOWN'

  if (baseType.definition === 'base-type') {
    elementTypeName = baseType.value.toUpperCase()
  } else if (baseType.definition === 'user-data-type') {
    elementTypeName = baseType.value
  }

  const children: DebugTreeNode[] = []

  for (let i = 0; i < arraySize; i++) {
    const elementIndex = startIndex + i
    const elementFullPath = `${fullPath}.value.table[${i}]`
    const elementCompositeKey = `${compositeKey}[${elementIndex}]`

    if (baseType.definition === 'base-type') {
      const debugVar = debugVariables.find((dv) => dv.name === elementFullPath)

      children.push({
        name: `[${elementIndex}]`,
        fullPath: elementFullPath,
        compositeKey: elementCompositeKey,
        type: elementTypeName,
        isComplex: false,
        debugIndex: debugVar?.index,
      })
    } else if (baseType.definition === 'user-data-type') {
      const structType = project.data.dataTypes.find(
        (dt) => dt.name === baseType.value && dt.derivation === 'structure',
      )

      if (structType && structType.derivation === 'structure') {
        const structChildren: DebugTreeNode[] = []

        for (const structVar of structType.variable) {
          const fieldFullPath = `${elementFullPath}.${structVar.name.toUpperCase()}`
          const fieldCompositeKey = `${elementCompositeKey}.${structVar.name}`

          const debugVar = debugVariables.find((dv) => dv.name === fieldFullPath)

          let fieldType = 'UNKNOWN'
          if (structVar.type.definition === 'base-type') {
            fieldType = structVar.type.value.toUpperCase()
          } else if (structVar.type.definition === 'user-data-type') {
            fieldType = structVar.type.value
          }

          structChildren.push({
            name: structVar.name,
            fullPath: fieldFullPath,
            compositeKey: fieldCompositeKey,
            type: fieldType,
            isComplex: false,
            debugIndex: debugVar?.index,
          })
        }

        children.push({
          name: `[${elementIndex}]`,
          fullPath: elementFullPath,
          compositeKey: elementCompositeKey,
          type: elementTypeName,
          isComplex: true,
          children: structChildren,
        })
      } else {
        const debugVar = debugVariables.find((dv) => dv.name === elementFullPath)

        children.push({
          name: `[${elementIndex}]`,
          fullPath: elementFullPath,
          compositeKey: elementCompositeKey,
          type: elementTypeName,
          isComplex: false,
          debugIndex: debugVar?.index,
        })
      }
    }
  }

  return {
    name: variable.name,
    fullPath,
    compositeKey,
    type: 'ARRAY',
    isComplex: true,
    children,
    arrayIndices: [startIndex, endIndex],
  }
}

/**
 * Builds a tree node for a Struct (user-data-type) variable.
 * Looks up the struct definition and recursively processes its fields.
 */
function buildStructTree(
  variable: PLCVariable,
  pouName: string,
  instanceName: string,
  debugVariables: DebugVariable[],
  project: PLCProject,
): DebugTreeNode {
  if (variable.type.definition !== 'user-data-type') {
    throw new Error('Expected user-data-type for struct')
  }

  const structTypeName = variable.type.value
  const variableName = variable.name.toUpperCase()
  const instanceNameUpper = instanceName.toUpperCase()
  const pouNameUpper = pouName.toUpperCase()

  const compositeKey = `${pouNameUpper}:${variableName}`
  const fullPath = `RES0__${instanceNameUpper}.${variableName}`

  const structType = project.data.dataTypes.find((dt) => dt.name === structTypeName && dt.derivation === 'structure')

  if (!structType || structType.derivation !== 'structure') {
    return {
      name: variable.name,
      fullPath,
      compositeKey,
      type: structTypeName,
      isComplex: false,
    }
  }

  const children: DebugTreeNode[] = []

  for (const structVar of structType.variable) {
    const fieldFullPath = `${fullPath}.value.${structVar.name.toUpperCase()}`
    const fieldCompositeKey = `${compositeKey}.${structVar.name}`

    const debugVar = debugVariables.find((dv) => dv.name === fieldFullPath)

    let fieldType = 'UNKNOWN'
    let isFieldComplex = false

    if (structVar.type.definition === 'base-type') {
      fieldType = structVar.type.value.toUpperCase()
    } else if (structVar.type.definition === 'user-data-type') {
      fieldType = structVar.type.value
      isFieldComplex = true
    } else if (structVar.type.definition === 'array') {
      fieldType = 'ARRAY'
      isFieldComplex = true
    } else if (structVar.type.definition === 'derived') {
      fieldType = structVar.type.value
      isFieldComplex = true
    }

    children.push({
      name: structVar.name,
      fullPath: fieldFullPath,
      compositeKey: fieldCompositeKey,
      type: fieldType,
      isComplex: isFieldComplex,
      debugIndex: debugVar?.index,
    })
  }

  return {
    name: variable.name,
    fullPath,
    compositeKey,
    type: structTypeName,
    isComplex: true,
    children,
  }
}
