import { PLCPou, PLCProjectData, PLCVariable } from '@root/types/PLC/open-plc'

const createRuntimeVariables = (): PLCVariable[] => {
  return [
    {
      name: 'first_run',
      class: 'local',
      type: {
        definition: 'base-type',
        value: 'bool',
      },
      location: '',
      documentation: '',
      debug: false,
    },
    {
      name: 'shm_in_ptr',
      class: 'local',
      type: {
        definition: 'base-type',
        value: 'ulint',
      },
      location: '',
      documentation: '',
      debug: false,
    },
    {
      name: 'shm_out_ptr',
      class: 'local',
      type: {
        definition: 'base-type',
        value: 'ulint',
      },
      location: '',
      documentation: '',
      debug: false,
    },
  ]
}

const addPythonLocalVariables = (projectData: PLCProjectData): PLCProjectData => {
  const processedData = structuredClone(projectData)

  processedData.pous = processedData.pous.map((pou: PLCPou) => {
    if (pou.data.body.language === 'python') {
      const runtimeVariables = createRuntimeVariables()

      pou.data.variables = [...pou.data.variables, ...runtimeVariables]
    }

    return pou
  })

  return processedData
}

export { addPythonLocalVariables }
