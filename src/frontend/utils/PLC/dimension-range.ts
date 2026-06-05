interface DimensionRange {
  lower: number
  upper: number
}

/**
 * Parse a dimension range string like "0..5" into lower and upper bounds.
 */
const parseDimensionRange = (dimension: string): DimensionRange | null => {
  const match = dimension.match(/^(-?\d+)\.\.(-?\d+)$/)
  if (!match) return null

  const lower = parseInt(match[1], 10)
  const upper = parseInt(match[2], 10)

  if (lower > upper) return null

  return { lower, upper }
}

export { parseDimensionRange }
export type { DimensionRange }
