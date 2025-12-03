import { createDirectory, fileOrDirectoryExists } from '@root/main/utils'
import { projectDefaultFilesMapSchema, projectPouDirectories } from '@root/types/IPC/project-service'
import { IProjectServiceReadFilesResponse } from '@root/types/IPC/project-service/read-project'
import { DeviceConfiguration, DevicePin } from '@root/types/PLC/devices'
import { PLCPou, PLCPouSchema, PLCProject } from '@root/types/PLC/open-plc'
import { i18n } from '@root/utils'
import { getDefaultSchemaValues } from '@root/utils/default-zod-schema-values'
import { migrateProjectToNameTypeSystem, needsMigration } from '@root/utils/migrate-project-to-name-type-system'
import { getExtensionFromLanguage } from '@root/utils/PLC/pou-file-extensions'
import {
  detectLanguageFromExtension,
  parseGraphicalPouFromString,
  parseHybridPouFromString,
  parseTextualPouFromString,
} from '@root/utils/PLC/pou-text-parser'
import { serializePouToText } from '@root/utils/PLC/pou-text-serializer'
import { promises, readdirSync, readFileSync, writeFileSync } from 'fs'
import { basename, dirname, extname, join, sep } from 'path'
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

  const entries = readdirSync(basePath, { withFileTypes: true, recursive: false })
  let hasProjectFile = false

  for (const entry of entries) {
    if (entry.isFile() && entry.name === 'project.json') {
      hasProjectFile = true
      break
    }
  }

  return {
    success: hasProjectFile,
    error: hasProjectFile
      ? undefined
      : {
          title: i18n.t('projectServiceResponses:openProject.errors.invalidProject.title'),
          description: i18n.t('projectServiceResponses:openProject.errors.invalidProject.description', {
            basePath,
          }),
          error: new Error('project.json not found in directory'),
        },
  }
}

function safeParseProjectFile<K extends Extract<keyof typeof projectDefaultFilesMapSchema, string>>(
  fileName: K,
  data: unknown,
  schema?: ZodTypeAny,
) {
  if (!(fileName in projectDefaultFilesMapSchema) && !schema) {
    throw new Error(`File ${fileName} is not a valid project file or schema is not provided.`)
  }

  const fileSchema = projectDefaultFilesMapSchema[fileName] ?? schema
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
  const normalizedPath = filePath.split(sep).join('/')

  if (normalizedPath.includes('/programs/')) {
    return 'program'
  } else if (normalizedPath.includes('/function-blocks/')) {
    return 'function-block'
  } else if (normalizedPath.includes('/functions/')) {
    return 'function'
  }
  throw new Error(`Cannot determine POU type from path: ${filePath}`)
}

/**
 * Helper function to find the last END_VAR in the content
 * @param content - The content to search
 * @param startIndex - The index to start searching from
 * @returns The index after the last END_VAR, or -1 if not found
 */
function findLastEndVarIndex(content: string, startIndex: number): number {
  let lastEndVarIndex = -1
  const regex = /\bEND_VAR\b/gi
  regex.lastIndex = startIndex

  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    lastEndVarIndex = match.index + match[0].length
  }

  return lastEndVarIndex
}

/**
 * Fallback extraction when parsing fails - extracts raw variables block and body
 * @param content - The file content
 * @param language - The language code
 * @param pouType - The POU type
 * @param pouName - The POU name (from filename)
 * @returns A partial PLCPou with empty variables array but preserved variablesText
 */
