import type { PLCVariable } from '../../../middleware/shared/ports/types'

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
