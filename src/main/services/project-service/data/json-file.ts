// import { IProject } from '../../../../types/PLC'
import { PLCProjectData } from '../../../../types/PLC/open-plc'

export const baseJsonStructure: PLCProjectData = {
  projectName:"new-project",
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