function createFallbackPou(content: string, language: string, pouType: string, pouName: string): PLCPou {
  const docMatch = content.match(/^\s*\(\*\s*(.*?)\s*\*\)\s*\n/s)
  const documentation = docMatch ? docMatch[1].trim() : ''
  const remainingContent = docMatch ? content.slice(docMatch[0].length) : content

  const varStartIndex = remainingContent.search(
    /\b(VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT|VAR_EXTERNAL|VAR_TEMP|VAR_GLOBAL|VAR)\b/i,
  )

  let variablesText = 'VAR\nEND_VAR' // Default if no variables section found
  let bodyStartIndex = 0

  const pouTypeKeywords = {
    program: 'PROGRAM',
    function: 'FUNCTION',
    'function-block': 'FUNCTION_BLOCK',
  }
  const typeKeyword = pouTypeKeywords[pouType as keyof typeof pouTypeKeywords]
  const declarationRegex = new RegExp(`^\\s*(${typeKeyword})\\s+(\\w+)(?:\\s*:\\s*(\\w+))?`, 'i')
  const declarationMatch = remainingContent.match(declarationRegex)

  if (declarationMatch) {
    bodyStartIndex = declarationMatch[0].length
  }

  if (varStartIndex !== -1) {
    const varSectionStart = varStartIndex
    const lastEndVarIndex = findLastEndVarIndex(remainingContent, varSectionStart)

    if (lastEndVarIndex !== -1) {
      variablesText = remainingContent.slice(varSectionStart, lastEndVarIndex)
      bodyStartIndex = lastEndVarIndex
    }
  }

  let bodyValue: unknown

  if (language === 'st' || language === 'il' || language === 'python' || language === 'cpp') {
    const endKeywords = {
      program: 'END_PROGRAM',
      function: 'END_FUNCTION',
      'function-block': 'END_FUNCTION_BLOCK',
    }
    const endKeyword = endKeywords[pouType as keyof typeof endKeywords]
    const endKeywordRegex = new RegExp(`\\b${endKeyword}\\b`, 'i')
    const endMatch = remainingContent.slice(bodyStartIndex).search(endKeywordRegex)

    if (endMatch !== -1) {
      bodyValue = remainingContent.slice(bodyStartIndex, bodyStartIndex + endMatch).trim()
    } else {
      bodyValue = remainingContent.slice(bodyStartIndex).trim()
    }
  } else if (language === 'ld' || language === 'fbd') {
    const endKeywords = {
      program: 'END_PROGRAM',
      function: 'END_FUNCTION',
      'function-block': 'END_FUNCTION_BLOCK',
    }
    const endKeyword = endKeywords[pouType as keyof typeof endKeywords]
    const endKeywordRegex = new RegExp(`\\b${endKeyword}\\b`, 'i')
    const endMatch = remainingContent.slice(bodyStartIndex).search(endKeywordRegex)

    const bodyContent =
      endMatch !== -1
        ? remainingContent.slice(bodyStartIndex, bodyStartIndex + endMatch).trim()
        : remainingContent.slice(bodyStartIndex).trim()

    try {
      bodyValue = JSON.parse(bodyContent)
    } catch {
      bodyValue = {
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      }
    }
  } else {
    bodyValue = ''
  }

  const commonData = {
    name: pouName,
    variables: [],
    documentation,
    variablesText,
  }

  if (pouType === 'function') {
    return {
      type: 'function',
      data: {
        ...commonData,
        language: language as 'st' | 'il' | 'python' | 'cpp' | 'ld' | 'fbd',
        returnType: 'BOOL',
        body: {
          language: language as 'st' | 'il' | 'python' | 'cpp' | 'ld' | 'fbd',
          value: bodyValue,
        },
      },
    } as PLCPou
  } else if (pouType === 'function-block') {
    return {
      type: 'function-block',
      data: {
        ...commonData,
        language: language as 'st' | 'il' | 'python' | 'cpp' | 'ld' | 'fbd',
        body: {
          language: language as 'st' | 'il' | 'python' | 'cpp' | 'ld' | 'fbd',
          value: bodyValue,
        },
      },
    } as PLCPou
  } else {
    return {
      type: 'program',
      data: {
        ...commonData,
        language: language as 'st' | 'il' | 'python' | 'cpp' | 'ld' | 'fbd',
        body: {
          language: language as 'st' | 'il' | 'python' | 'cpp' | 'ld' | 'fbd',
          value: bodyValue,
        },
      },
    } as PLCPou
  }
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
    const pouType = detectPouTypeFromPath(filePath)
    const language = detectLanguageFromExtension(filePath)

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
 * When both text-based and JSON files exist for the same POU, the text-based file is preferred.
 */
function readDirectoryRecursive(
  baseDir: string,
  baseFileName: string,
  projectFiles: Record<string, unknown>,
  pouNameMap: Map<string, { key: string; isTextBased: boolean }>,
) {
  const entries = readdirSync(baseDir, { withFileTypes: true })

  for (const entry of entries) {
    const entryPath = join(baseDir, entry.name)
    const entryKey = join(baseFileName, entry.name)

    if (entry.isFile()) {
      const fileExtension = extname(entry.name)

      if (!VALID_POU_EXTENSIONS.includes(fileExtension)) {
        continue
      }

      const pouName = basename(entry.name, fileExtension)
      const isTextBased = fileExtension !== '.json'
      const existingEntry = pouNameMap.get(pouName)

      if (existingEntry) {
        if (isTextBased && !existingEntry.isTextBased) {
          delete projectFiles[existingEntry.key]
          try {
            projectFiles[entryKey] = readAndParsePouFile(entryPath, entryKey)
            pouNameMap.set(pouName, { key: entryKey, isTextBased })
          } catch {
            try {
              const fileContent = readFileSync(entryPath, 'utf-8')
              const pouType = detectPouTypeFromPath(entryPath)
              const language = detectLanguageFromExtension(entryPath)
              const fallbackPou = createFallbackPou(fileContent, language, pouType, pouName)
              projectFiles[entryKey] = fallbackPou
              pouNameMap.set(pouName, { key: entryKey, isTextBased })
            } catch {
              // Intentionally skip POUs that cannot be parsed and also fail fallback creation
            }
          }
        }
      } else {
        try {
          projectFiles[entryKey] = readAndParsePouFile(entryPath, entryKey)
          pouNameMap.set(pouName, { key: entryKey, isTextBased })
        } catch {
          try {
            const fileContent = readFileSync(entryPath, 'utf-8')
            const pouType = detectPouTypeFromPath(entryPath)
            const language = detectLanguageFromExtension(entryPath)
            const fallbackPou = createFallbackPou(fileContent, language, pouType, pouName)
            projectFiles[entryKey] = fallbackPou
            pouNameMap.set(pouName, { key: entryKey, isTextBased })
          } catch {
            // Intentionally skip POUs that cannot be parsed and also fail fallback creation
          }
        }
      }
    } else if (entry.isDirectory()) {
      readDirectoryRecursive(entryPath, entryKey, projectFiles, pouNameMap)
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
   * If any of the files cannot be read or parsed, use default values and log a warning.
   */
  for (const fileName of Object.keys(projectDefaultFilesMapSchema) as (keyof typeof projectDefaultFilesMapSchema)[]) {
    const schema = projectDefaultFilesMapSchema[fileName]
    const filePath = join(basePath, fileName)
    try {
      projectFiles[fileName] = readAndParseFile(filePath, fileName, schema)
    } catch {
      projectFiles[fileName] = getDefaultSchemaValues(schema)
    }
  }

  /**
   * Read pou files from the project directory.
   * Use a map to track POUs by name and prefer text-based files over JSON.
   */
  const pouNameMap = new Map<string, { key: string; isTextBased: boolean }>()
  for (const pouDirectory of projectPouDirectories) {
    const pouDirPath = join(basePath, pouDirectory)
    if (fileOrDirectoryExists(pouDirPath)) {
      readDirectoryRecursive(pouDirPath, pouDirectory, pouFiles, pouNameMap)
    }
  }

  if (projectFiles['project.json']) {
    const project = projectFiles['project.json'] as PLCProject
    if (project.data.pous && project.data.pous.length > 0) {
      const migrationResults = await Promise.allSettled(
        project.data.pous.map(async (pou) => {
          const pouType = pou.type.toLowerCase() + 's'
          const language = pou.data.body.language
          const extension = getExtensionFromLanguage(language)
          const pouFilePath = join(basePath, 'pous', pouType, `${pou.data.name}${extension}`)

          try {
            if (!fileOrDirectoryExists(pouFilePath)) {
              await promises.mkdir(dirname(pouFilePath), { recursive: true })
              const textContent = serializePouToText(pou)
              await promises.writeFile(pouFilePath, textContent, 'utf-8')
            }
            pouFiles[join('pous', pouType, `${pou.data.name}${extension}`)] = pou
            return { success: true, pouName: pou.data.name }
          } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error'
            return { success: false, pouName: pou.data.name, error: errorMessage }
          }
        }),
      )

      const successfulMigrations = migrationResults.filter((r) => r.status === 'fulfilled' && r.value.success)

      if (successfulMigrations.length === project.data.pous.length) {
        try {
          project.data.pous = []
          await promises.writeFile(join(basePath, 'project.json'), JSON.stringify(project, null, 2), 'utf-8')
        } catch {
          // Intentionally continue if clearing POUs array fails to allow partial migration
        }
      }
    }
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
