// import { IProject } from '../../../../types/PLC'
import { PLCProjectData } from '../../../../types/PLC/open-plc'

export const baseJsonStructure: PLCProjectData = {
  pous: [],
  dataTypes: [],
  configuration: {
    resource: {
      id: 'res0',
      tasks: [],
      instances: [],
    },
  },
  globalVariables: [],
}
