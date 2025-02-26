import { PLCVariable } from "@root/types/PLC/open-plc"

export const getVariableBasedOnRowIdOrVariableId = (
  variables: PLCVariable[] | Omit<PLCVariable, 'class'>[],
  rowId?: number,
  variableId?: string,
): PLCVariable | Omit<PLCVariable, 'class'> | null => {
  if (rowId !== undefined) {
    const variable = variables.filter((variable) => variable.id !== 'OUT')[rowId]
    if (!variable) {
      console.error('Variable not found')
      return null
    }
    return variable
  }

  if (variableId) {
    const variable = variables.find((variable) => variable.id === variableId)
    if (!variable) {
      console.error('Variable not found')
      return null
    }
    return variable
  }

  console.error('variableId or rowId not given')
  return null
}
