import type { PLCVariable } from '../../../middleware/shared/ports/types'

const CPP_RUNTIME_LOCAL_VARIABLE_NAMES = new Set(['hasBeenInitialized'])

const isCppRuntimeLocalVariable = (variable: PLCVariable): boolean => {
  return CPP_RUNTIME_LOCAL_VARIABLE_NAMES.has(variable.name)
}

const isCppPouStateVariable = (variable: PLCVariable): boolean => {
  if (isCppRuntimeLocalVariable(variable)) return false

  const variableClass = variable.class ?? 'local'
  return (
    variableClass === 'input' || variableClass === 'output' || variableClass === 'inOut' || variableClass === 'local'
  )
}

const getCppPouStateVariables = (variables: PLCVariable[]): PLCVariable[] => {
  return variables.filter(isCppPouStateVariable)
}

export { getCppPouStateVariables, isCppPouStateVariable, isCppRuntimeLocalVariable }
