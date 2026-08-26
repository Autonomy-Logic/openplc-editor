import type { PLCPou, PLCProjectData, PLCVariable } from '../../../middleware/shared/ports/types'

/**
 * Names this module injects into every Python POU.
 *
 * Exported so the interface builder can leave them out of the shared-memory
 * structs: they are the toolchain's own machinery — the one-shot latch and the
 * two mapped segment addresses — not variables the user declared. Marshalling
 * them would hand the block its own segment pointers to overwrite, and would put
 * three fields into a layout the user cannot see or account for.
 */
const PYTHON_RUNTIME_INTERNAL_VARIABLES: ReadonlySet<string> = new Set(['first_run', 'shm_in_ptr', 'shm_out_ptr'])

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

export { addPythonLocalVariables, PYTHON_RUNTIME_INTERNAL_VARIABLES }
