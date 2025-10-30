import type { DebugTreeNode } from '@root/types/debugger'
import type { PLCProject, PLCVariable } from '@root/types/PLC/open-plc'

import { StandardFunctionBlocks } from '../data/library/standard-function-blocks'
import type { DebugVariable } from './parse-debug-file'

const DEBUG_TREE_LOGGING = true

/**
 * Normalizes type strings for case-insensitive comparison.
 * Handles variations like 'function-block', 'functionBlock', 'function_block'.
 */
function normalizeTypeString(typeStr: string): string {
  return typeStr.toLowerCase().replace(/[-_]/g, '')
}

/**
 * Logs debug tree information to console (dev-only).
 */
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

  const compositeKey = `${pouName}:${variable.name}`

  let node: DebugTreeNode

  if (variable.type.definition === 'base-type') {
    const baseType = variable.type.value.toUpperCase()
    const fullPath = `RES0__${instanceNameUpper}.${variableName}`

    const debugVar = debugVariables.find((dv) => dv.name === fullPath)

    node = {
      name: variable.name,
      fullPath,
      compositeKey,
      type: baseType,
      isComplex: false,
      debugIndex: debugVar?.index,
    }
  } else if (variable.type.definition === 'derived') {
    node = buildFunctionBlockTree(variable, pouName, instanceName, debugVariables, project)
  } else if (variable.type.definition === 'array') {
    node = buildArrayTree(variable, pouName, instanceName, debugVariables, project)
  } else if (variable.type.definition === 'user-data-type') {
    node = buildStructTree(variable, pouName, instanceName, debugVariables, project)
  } else {
    node = {
      name: variable.name,
      fullPath: `RES0__${instanceNameUpper}.${variableName}`,
      compositeKey,
      type: 'UNKNOWN',
      isComplex: false,
    }
  }

  if (DEBUG_TREE_LOGGING) {
    console.groupCollapsed(`Debug Tree for ${variable.name}`)
    logDebugTree(node)
    console.groupEnd()
  }

  return node
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
  const fbTypeNameUpper = fbTypeName.toUpperCase()
  const variableName = variable.name.toUpperCase()
  const instanceNameUpper = instanceName.toUpperCase()

  const compositeKey = `${pouName}:${variable.name}`
  const fullPath = `RES0__${instanceNameUpper}.${variableName}`

  const standardFB = StandardFunctionBlocks.pous.find(
    (pou) => pou.name.toUpperCase() === fbTypeNameUpper && normalizeTypeString(pou.type) === 'functionblock',
  )

  const customFB = project.data.pous.find(
    (pou) => normalizeTypeString(pou.type) === 'functionblock' && pou.data.name.toUpperCase() === fbTypeNameUpper,
  )

  const fbDefinition = standardFB || (customFB?.type === 'function-block' ? customFB.data : null)

  if (!fbDefinition) {
    if (DEBUG_TREE_LOGGING) {
      console.warn(`[buildFunctionBlockTree] FB definition not found for "${fbTypeName}"`)
      console.warn(
        `  Available custom FBs:`,
        project.data.pous.filter((p) => p.type === 'function-block').map((p) => ({ name: p.data.name, type: p.type })),
      )
      const caseInsensitiveMatch = project.data.pous.find(
        (p) => p.type === 'function-block' && p.data.name.toUpperCase() === fbTypeName.toUpperCase(),
      )
      if (caseInsensitiveMatch) {
        console.warn(`  Case-insensitive match found: "${caseInsensitiveMatch.data.name}"`)
      }
    }
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
    if (DEBUG_TREE_LOGGING) {
      console.log(
        `[buildFunctionBlockTree] Processing ${fbTypeName}.${fbVar.name}: definition=${fbVar.type.definition}, value=${fbVar.type.value}`,
      )
    }

    const childFullPath = `${fullPath}.${fbVar.name.toUpperCase()}`
    const childCompositeKey = `${compositeKey}.${fbVar.name}`

    if (fbVar.type.definition === 'base-type') {
      const debugVar = debugVariables.find((dv) => dv.name === childFullPath)

      children.push({
        name: fbVar.name,
        fullPath: childFullPath,
        compositeKey: childCompositeKey,
        type: fbVar.type.value.toUpperCase(),
        isComplex: false,
        debugIndex: debugVar?.index,
      })
    } else if (fbVar.type.definition === 'derived' || fbVar.type.definition === 'derived-type') {
      const nestedFBNode = expandNestedNode(
        fbVar.name,
        childFullPath,
        childCompositeKey,
        fbVar.type.value,
        'derived',
        debugVariables,
        project,
      )
      children.push(nestedFBNode)
    } else if (fbVar.type.definition === 'user-data-type') {
      const typeNameUpper = fbVar.type.value.toUpperCase()
      const isStandardFB = StandardFunctionBlocks.pous.some(
        (pou) => pou.name.toUpperCase() === typeNameUpper && normalizeTypeString(pou.type) === 'functionblock',
      )
      const isCustomFB = project.data.pous.some(
        (pou) => normalizeTypeString(pou.type) === 'functionblock' && pou.data.name.toUpperCase() === typeNameUpper,
      )

      if (DEBUG_TREE_LOGGING) {
        console.log(
          `  user-data-type "${fbVar.type.value}" resolved as: ${isStandardFB || isCustomFB ? 'FB' : 'struct'}`,
        )
      }

      if (isStandardFB || isCustomFB) {
        const nestedFBNode = expandNestedNode(
          fbVar.name,
          childFullPath,
          childCompositeKey,
          fbVar.type.value,
          'derived',
          debugVariables,
          project,
        )
        children.push(nestedFBNode)
      } else {
        const nestedNode = expandNestedNode(
          fbVar.name,
          childFullPath,
          childCompositeKey,
          fbVar.type.value,
          'user-data-type',
          debugVariables,
          project,
        )
        children.push(nestedNode)
      }
    } else if (fbVar.type.definition === 'array') {
      const nestedNode = expandNestedNode(
        fbVar.name,
        childFullPath,
        childCompositeKey,
        'ARRAY',
        'array',
        debugVariables,
        project,
        fbVar.type.data,
      )
      children.push(nestedNode)
    } else {
      const debugVar = debugVariables.find((dv) => dv.name === childFullPath)

      children.push({
        name: fbVar.name,
        fullPath: childFullPath,
        compositeKey: childCompositeKey,
        type: 'UNKNOWN',
        isComplex: false,
        debugIndex: debugVar?.index,
      })
    }
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
 * Helper function to expand nested complex nodes (structs, arrays, FBs).
 * Used for recursively expanding complex types within structs, arrays, and FBs.
 */
function expandNestedNode(
  name: string,
  fullPath: string,
  compositeKey: string,
  typeName: string,
  typeDefinition: 'user-data-type' | 'array' | 'derived',
  debugVariables: DebugVariable[],
  project: PLCProject,
  arrayData?: {
    baseType: { definition: 'base-type' | 'user-data-type'; value: string }
    dimensions: Array<{ dimension: string }>
  },
): DebugTreeNode {
  if (typeDefinition === 'derived') {
    const typeNameUpper = typeName.toUpperCase()

    if (DEBUG_TREE_LOGGING) {
      console.log(`[expandNestedNode] Looking up derived type "${typeName}" (uppercase: "${typeNameUpper}")`)
      console.log(`  StandardFunctionBlocks.pous.length: ${StandardFunctionBlocks.pous.length}`)
      console.log(
        `  Sample standard FBs:`,
        StandardFunctionBlocks.pous.slice(0, 5).map((p) => ({ name: p.name, type: p.type })),
      )
    }

    const standardFB = StandardFunctionBlocks.pous.find(
      (pou) => pou.name.toUpperCase() === typeNameUpper && normalizeTypeString(pou.type) === 'functionblock',
    )
    const customFB = project.data.pous.find(
      (pou) => normalizeTypeString(pou.type) === 'functionblock' && pou.data.name.toUpperCase() === typeNameUpper,
    )
    const fbDefinition = standardFB || (customFB?.type === 'function-block' ? customFB.data : null)

    if (DEBUG_TREE_LOGGING) {
      console.log(`  standardFB found: ${!!standardFB}`)
      console.log(`  customFB found: ${!!customFB}`)
      if (!fbDefinition) {
        const nameOnlyMatch = StandardFunctionBlocks.pous.find((pou) => pou.name.toUpperCase() === typeNameUpper)
        if (nameOnlyMatch) {
          console.warn(
            `  Name match found but type filter failed: name="${nameOnlyMatch.name}", type="${nameOnlyMatch.type}"`,
          )
        }
      }
    }

    if (!fbDefinition) {
      return {
        name,
        fullPath,
        compositeKey,
        type: typeName,
        isComplex: false,
      }
    }

    const children: DebugTreeNode[] = []

    for (const fbVar of fbDefinition.variables) {
      const childFullPath = `${fullPath}.${fbVar.name.toUpperCase()}`
      const childCompositeKey = `${compositeKey}.${fbVar.name}`

      if (fbVar.type.definition === 'base-type') {
        const debugVar = debugVariables.find((dv) => dv.name === childFullPath)

        children.push({
          name: fbVar.name,
          fullPath: childFullPath,
          compositeKey: childCompositeKey,
          type: fbVar.type.value.toUpperCase(),
          isComplex: false,
          debugIndex: debugVar?.index,
        })
      } else if (fbVar.type.definition === 'derived' || fbVar.type.definition === 'derived-type') {
        const nestedNode = expandNestedNode(
          fbVar.name,
          childFullPath,
          childCompositeKey,
          fbVar.type.value,
          'derived',
          debugVariables,
          project,
        )
        children.push(nestedNode)
      }
    }

    return {
      name,
      fullPath,
      compositeKey,
      type: typeName,
      isComplex: true,
      children,
    }
  } else if (typeDefinition === 'user-data-type') {
    const typeNameUpper = typeName.toUpperCase()
    const structType = project.data.dataTypes.find(
      (dt) => dt.name.toUpperCase() === typeNameUpper && dt.derivation === 'structure',
    )

    if (!structType || structType.derivation !== 'structure') {
      return {
        name,
        fullPath,
        compositeKey,
        type: typeName,
        isComplex: false,
      }
    }

    const children: DebugTreeNode[] = []

    for (const structVar of structType.variable) {
      const fieldFullPath = `${fullPath}.value.${structVar.name.toUpperCase()}`
      const fieldCompositeKey = `${compositeKey}.${structVar.name}`

      if (structVar.type.definition === 'base-type') {
        const debugVar = debugVariables.find((dv) => dv.name === fieldFullPath)

        children.push({
          name: structVar.name,
          fullPath: fieldFullPath,
          compositeKey: fieldCompositeKey,
          type: structVar.type.value.toUpperCase(),
          isComplex: false,
          debugIndex: debugVar?.index,
        })
      } else if (structVar.type.definition === 'user-data-type') {
        const nestedNode = expandNestedNode(
          structVar.name,
          fieldFullPath,
          fieldCompositeKey,
          structVar.type.value,
          'user-data-type',
          debugVariables,
          project,
        )
        children.push(nestedNode)
      } else if (structVar.type.definition === 'array') {
        const nestedNode = expandNestedNode(
          structVar.name,
          fieldFullPath,
          fieldCompositeKey,
          'ARRAY',
          'array',
          debugVariables,
          project,
          structVar.type.data,
        )
        children.push(nestedNode)
      }
    }

    return {
      name,
      fullPath,
      compositeKey,
      type: typeName,
      isComplex: true,
      children,
    }
  } else if (typeDefinition === 'array' && arrayData) {
    const dimensions = arrayData.dimensions
    if (dimensions.length === 0) {
      return {
        name,
        fullPath,
        compositeKey,
        type: 'ARRAY',
        isComplex: false,
      }
    }

    const firstDimension = dimensions[0].dimension
    const dimensionMatch = firstDimension.match(/^(\d+)\.\.(\d+)$/)

    if (!dimensionMatch) {
      return {
        name,
        fullPath,
        compositeKey,
        type: 'ARRAY',
        isComplex: false,
      }
    }

    const startIndex = parseInt(dimensionMatch[1], 10)
    const endIndex = parseInt(dimensionMatch[2], 10)
    const arraySize = endIndex - startIndex + 1

    const baseType = arrayData.baseType
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
        const nestedNode = expandNestedNode(
          `[${elementIndex}]`,
          elementFullPath,
          elementCompositeKey,
          baseType.value,
          'user-data-type',
          debugVariables,
          project,
        )
        children.push(nestedNode)
      }
    }

    return {
      name,
      fullPath,
      compositeKey,
      type: 'ARRAY',
      isComplex: true,
      children,
      arrayIndices: [startIndex, endIndex],
    }
  }

  return {
    name,
    fullPath,
    compositeKey,
    type: typeName,
    isComplex: false,
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

  const compositeKey = `${pouName}:${variable.name}`
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
      const nestedNode = expandNestedNode(
        `[${elementIndex}]`,
        elementFullPath,
        elementCompositeKey,
        baseType.value,
        'user-data-type',
        debugVariables,
        project,
      )
      children.push(nestedNode)
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
  const structTypeNameUpper = structTypeName.toUpperCase()
  const variableName = variable.name.toUpperCase()
  const instanceNameUpper = instanceName.toUpperCase()

  const compositeKey = `${pouName}:${variable.name}`
  const fullPath = `RES0__${instanceNameUpper}.${variableName}`

  const structType = project.data.dataTypes.find(
    (dt) => dt.name.toUpperCase() === structTypeNameUpper && dt.derivation === 'structure',
  )

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

    if (structVar.type.definition === 'base-type') {
      const debugVar = debugVariables.find((dv) => dv.name === fieldFullPath)

      children.push({
        name: structVar.name,
        fullPath: fieldFullPath,
        compositeKey: fieldCompositeKey,
        type: structVar.type.value.toUpperCase(),
        isComplex: false,
        debugIndex: debugVar?.index,
      })
    } else if (structVar.type.definition === 'user-data-type') {
      const nestedNode = expandNestedNode(
        structVar.name,
        fieldFullPath,
        fieldCompositeKey,
        structVar.type.value,
        'user-data-type',
        debugVariables,
        project,
      )
      children.push(nestedNode)
    } else if (structVar.type.definition === 'array') {
      const nestedNode = expandNestedNode(
        structVar.name,
        fieldFullPath,
        fieldCompositeKey,
        'ARRAY',
        'array',
        debugVariables,
        project,
        structVar.type.data,
      )
      children.push(nestedNode)
    }
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
