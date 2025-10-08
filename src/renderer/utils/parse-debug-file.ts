export interface DebugVariable {
  name: string
  type: string
  index: number
}

export interface ParsedDebugData {
  variables: DebugVariable[]
  totalCount: number
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

    variables.push({
      name: fullPath,
      type: type,
      index: index,
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
): number | null {
  const instanceNameUpper = instanceName.toUpperCase()
  const variableNameUpper = pouVariableName.toUpperCase()

  const expectedPath = `RES0__${instanceNameUpper}.${variableNameUpper}`

  const match = debugVariables.find((dv) => dv.name === expectedPath)

  return match ? match.index : null
}
