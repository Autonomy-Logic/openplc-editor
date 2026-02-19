import type { PLCVariable } from '@root/types/PLC/units/variable'

const MAX_EXPANSION = 100

interface ParsedArrayAccess {
  baseName: string
  indices: number[]
}

interface DimensionRange {
  lower: number
  upper: number
}

/**
 * Parse an array access expression like "Sensor[0]" or "Matrix[0,1]".
 * Returns null if the name is not a valid array access pattern.
 */
export const parseArrayAccess = (name: string): ParsedArrayAccess | null => {
  const match = name.match(/^([A-Za-z_][A-Za-z0-9_]*)\[(.+)\]$/)
  if (!match) return null

  const baseName = match[1]
  const indicesStr = match[2]

  const parts = indicesStr.split(',')
  const indices: number[] = []

  for (const part of parts) {
    const trimmed = part.trim()
    if (!/^-?\d+$/.test(trimmed)) return null
    indices.push(parseInt(trimmed, 10))
  }

  if (indices.length === 0) return null

  return { baseName, indices }
}

/**
 * Parse a dimension range string like "0..5" into lower and upper bounds.
 */
export const parseDimensionRange = (dimension: string): DimensionRange | null => {
  const match = dimension.match(/^(-?\d+)\.\.(-?\d+)$/)
  if (!match) return null

  const lower = parseInt(match[1], 10)
  const upper = parseInt(match[2], 10)

  if (lower > upper) return null

  return { lower, upper }
}

/**
 * Validate that indices are within the declared array dimensions.
 */
export const validateArrayIndices = (indices: number[], dimensions: { dimension: string }[]): boolean => {
  if (indices.length !== dimensions.length) return false

  return indices.every((index, i) => {
    const range = parseDimensionRange(dimensions[i].dimension)
    if (!range) return false
    return index >= range.lower && index <= range.upper
  })
}

/**
 * Resolve an array element access to a synthetic PLCVariable with the element's base type.
 * Returns null if the indices are out of range or the variable is not an array.
 */
export const resolveArrayElement = (baseVariable: PLCVariable, access: ParsedArrayAccess): PLCVariable | null => {
  if (baseVariable.type.definition !== 'array') return null

  const { data } = baseVariable.type
  if (!validateArrayIndices(access.indices, data.dimensions)) return null

  const indexStr = access.indices.join(',')

  return {
    ...baseVariable,
    name: `${access.baseName}[${indexStr}]`,
    type: {
      definition: data.baseType.definition,
      value: data.baseType.value,
    },
  } as PLCVariable
}

/**
 * Expand an array variable into all its indexed elements for autocomplete.
 * Multidimensional arrays use comma notation: Matrix[0,0], Matrix[0,1], ...
 * Capped at MAX_EXPANSION (100) elements to avoid flooding the UI.
 */
export const expandArrayVariable = (variable: PLCVariable): PLCVariable[] => {
  if (variable.type.definition !== 'array') return [variable]

  const { data } = variable.type
  const ranges = data.dimensions.map((d) => parseDimensionRange(d.dimension)).filter((r): r is DimensionRange => !!r)

  if (ranges.length !== data.dimensions.length) return [variable]

  // Calculate total element count
  const totalElements = ranges.reduce((acc, range) => acc * (range.upper - range.lower + 1), 1)
  if (totalElements > MAX_EXPANSION) return [variable]

  // Generate all index combinations
  const combinations: number[][] = []
  const generateCombinations = (dimIndex: number, current: number[]) => {
    if (dimIndex === ranges.length) {
      combinations.push([...current])
      return
    }
    const range = ranges[dimIndex]
    for (let i = range.lower; i <= range.upper; i++) {
      current.push(i)
      generateCombinations(dimIndex + 1, current)
      current.pop()
    }
  }
  generateCombinations(0, [])

  return combinations.map((indices) => {
    const indexStr = indices.join(',')
    return {
      ...variable,
      name: `${variable.name}[${indexStr}]`,
      type: {
        definition: data.baseType.definition,
        value: data.baseType.value,
      },
    } as PLCVariable
  })
}

/**
 * Expand all array variables in a list, replacing each array with its elements.
 * Non-array variables pass through unchanged.
 */
export const expandArrayVariables = (variables: PLCVariable[]): PLCVariable[] => {
  return variables.flatMap(expandArrayVariable)
}

/**
 * Try to resolve a name as an array access against a variable list.
 * Returns the resolved synthetic PLCVariable, or undefined if not resolvable.
 */
export const resolveArrayVariableByName = (variables: PLCVariable[], name: string): PLCVariable | undefined => {
  const access = parseArrayAccess(name)
  if (!access) return undefined

  const baseVariable = variables.find(
    (v) => v.name.toLowerCase() === access.baseName.toLowerCase() && v.type.definition === 'array',
  )
  if (!baseVariable) return undefined

  return resolveArrayElement(baseVariable, access) ?? undefined
}
