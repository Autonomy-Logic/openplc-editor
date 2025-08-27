import { PLCVariable } from '@root/types/PLC/open-plc'

export const getVariableBasedOnRowIdOrVariableId = (
  variables: PLCVariable[] | Omit<PLCVariable, 'class'>[],
  rowId?: number,
  variableId?: string,
): PLCVariable | Omit<PLCVariable, 'class'> | null => {
  if (rowId !== undefined) {
    const variable = variables[rowId]
    if (!variable) {
      return null
    }
    return variable
  }

  if (variableId) {
    const variable = variables.find((variable) => variable.id === variableId)
    if (!variable) {
      return null
    }
    return variable
  }

  console.error('variableId or rowId not given')
  return null
}
