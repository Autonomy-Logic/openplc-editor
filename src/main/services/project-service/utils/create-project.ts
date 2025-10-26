import { createDirectory, fileOrDirectoryExists } from '@root/main/utils'
import { CreateJSONFile } from '@root/main/utils'
import {
  CreateProjectDefaultDirectoriesResponse,
  CreateProjectFileProps,
  projectDefaultDirectories,
  projectDefaultFilesMapSchema,
} from '@root/types/IPC/project-service'
import { DeviceConfiguration, DevicePin } from '@root/types/PLC/devices'
import { PLCPou, PLCProject } from '@root/types/PLC/open-plc'
import { getDefaultSchemaValues } from '@root/utils/default-zod-schema-values'
import { getExtensionFromLanguage } from '@root/utils/PLC/pou-file-extensions'
import { serializePouToText } from '@root/utils/PLC/pou-text-serializer'
import { writeFileSync } from 'fs'

const definePou = (language: CreateProjectFileProps['language']): PLCPou => ({
  type: 'program',
  data: {
    name: 'main',
    language: language,
    variables: [],
    documentation: '',
    body: (() => {
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
    })(),
  },
})

const createProjectFile = (dataToCreateProjectFile: CreateProjectFileProps): PLCProject => ({
  meta: {
    name: dataToCreateProjectFile.name,
    type: dataToCreateProjectFile.type,
  },
  data: {
    pous: [],
    dataTypes: [],
    configuration: {
      resource: {
        tasks: [
          {
            name: 'task0',
            triggering: 'Cyclic',
            interval: dataToCreateProjectFile.time,
            priority: 1,
          },
        ],
        instances: [
          {
            name: 'instance0',
            program: 'main',
            task: 'task0',
          },
        ],
        globalVariables: [],
      },
    },
  },
})

const createProjectDefaultStructure = (
  basePath: string,
  dataToCreateProjectFile: CreateProjectFileProps,
): CreateProjectDefaultDirectoriesResponse => {
  const content: {
    project: PLCProject | null
    pous: PLCPou[]
    deviceConfiguration: DeviceConfiguration | null
    devicePinMapping: DevicePin[]
  } = {
    project: null,
    pous: [],
    deviceConfiguration: null,
    devicePinMapping: [],
  }

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
        try {
          CreateJSONFile(filePath, JSON.stringify(content.project, null, 2), file.split('.')[0])
        } catch (error) {
          return {
            success: false,
            error: {
              title: 'Error creating project file',
              description: `Failed to create project file at ${filePath}`,
              error: error,
            },
          }
        }
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
          content.deviceConfiguration.communicationConfiguration.modbusRTU.rtuBaudRate = '115200'
          try {
            CreateJSONFile(filePath, JSON.stringify(content.deviceConfiguration, null, 2), fileName.split('.')[0])
          } catch (error) {
            return {
              success: false,
              error: {
                title: 'Error creating device configuration file',
                description: `Failed to create device configuration file at ${filePath}`,
                error: error,
              },
            }
          }
          break
        case 'devices/pin-mapping.json':
          content.devicePinMapping = defaultValue as DevicePin[]
          try {
            CreateJSONFile(filePath, JSON.stringify(content.devicePinMapping, null, 2), fileName.split('.')[0])
          } catch (error) {
            return {
              success: false,
              error: {
                title: 'Error creating device pin mapping file',
                description: `Failed to create device pin mapping file at ${filePath}`,
                error: error,
              },
            }
          }
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

  const pou = definePou(dataToCreateProjectFile.language)
  const pouPath = `${basePath}/pous/${pou.type}s`

  try {
    if (!fileOrDirectoryExists(pouPath)) createDirectory(pouPath)
    const language = pou.data.body.language
    const extension = getExtensionFromLanguage(language)
    const textContent = serializePouToText(pou)
    const filePath = `${pouPath}/${pou.data.name}${extension}`
    writeFileSync(filePath, textContent, 'utf-8')
  } catch (error) {
    return {
      success: false,
      error: {
        title: 'Error creating POU file',
        description: `Failed to create POU file at ${pouPath}`,
        error: error,
      },
    }
  }

  content.pous.push(pou)

  return {
    success: true,
    data: {
      meta: { path: basePath },
      content: content as {
        project: PLCProject
        pous: PLCPou[]
        deviceConfiguration: DeviceConfiguration
        devicePinMapping: DevicePin[]
      },
    },
  }
}

export { createProjectDefaultStructure, createProjectFile }
