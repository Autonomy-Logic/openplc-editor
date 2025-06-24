import { DeviceConfiguration, DevicePin } from '@root/types/PLC/devices'
import { PLCProject } from '@root/types/PLC/open-plc'
import { i18n } from '@root/utils'
import { readFile } from 'fs'
import { join } from 'path'

import { projectFileMapSchema } from '../types'

export type IProjectServiceReadFilesResponse = {
  success: boolean
  error?: {
    title: string
    description: string
    error: unknown
  }
  message?: string
  data?: {
    project: PLCProject
    deviceConfiguration: DeviceConfiguration
    devicePinMapping: DevicePin[]
  }
}

function safeParseProjectFile<K extends keyof typeof projectFileMapSchema>(fileName: K, data: unknown) {
  const result = projectFileMapSchema[fileName].safeParse(data)

  /**
   * TODO: Handle the case where the file does not match the expected schema
   * This could be due to a corrupted file or an unsupported version.
   * For now, we throw an error, but in the future, we might want to
   * handle this more gracefully, perhaps by returning a default value or
   * logging a warning instead of throwing an error.
   */
  if (!result.success) {
    throw new Error(`Failed to parse ${fileName}: ${result.error.message}`)
  }

  return result.data
}

export async function readProjectFiles(basePath: string): Promise<IProjectServiceReadFilesResponse> {
  const projectFiles: Record<string, unknown> = {}

  for (const [fileName, _schema] of Object.entries(projectFileMapSchema)) {
    const filePath = join(basePath, fileName)
    console.log(`Reading file: ${filePath}`)
    try {
      const file = await new Promise<string>((resolve, reject) => {
        readFile(filePath, 'utf-8', (error, data) => {
          if (error) return reject(error)
          return resolve(data)
        })
      })

      if (!file) {
        throw new Error(`File ${fileName} is empty or does not exist at path: ${filePath}`)
      }

      projectFiles[fileName] = safeParseProjectFile(fileName as keyof typeof projectFileMapSchema, JSON.parse(file))
    } catch (error) {
      return {
        success: false,
        error: {
          title: i18n.t('projectServiceResponses:openProject.errors.readFile.title'),
          description: i18n.t('projectServiceResponses:openProject.errors.readFile.description', {
            filePath,
          }),
          error: error,
        },
      }
    }
  }

  const returnData: IProjectServiceReadFilesResponse['data'] = {
    project: projectFiles['project.json'] as PLCProject,
    deviceConfiguration: projectFiles['devices/configuration.json'] as DeviceConfiguration,
    devicePinMapping: projectFiles['devices/pin-mapping.json'] as DevicePin[],
  }

  return {
    success: true,
    message: 'Project files read successfully',
    data: returnData,
  }
}
