import { createDirectory, fileOrDirectoryExists } from '@root/main/utils'
import {
  projectDefaultDirectoriesValidation,
  projectDefaultFilesMapSchema,
  projectPouDirectories,
} from '@root/types/IPC/project-service'
import { IProjectServiceReadFilesResponse } from '@root/types/IPC/project-service/read-project'
import { DeviceConfiguration, DevicePin } from '@root/types/PLC/devices'
import { PLCPou, PLCPouSchema, PLCProject } from '@root/types/PLC/open-plc'
import { i18n } from '@root/utils'
import { getDefaultSchemaValues } from '@root/utils/default-zod-schema-values'
import { migrateProjectToNameTypeSystem, needsMigration } from '@root/utils/migrate-project-to-name-type-system'
import {
  detectLanguageFromExtension,
  parseGraphicalPouFromString,
  parseHybridPouFromString,
  parseTextualPouFromString,
} from '@root/utils/PLC/pou-text-parser'
import { promises, readdirSync, readFileSync, writeFileSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
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

  const entries = readdirSync(basePath, { withFileTypes: true, recursive: true })
  let isValidProject = true
  let hasProjectFile = false
  for (const entry of entries) {
    // Skip any entries that are not relevant to the project structure
    if (entry.path.startsWith(join(basePath, 'pous')) || entry.path.startsWith(join(basePath, 'build'))) {
      continue
    }

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
      if (!projectDefaultDirectoriesValidation.some((dir) => dir.includes(entry.name))) {
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

function safeParseProjectFile<K extends keyof typeof projectDefaultFilesMapSchema>(
  fileName: K,
  data: unknown,
  schema?: ZodTypeAny,
) {
  if (!Object.keys(projectDefaultFilesMapSchema).includes(fileName) && !schema) {
    throw new Error(`File ${fileName} is not a valid project file or schema is not provided.`)
  }

  const fileSchema = projectDefaultFilesMapSchema[fileName] || schema
  const result = fileSchema.safeParse(data)

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

function readAndParseFile(filePath: string, fileName: string, schema: ZodTypeAny) {
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
  return safeParseProjectFile(fileName as keyof typeof projectDefaultFilesMapSchema, JSON.parse(file), schema)
}

/**
 * Valid POU file extensions (text-based and JSON for backward compatibility)
 */
const VALID_POU_EXTENSIONS = ['.st', '.il', '.ld', '.fbd', '.py', '.cpp', '.json']

/**
 * Helper function to detect POU type from the file path
 * @param filePath - The file path containing the POU type directory
 * @returns The POU type (program, function, function-block)
 * @throws Error if POU type cannot be determined
 */
function detectPouTypeFromPath(filePath: string): string {
  if (filePath.includes('programs')) {
    return 'program'
  } else if (filePath.includes('functions')) {
    return 'function'
  } else if (filePath.includes('function-blocks')) {
    return 'function-block'
  }
  throw new Error(`Cannot determine POU type from path: ${filePath}`)
}

/**
 * Parse a POU file (either JSON or text-based format)
 * @param filePath - The path to the POU file
 * @param fileName - The name of the file (for error messages)
 * @returns Parsed PLCPou object
 * @throws Error if parsing fails
 */
function readAndParsePouFile(filePath: string, fileName: string): PLCPou {
  const fileExtension = extname(filePath)
  const fileContent = readFileSync(filePath, 'utf-8')

  if (fileExtension === '.json') {
    const parsedJson = JSON.parse(fileContent)
    const result = PLCPouSchema.safeParse(parsedJson)
    if (!result.success) {
      throw new Error(`Failed to parse JSON POU file ${fileName}: ${result.error.message}`)
    }
    return result.data
  }

  try {
    const language = detectLanguageFromExtension(filePath)
    const pouType = detectPouTypeFromPath(filePath)

    let pou: PLCPou

    if (language === 'st' || language === 'il') {
      pou = parseTextualPouFromString(fileContent, language, pouType)
    } else if (language === 'python' || language === 'cpp') {
      pou = parseHybridPouFromString(fileContent, language, pouType)
    } else if (language === 'ld' || language === 'fbd') {
      pou = parseGraphicalPouFromString(fileContent, language, pouType)
    } else {
      throw new Error(`Unsupported language: ${language}`)
    }

    const result = PLCPouSchema.safeParse(pou)
    if (!result.success) {
      throw new Error(`Parsed POU failed validation: ${result.error.message}`)
    }

    return result.data
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(`Failed to parse POU file ${fileName}: ${error.message}`)
    }
    throw new Error(`Failed to parse POU file ${fileName}: Unknown error`)
  }
}

/**
 * This function reads a directory recursively and parses POU files according to their format.
 * Supports both text-based formats (.st, .il, .ld, .fbd, .py, .cpp) and JSON format (backward compatibility).
 */
function readDirectoryRecursive(baseDir: string, baseFileName: string, projectFiles: Record<string, unknown>) {
  const entries = readdirSync(baseDir, { withFileTypes: true })

  for (const entry of entries) {
    const entryPath = join(baseDir, entry.name)
    const entryKey = join(baseFileName, entry.name)

    if (entry.isFile()) {
      const fileExtension = extname(entry.name)

      if (!VALID_POU_EXTENSIONS.includes(fileExtension)) {
        continue
      }

      projectFiles[entryKey] = readAndParsePouFile(entryPath, entryKey)
    } else if (entry.isDirectory()) {
      readDirectoryRecursive(entryPath, entryKey, projectFiles)
    }
  }
}

export async function readProjectFiles(basePath: string): Promise<IProjectServiceReadFilesResponse> {
  const isValidProjectDirectory = checkIfDirectoryIsAValidProjectDirectory(basePath)
  if (!isValidProjectDirectory.success) {
    return isValidProjectDirectory
  }

  const projectFiles: Record<string, unknown> = {}
  const pouFiles: Record<string, unknown> = {}

  /**
   * Read the default project files from the project directory.
   * This includes the project.json, devices/configuration.json, and devices/pin-mapping.json files.
   * If any of these files do not exist, they will be created with default values from the schema.
   * If any of the files cannot be read or parsed, an error will be returned.
   */
  for (const [fileName, schema] of Object.entries(projectDefaultFilesMapSchema)) {
    const filePath = join(basePath, fileName)
    try {
      projectFiles[fileName] = readAndParseFile(filePath, fileName, schema)
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
   * Read pou files from the project directory.
   */
  for (const pouDirectory of projectPouDirectories) {
    const pouDirPath = join(basePath, pouDirectory)
    if (fileOrDirectoryExists(pouDirPath)) {
      readDirectoryRecursive(pouDirPath, pouDirectory, pouFiles)
    }
  }

  // Create pou files based on the project file's POU data
  if (projectFiles['project.json']) {
    const project = projectFiles['project.json'] as PLCProject
    await Promise.all(
      project.data.pous.map(async (pou) => {
        const pouType = pou.type.toLowerCase() + 's' // Convert type to lowercase and append 's'
        const pouFilePath = join(basePath, 'pous', pouType, `${pou.data.name}.json`)
        try {
          if (!fileOrDirectoryExists(pouFilePath)) {
            await promises.mkdir(dirname(pouFilePath), { recursive: true })
            await promises.writeFile(pouFilePath, JSON.stringify(pou, null, 2), 'utf-8')
          }
          pouFiles[join('pous', pouType, `${pou.data.name}.json`)] = pou
        } catch (error) {
          console.error(`Failed to create POU file ${pouFilePath}:`, error)
          throw new Error(`Failed to create POU file for ${pou.data.name}`)
        }
      }),
    )
  }

  /**
   * Ensure POU names are set correctly.
   * For text-based formats, the name is already extracted from the file content by the parser.
   * For JSON files (backward compatibility), extract from filename if not already set.
   */
  Object.keys(pouFiles).forEach((key) => {
    const pouFile = pouFiles[key] as PLCPou
    if (!pouFile.data.name) {
      const fileExtension = extname(key)
      const pouName = basename(key, fileExtension)
      if (pouName) {
        pouFile.data.name = pouName
        pouFiles[key] = pouFile
      }
    }
  })

  const returnData: IProjectServiceReadFilesResponse['data'] = {
    project: projectFiles['project.json'] as PLCProject,
    pous: Object.values(pouFiles).map((pou) => pou as PLCPou),
    deviceConfiguration: projectFiles['devices/configuration.json'] as DeviceConfiguration,
    devicePinMapping: projectFiles['devices/pin-mapping.json'] as DevicePin[],
  }

  // Check if project needs migration from ID-based to name+type-based system
  if (needsMigration(returnData.project.data)) {
    console.log('Project needs migration from ID-based to name+type-based system')
    const { migratedProject, report } = migrateProjectToNameTypeSystem(returnData.project.data)

    if (report.success) {
      console.log(`Migration successful: ${report.variablesMigrated} variables migrated`)

      returnData.project.data = migratedProject

      returnData.pous = returnData.pous.map((pou) => {
        const migratedPou = migratedProject.pous.find((p) => p.data.name === pou.data.name)
        if (migratedPou) {
          return { ...pou, data: migratedPou.data } as PLCPou
        }
        return pou
      })

      // Create a backup of the original project before saving migrated version
      const backupPath = join(basePath, 'project.backup.json')
      if (!fileOrDirectoryExists(backupPath)) {
        try {
          await promises.writeFile(backupPath, JSON.stringify(projectFiles['project.json'], null, 2), 'utf-8')
          console.log(`Backup created at: ${backupPath}`)
        } catch (error) {
          console.error('Failed to create backup:', error)
          return {
            success: false,
            message: 'Failed to create backup before migration',
            error: {
              title: 'Backup Creation Failed',
              description:
                'Could not create a backup of the original project before migration. Migration aborted to prevent data loss.',
              error: error,
            },
          }
        }
      }

      try {
        await promises.writeFile(join(basePath, 'project.json'), JSON.stringify(returnData.project, null, 2), 'utf-8')
        console.log('Migrated project saved successfully')

        for (const pou of returnData.pous) {
          const pouType = pou.type.toLowerCase() + 's'
          const pouFilePath = join(basePath, 'pous', pouType, `${pou.data.name}.json`)
          await promises.writeFile(pouFilePath, JSON.stringify(pou, null, 2), 'utf-8')
        }
        console.log('Migrated POUs saved successfully')
      } catch (error) {
        console.error('Failed to save migrated project:', error)
        return {
          success: false,
          message: 'Failed to save migrated project',
          error: {
            title: 'Migration Save Failed',
            description: 'Migration completed but failed to save the migrated project files.',
            error: error,
          },
        }
      }
    } else {
      console.error('Migration failed:', report.errors)
      if (report.unresolvedReferences.length > 0) {
        console.error('Unresolved references:', report.unresolvedReferences)
      }
    }
  }

  return {
    success: true,
    message: 'Project files read successfully',
    data: returnData,
  }
}
