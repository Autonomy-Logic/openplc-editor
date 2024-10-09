// import { IProject } from '../../../../types/PLC'
import { newPLCProject } from '../../../../types/PLC/open-plc'

export const baseJsonStructure: newPLCProject = {
  meta: {
    name: 'new-project',
    type: 'plc-project',
  },
  data: {
    pous: [],
    dataTypes: [],
    configuration: {
      resource: {
        tasks: [],
        instances: [],
        globalVariables: [],
      },
    },
  },
}
