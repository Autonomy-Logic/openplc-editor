import { createDirectory, fileOrDirectoryExists } from '@root/main/utils'
import {
  CreateProjectDefaultDirectoriesResponse,
  CreateProjectFileProps,
  projectDefaultDirectories,
  projectDefaultFilesMapSchema,
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

const createProjectFile = (dataToCreateProjectFile: CreateProjectFileProps): PLCProject => {
  return {
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
}

const createProjectDefaultStructure = (
  basePath: string,
  dataToCreateProjectFile: CreateProjectFileProps,
): CreateProjectDefaultDirectoriesResponse => {
  const content: {
    project?: PLCProject
    deviceConfiguration?: DeviceConfiguration
    devicePinMapping?: DevicePin[]
  } = {}

  /**
   * Create the default directories in the project structure
   */

  // Create all the default directories if they do not exist
  const directories = projectDefaultDirectories
  for (const directory of directories) {
    const dirPath = `${basePath}/${directory}`
    try {
      if (!fileOrDirectoryExists(dirPath)) createDirectory(dirPath)
    } catch (error) {
      return {
        success: false,
        error: {
          title: 'Error creating project directories',
          description: `Failed to create directory at ${dirPath}`,
          error: error,
        },
      }
    }
  }

  /**
   * Create the default files in the project structure
   */

  // Create the root files
  // These are files that are not in a subdirectory, but directly in the project root
  // For example: project.json
  const rootFiles = Object.entries(projectDefaultFilesMapSchema).filter(
    ([file]) => !file.includes('/') && file.includes('.'),
  )
  for (const [file, _schema] of rootFiles) {
    const filePath = basePath

    switch (file) {
      case 'project.json':
        content.project = createProjectFile(dataToCreateProjectFile)
        CreateJSONFile(filePath, JSON.stringify(content.project, null, 2), file.split('.')[0])
        break
      default:
        break
    }
  }

  // Create the directories and files that are in subdirectories
  // For example: devices/configuration.json
  const fileDirectories = Object.entries(projectDefaultFilesMapSchema).filter(
    ([file]) => file.includes('/') && file.includes('.'),
  )
  for (const [file, schema] of fileDirectories) {
    const [directory, fileName] = file.split('/')
    const filePath = `${basePath}/${directory}`
    const defaultValue = getDefaultSchemaValues(schema)

    try {
      switch (file) {
        case 'devices/configuration.json':
          content.deviceConfiguration = defaultValue as DeviceConfiguration
          CreateJSONFile(filePath, JSON.stringify(content.deviceConfiguration, null, 2), fileName.split('.')[0])
          break
        case 'devices/pin-mapping.json':
          content.devicePinMapping = defaultValue as DevicePin[]
          CreateJSONFile(filePath, JSON.stringify(content.devicePinMapping, null, 2), fileName.split('.')[0])
          break
        default:
          break
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

  /**
   * TODO: Create the default pou separated from other files at pous directory
   */

  return {
    success: true,
    data: {
      meta: { path: basePath },
      content: content as {
        project: PLCProject
        deviceConfiguration: DeviceConfiguration
        devicePinMapping: DevicePin[]
      },
    },
  }
}

export { createProjectDefaultStructure, createProjectFile }
