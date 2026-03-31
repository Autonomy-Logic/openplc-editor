import { PLCVariable } from '@root/types/PLC/open-plc'

const CPP_RUNTIME_LOCAL_VARIABLES = new Set(['hasBeenInitialized'])

const getExposedCppVariables = (variables: PLCVariable[]): PLCVariable[] => {
  return variables.filter((variable) => {
    if (variable.class === 'input' || variable.class === 'output') {
      return true
    }

    if (variable.class === 'local') {
      return !CPP_RUNTIME_LOCAL_VARIABLES.has(variable.name)
    }

    return false
  })
}

export { getExposedCppVariables }
