export interface DebugVariable {
  name: string
  type: string
  index: number
  /** Parsed path components for identifying parent-child relationships */
  pathComponents?: {
    /** Instance prefix (e.g., "RES0__INSTANCE0") */
    instance: string
    /** Variable name without instance prefix */
    variablePath: string
    /** True if this is a struct field (contains .value.) */
    isStructField: boolean
    /** True if this is an array element (contains .value.table[i]) */
    isArrayElement: boolean
    /** True if this is a function block variable (contains FB_NAME.VAR_NAME) */
    isFunctionBlockVar: boolean
    /** Parent variable path (for nested variables) */
    parentPath?: string
  }
}

export interface ParsedDebugData {
  variables: DebugVariable[]
  totalCount: number
}

/**
 * Parses path components from a debug variable path.
 * Identifies the structure of the path (struct field, array element, FB variable, etc.)
 */
function parsePathComponents(fullPath: string) {
  const firstDotIndex = fullPath.indexOf('.')
  if (firstDotIndex === -1) {
    return {
      instance: fullPath,
      variablePath: '',
      isStructField: false,
      isArrayElement: false,
      isFunctionBlockVar: false,
    }
  }

  const instance = fullPath.substring(0, firstDotIndex)
  const variablePath = fullPath.substring(firstDotIndex + 1)

  const isStructField = variablePath.includes('.value.') && !variablePath.includes('.value.table[')

  const isArrayElement = variablePath.includes('.value.table[')

  const dotCount = (variablePath.match(/\./g) || []).length
  const isFunctionBlockVar = dotCount >= 1 && !isStructField && !isArrayElement

  let parentPath: string | undefined

  if (isStructField) {
    const valueIndex = fullPath.lastIndexOf('.value.')
    if (valueIndex !== -1) {
      parentPath = fullPath.substring(0, valueIndex)
    }
  } else if (isArrayElement) {
    const valueTableIndex = fullPath.lastIndexOf('.value.table[')
    if (valueTableIndex !== -1) {
      const closingBracketIndex = fullPath.indexOf(']', valueTableIndex)
      parentPath =
        closingBracketIndex !== -1
          ? fullPath.substring(0, closingBracketIndex + 1)
          : fullPath.substring(0, valueTableIndex)
    }
  } else if (isFunctionBlockVar) {
    const lastDotIndex = fullPath.lastIndexOf('.')
    if (lastDotIndex !== -1) {
      parentPath = fullPath.substring(0, lastDotIndex)
    }
  }

  return {
    instance,
    variablePath,
    isStructField,
    isArrayElement,
    isFunctionBlockVar,
    parentPath,
  }
}

export function parseDebugFile(content: string): ParsedDebugData {
  const variables: DebugVariable[] = []

  const debugVarsMatch = content.match(/debug_vars\[\]\s*=\s*\{([\s\S]*?)\};/)

  if (!debugVarsMatch) {
    console.warn('Could not find debug_vars[] array in debug.c')
    return { variables: [], totalCount: 0 }
  }

  const arrayContent = debugVarsMatch[1]

  const entryRegex = /\{\s*&\(([^)]+)\)\s*,\s*(\w+)\s*\}/g

  let match
  let index = 0

  while ((match = entryRegex.exec(arrayContent)) !== null) {
    const fullPath = match[1].trim()
    const type = match[2].trim()

    const pathComponents = parsePathComponents(fullPath)

    variables.push({
      name: fullPath,
      type: type,
      index: index,
      pathComponents,
    })

    index++
  }

  const varCountMatch = content.match(/#define\s+VAR_COUNT\s+(\d+)/)
  const totalCount = varCountMatch ? parseInt(varCountMatch[1], 10) : variables.length

  return { variables, totalCount }
}

export function matchVariableWithDebugEntry(
  pouVariableName: string,
  instanceName: string,
  debugVariables: DebugVariable[],
  variableClass?: string,
): number | null {
  const variableNameUpper = pouVariableName.toUpperCase()

  // For external variables, match against the global variable (CONFIG0__VARNAME)
  // This ensures forcing an external variable affects the actual global variable
  if (variableClass === 'external') {
    const globalPath = `CONFIG0__${variableNameUpper}`
    const match = debugVariables.find((dv) => dv.name === globalPath)
    return match ? match.index : null
  }

  // For regular POU variables, use the instance path (RES0__INSTANCE.VARNAME)
  const instanceNameUpper = instanceName.toUpperCase()
  const expectedPath = `RES0__${instanceNameUpper}.${variableNameUpper}`

  const match = debugVariables.find((dv) => dv.name === expectedPath)

  return match ? match.index : null
}

/**
 * Match a global variable with its debug entry.
 * Global variables use CONFIG0__ prefix.
 */
export function matchGlobalVariableWithDebugEntry(
  globalVariableName: string,
  debugVariables: DebugVariable[],
): number | null {
  const variableNameUpper = globalVariableName.toUpperCase()
  const expectedPath = `CONFIG0__${variableNameUpper}`

  const match = debugVariables.find((dv) => dv.name === expectedPath)

  return match ? match.index : null
}
