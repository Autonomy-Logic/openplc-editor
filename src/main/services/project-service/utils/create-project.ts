import {
  CreateProjectDefaultDirectoriesResponse,
  CreateProjectFileProps,
  CreateProjectFileResponse,
  projectFileMapSchema,
} from '@root/types/IPC/project-service'
import { DeviceConfiguration, DevicePin } from '@root/types/PLC/devices'
import { getDefaultSchemaValues } from '@root/utils/default-zod-schema-values'

import { PLCProject } from '../../../../types/PLC/open-plc'
import { CreateJSONFile } from '../../../utils'

const definePouBodyData = (language: CreateProjectFileProps['language']) => {
  switch (language) {
    case 'ld':
      return { language, value: { name: 'main', rungs: [] } }
    case 'fbd':
      return {
        language,
        value: {
          name: 'main',
          rung: {
            comment: '',
            edges: [],
            nodes: [],
          },
        },
      }
    default:
      return { language, value: '' }
  }
}

const createProjectFile = (dataToCreateProjectFile: CreateProjectFileProps): CreateProjectFileResponse => {
  const projectJSONStructure: PLCProject = {
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
            body: definePouBodyData(dataToCreateProjectFile.language),
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

  try {
    const success = CreateJSONFile(
      dataToCreateProjectFile.path,
      JSON.stringify(projectJSONStructure, null, 2),
      'project',
    )

    return {
      success: success.ok,
      data: {
        meta: {
          path: dataToCreateProjectFile.path,
        },
        content: {
          project: projectJSONStructure,
        },
      },
    }
  } catch (error) {
    return {
      success: false,
      error: {
        title: 'Error creating project file',
        description: `Failed to create project file at ${dataToCreateProjectFile.path}`,
        error: error,
      },
    }
  }
}

const createProjectDefaultDirectories = (basePath: string): CreateProjectDefaultDirectoriesResponse => {
  const content: {
    deviceConfiguration?: DeviceConfiguration
    devicePinMapping?: DevicePin[]
  } = {}

  const directories = Object.entries(projectFileMapSchema).filter(([file]) => file.includes('/'))
  for (const [file, schema] of directories) {
    const [directory, fileName] = file.split('/')
    const filePath = `${basePath}/${directory}`
    const defaultValue = getDefaultSchemaValues(schema)

    try {
      const success = CreateJSONFile(filePath, JSON.stringify(defaultValue, null, 2), fileName)
      if (success) {
        switch (file) {
          case 'devices/configuration.json':
            content.deviceConfiguration = defaultValue as DeviceConfiguration
            break
          case 'devices/pin-mapping.json':
            content.devicePinMapping = defaultValue as DevicePin[]
            break
          default:
            break
        }
      }
    } catch (error) {
      return {
        success: false,
        error: {
          title: 'Error creating project directories',
          description: `Failed to create directory or file at ${filePath}`,
          error: error,
        },
      }
    }
  }

  return {
    success: true,
    data: {
      meta: { path: basePath },
      content: content as {
        deviceConfiguration: DeviceConfiguration
        devicePinMapping: DevicePin[]
      },
    },
  }
}

export { createProjectDefaultDirectories, createProjectFile }
