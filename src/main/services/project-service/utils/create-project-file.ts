import { PLCProject } from '../../../../types/PLC/open-plc'
import { CreateJSONFile } from '../../../utils'

type CreateProjectFileProps = {
  language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd'
  time: string
  type: 'plc-project' | 'plc-library'
  name: string
  path: string
}
const CreateProjectFile = (dataToCreateProjectFile: CreateProjectFileProps) => {
  const _projectJSONStructure: PLCProject = {
    meta: {
      name: dataToCreateProjectFile.name,
      type: dataToCreateProjectFile.type as 'plc-project',
    },
    data: {
      pous: [
        {
          type: 'program',
          data: {
            name: 'main',
            language: dataToCreateProjectFile.language,
            variables: [],
            documentation: '',
            body: {
              // Bad code!!!!!
              language: dataToCreateProjectFile.language as 'il',
              value: '',
            },
          },
        },
      ],
      dataTypes: [],
      configuration: {
        resource: {
          tasks: [
            {
              name: 'task0',
              triggering: 'Cyclic',
              interval: dataToCreateProjectFile.time,
              priority: 1,
              id: '0',
            },
          ],
          instances: [
            {
              name: 'instance0',
              program: 'main',
              task: 'task0',
              id: '0',
            },
          ],
          globalVariables: [],
        },
      },
    },
  }

  const success = CreateJSONFile(dataToCreateProjectFile.path, JSON.stringify(_projectJSONStructure, null, 2), 'project')

  if (!success) {
    return {
      success: false,
      data: undefined,
    }
  }

  return {
    success: success,
    data: {
      meta: {
        path: dataToCreateProjectFile.path,
      },
      content: _projectJSONStructure,
    },
  }
}

export { CreateProjectFile }
