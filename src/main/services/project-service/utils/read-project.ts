import { projectFileMapSchema } from '@root/types/IPC/project-service'
import { DeviceConfiguration, DevicePin } from '@root/types/PLC/devices'
import { PLCProject } from '@root/types/PLC/open-plc'
import { i18n } from '@root/utils'
import { getDefaultSchemaValues } from '@root/utils/default-zod-schema-values'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { ZodTypeAny } from 'zod'

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

function readAndParseFile(filePath: string, schema: ZodTypeAny, fileName: string) {
  let file: string | undefined
  if (!existsSync(filePath)) {
    // File does not exist, create with default value from schema
    const dir = filePath.substring(0, filePath.lastIndexOf('/'))
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    const defaultValue = getDefaultSchemaValues(schema)
    writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), 'utf-8')
    file = JSON.stringify(defaultValue)
  } else {
    file = readFileSync(filePath, 'utf-8')
    if (!file) {
      const defaultValue = getDefaultSchemaValues(schema)
      writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), 'utf-8')
      file = JSON.stringify(defaultValue)
    }
  }
  return safeParseProjectFile(fileName as keyof typeof projectFileMapSchema, JSON.parse(file))
}

function readDirectoryRecursive(
  baseDir: string,
  schema: ZodTypeAny,
  baseFileName: string,
  projectFiles: Record<string, unknown>,
) {
  const entries = readdirSync(baseDir, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = join(baseDir, entry.name)
    const entryKey = join(baseFileName, entry.name)
    if (entry.isFile()) {
      projectFiles[entryKey] = readAndParseFile(entryPath, schema, entryKey)
    } else if (entry.isDirectory()) {
      readDirectoryRecursive(entryPath, schema, entryKey, projectFiles)
    }
  }
}

export function readProjectFiles(basePath: string): IProjectServiceReadFilesResponse {
  const projectFiles: Record<string, unknown> = {}
  for (const [fileName, schema] of Object.entries(projectFileMapSchema)) {
    const filePath = join(basePath, fileName)
    try {
      // TODO: this needs to be tested, it is still a work in progress
      if (existsSync(filePath) && statSync(filePath).isDirectory()) {
        // Recursively read all files and directories inside filePath
        readDirectoryRecursive(filePath, schema, fileName, projectFiles)
      } else {
        projectFiles[fileName] = readAndParseFile(filePath, schema, fileName)
      }
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
