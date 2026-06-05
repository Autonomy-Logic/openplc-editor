import type { PLCPou, PLCProjectData, PLCVariable } from '../../../middleware/shared/ports/types'

const createHasBeenInitializedVariable = (): PLCVariable => {
  return {
    name: 'hasBeenInitialized',
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

export { addCppLocalVariables }
