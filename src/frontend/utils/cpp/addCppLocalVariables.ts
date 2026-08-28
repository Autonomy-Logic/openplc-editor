import type { PLCPou, PLCProjectData, PLCVariable } from '../../../middleware/shared/ports/types'

/**
 * Name of the latch this module injects into every C++ POU.
 *
 * Exported so the interface builder can leave it out of the block's struct:
 * it is the toolchain's own machinery for calling `setup()` exactly once, not
 * something the user declared, and a block that could write to it could
 * re-run or skip its own initialisation.
 */
const CPP_RUNTIME_INTERNAL_VARIABLE = 'hasBeenInitialized'

const createHasBeenInitializedVariable = (): PLCVariable => {
  return {
    name: CPP_RUNTIME_INTERNAL_VARIABLE,
    class: 'local',
    type: {
      definition: 'base-type',
      value: 'BOOL',
    },
    location: '',
    documentation: '',
    debug: false,
    initialValue: '0',
  }
}

const addCppLocalVariables = (projectData: PLCProjectData): PLCProjectData => {
  const processedData = structuredClone(projectData)

  processedData.pous = processedData.pous.map((pou: PLCPou) => {
    if (pou.body.language === 'cpp') {
      const hasBeenInitializedVar = createHasBeenInitializedVariable()
      const variables = pou.interface?.variables ?? []
      pou.interface = {
        ...pou.interface,
        variables: [...variables, hasBeenInitializedVar],
      }
    }

    return pou
  })

  return processedData
}

export { addCppLocalVariables, CPP_RUNTIME_INTERNAL_VARIABLE }
