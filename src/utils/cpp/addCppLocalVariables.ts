import { PLCPou, PLCProjectData, PLCVariable } from '@root/types/PLC/open-plc'

const createHasBeenInitializedVariable = (): PLCVariable => {
  return {
    id: crypto.randomUUID(),
    name: 'hasBeenInitialized',
    class: 'local',
    type: {
      definition: 'base-type',
      value: 'bool',
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
    if (pou.data.body.language === 'cpp') {
      const hasBeenInitializedVar = createHasBeenInitializedVariable()

      pou.data.variables = [...pou.data.variables, hasBeenInitializedVar]
    }

    return pou
  })

  return processedData
}

export { addCppLocalVariables }
