// import { IProject } from '../../../../types/PLC'
import { PLCProjectData } from '../../../../types/PLC/open-plc'

export const baseJsonStructure: PLCProjectData = {
  pous: [],
  dataTypes: [],
  configuration: {
    resource: {
      tasks: [],
      instances: [],
      globalVariables: [],
    },
  },
}
