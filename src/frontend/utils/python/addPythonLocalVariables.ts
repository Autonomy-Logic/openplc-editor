import type { PLCPou, PLCProjectData, PLCVariable } from '../../../middleware/shared/ports/types'

const createRuntimeVariables = (): PLCVariable[] => {
  return [
    {
      name: 'first_run',
      class: 'local',
      type: {
        definition: 'base-type',
        value: 'BOOL',
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
        value: 'ULINT',
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
        value: 'ULINT',
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
    if (pou.body.language === 'python') {
      const runtimeVariables = createRuntimeVariables()
      const variables = pou.interface?.variables ?? []
      pou.interface = {
        ...pou.interface,
        variables: [...variables, ...runtimeVariables],
      }
    }

    return pou
  })

  return processedData
}

export { addPythonLocalVariables }
