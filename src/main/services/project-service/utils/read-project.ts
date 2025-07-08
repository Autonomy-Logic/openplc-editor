import { createDirectory, fileOrDirectoryExists } from '@root/main/utils'
import { projectDefaultDirectoriesValidation, projectDefaultFilesMapSchema } from '@root/types/IPC/project-service'
import { IProjectServiceReadFilesResponse } from '@root/types/IPC/project-service/read-project'
import { DeviceConfiguration, DevicePin } from '@root/types/PLC/devices'
import { PLCProject } from '@root/types/PLC/open-plc'
import { i18n } from '@root/utils'
import { getDefaultSchemaValues } from '@root/utils/default-zod-schema-values'
import { readdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { ZodTypeAny } from 'zod'

/**
 * Checks if the given directory is a valid project directory according to the expected structure.
 *
 * This function verifies that the directory exists, contains only allowed files and directories,
 * and includes a required project file (`project.json`). It returns an object indicating whether
 * the directory is valid, and provides error details if not.
 *
 * @param basePath - The absolute path to the directory to check.
 * @returns An object with a `success` boolean and, if unsuccessful, an `error` object containing
 *          a title, description, and the underlying error.
 *
 * @remarks
 * The validation logic in the for loop is a work in progress (WIP). In the future, only
 * `projectDefaultFilesMapSchema` will be used for validation.
 */
function checkIfDirectoryIsAValidProjectDirectory(basePath: string): {
  success: boolean
  error?: { title: string; description: string; error: Error }
} {
  // Check if the base path exists and is a directory
  if (!fileOrDirectoryExists(basePath)) {
    return {
      success: false,
      error: {
        title: i18n.t('projectServiceResponses:openProject.errors.directoryNotFound.title'),
        description: i18n.t('projectServiceResponses:openProject.errors.directoryNotFound.description', {
          basePath,
        }),
        error: new Error('Directory does not exist'),
      },
    }
  }

  const entries = readdirSync(basePath, { withFileTypes: true })
  let isValidProject = true
  let hasProjectFile = false
  for (const entry of entries) {
    // If any entry is a file, it should be one of the expected project files
    if (entry.isFile()) {
      if (entry.name === 'project.json') {
        hasProjectFile = true
      }

      if (!Object.keys(projectDefaultFilesMapSchema).includes(entry.name)) {
        isValidProject = false
      }
    }

    // If any entry is a directory, it should be one of the expected directories
    if (entry.isDirectory()) {
      if (!projectDefaultDirectoriesValidation.includes(entry.name)) {
        return {
          success: false,
          error: {
            title: i18n.t('projectServiceResponses:openProject.errors.invalidProjectDirectory.title'),
            description: i18n.t('projectServiceResponses:openProject.errors.invalidProjectDirectory.description', {
              basePath,
            }),
            error: new Error('Invalid project directory structure'),
          },
        }
      }
    }
  }

  return {
    success: isValidProject || hasProjectFile,
    error:
      isValidProject || hasProjectFile
        ? undefined
        : {
            title: i18n.t('projectServiceResponses:openProject.errors.invalidProject.title'),
            description: i18n.t('projectServiceResponses:openProject.errors.invalidProject.description', {
              basePath,
            }),
            error: new Error('Invalid project files structure'),
          },
  }
}

function safeParseProjectFile<K extends keyof typeof projectDefaultFilesMapSchema>(fileName: K, data: unknown) {
  const result = projectDefaultFilesMapSchema[fileName].safeParse(data)

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
  // File does not exist, create with default value from schema
  if (!fileOrDirectoryExists(filePath)) {
    const dir = dirname(filePath)

    // Ensure the directory exists
    if (!fileOrDirectoryExists(dir)) {
      createDirectory(dir)
    }

    // Create the file with default values from the schema
    const defaultValue = getDefaultSchemaValues(schema)
    writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), 'utf-8')
    file = JSON.stringify(defaultValue)
  }

  // File exists, read and parse
  else {
    file = readFileSync(filePath, 'utf-8')

    // If the file is empty, create it with default values
    if (!file) {
      const defaultValue = getDefaultSchemaValues(schema)
      writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), 'utf-8')
      file = JSON.stringify(defaultValue)
    }
  }
  return safeParseProjectFile(fileName as keyof typeof projectDefaultFilesMapSchema, JSON.parse(file))
}

/**
 * @todo WORK IN PROGRESS (WIP):
 * This function reads a directory recursively and parses files according to the provided schema.
 * It is not currently used in the codebase, but it can be useful for future enhancements
 * where we might want to read all files in a directory structure and validate them against schemas.
 * For example: this might be used to read all the pous in a project directory
 */
function _readDirectoryRecursive(
  baseDir: string,
  schema: ZodTypeAny,
  baseFileName: string,
  projectFiles: Record<string, unknown>,
) {
  const entries = readdirSync(baseDir, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = join(baseDir, entry.name)
    const entryKey = join(baseFileName, entry.name)

    // If the entry is a file, read and parse it
    if (entry.isFile()) {
      projectFiles[entryKey] = readAndParseFile(entryPath, schema, entryKey)
    }

    // If the entry is a directory, recursively read its contents
    else if (entry.isDirectory()) {
      _readDirectoryRecursive(entryPath, schema, entryKey, projectFiles)
    }
  }
}

export function readProjectFiles(basePath: string): IProjectServiceReadFilesResponse {
  const isValidProjectDirectory = checkIfDirectoryIsAValidProjectDirectory(basePath)
  if (!isValidProjectDirectory.success) {
    return isValidProjectDirectory
  }

  const projectFiles: Record<string, unknown> = {}

  /**
   * Read the default project files from the project directory.
   * This includes the project.json, devices/configuration.json, and devices/pin-mapping.json files.
   * If any of these files do not exist, they will be created with default values from the schema.
   * If any of the files cannot be read or parsed, an error will be returned.
   */
  for (const [fileName, schema] of Object.entries(projectDefaultFilesMapSchema)) {
    const filePath = join(basePath, fileName)
    try {
      projectFiles[fileName] = readAndParseFile(filePath, schema, fileName)
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

  /**
   * TODO: Read the POU files at pou directory from the project directory.
   */

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
