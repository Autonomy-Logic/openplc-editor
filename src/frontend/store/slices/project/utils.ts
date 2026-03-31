import type { PLCVariable } from '../../../../middleware/shared/ports/types'

export function getVariableBasedOnRowIdOrVariableId(
  variables: PLCVariable[],
  rowId?: number,
  variableId?: string,
): { variable: PLCVariable; index: number } | undefined {
  if (variableId) {
    const index = variables.findIndex((v) => v.name === variableId)
    if (index === -1) return undefined
    return { variable: variables[index], index }
  }
  if (rowId !== undefined && rowId >= 0 && rowId < variables.length) {
    return { variable: variables[rowId], index: rowId }
  }
  return undefined
}
