// import { IProject } from '../../../../types/PLC'
import { PLCProject } from '../../../../types/PLC/open-plc'

export const baseJsonStructure: PLCProject = {
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
