import type { PLCVariable } from '@root/middleware/shared/ports/types'

const CPP_RUNTIME_LOCAL_VARIABLES = new Set(['hasBeenInitialized'])

/** Selects variables that user-authored C++ POU code can access. */
const getExposedCppVariables = (variables: PLCVariable[]): PLCVariable[] => {
  return variables.filter((variable) => {
    if (variable.class === 'input' || variable.class === 'output') return true
    if (variable.class === 'local') return !CPP_RUNTIME_LOCAL_VARIABLES.has(variable.name)
    return false
  })
}

export { getExposedCppVariables }
