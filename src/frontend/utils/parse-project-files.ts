/**
 * Frontend Project File Parser
 *
 * Parses raw project file contents (strings) into the structured data
 * that handleOpenProjectResponse expects. This is the single source of
 * truth for project parsing — both Electron and web use this.
 *
 * The backend only reads raw files from disk; all parsing happens here.
 */

import type { RawProjectFile } from '../../middleware/shared/ports/project-port'
import type {
  DeviceConfiguration,
  DevicePin,
  PLCDataType,
  PLCInstance,
  PLCPou,
  PLCRemoteDevice,
  PLCServer,
  PLCTask,
  PLCVariable,
} from '../../middleware/shared/ports/types'
import { PLCRemoteDeviceSchema, PLCServerSchema } from '../../types/PLC/open-plc'
import {
  detectLanguageFromExtension,
  findLastEndVarIndex,
  parseGraphicalPouFromString,
  parseHybridPouFromString,
  parseTextualPouFromString,
} from './PLC/pou-text-parser'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FallbackPou = PLCPou & { variablesText?: string }

export interface ParsedProjectData {
  meta: {
    name: string
    type: 'plc-project' | 'plc-library'
    path: string
  }
  projectData: {
    dataTypes: PLCDataType[]
    pous: (PLCPou & { variablesText?: string })[]
    configurations: {
      resource: {
        tasks: PLCTask[]
        instances: PLCInstance[]
        globalVariables: PLCVariable[]
      }
    }
    servers?: PLCServer[]
    remoteDevices?: PLCRemoteDevice[]
    debugVariables?: { global?: string[]; pous?: Record<string, string[]> }
  }
  deviceConfiguration?: DeviceConfiguration
  devicePinMapping?: DevicePin[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Detect POU type from the file's relative path.
 * Throws if the path does not match any known POU directory.
 */
function detectPouTypeFromPath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/')
  if (normalized.includes('/programs/')) return 'program'
  if (normalized.includes('/function-blocks/')) return 'function-block'
  if (normalized.includes('/functions/')) return 'function'
  throw new Error(`Cannot determine POU type from path: ${relativePath}`)
}

/**
 * Detect language from file extension.
 * e.g., '.st' → 'st', '.ld' → 'ld'
 */
function getLanguageFromExt(relativePath: string): string | null {
  try {
    return detectLanguageFromExtension(relativePath)
  } catch {
    return null
  }
}

/**
 * Extract the base filename without extension from a relative path.
 */
function getBaseNameFromPath(relativePath: string): string {
  return (
    relativePath
      .split('/')
      .pop()
      ?.replace(/\.\w+$/, '') ?? 'unknown'
  )
}

// ---------------------------------------------------------------------------
// Fallback POU creation
// ---------------------------------------------------------------------------

/**
 * Create a POU from raw file content when normal parsing fails.
 * Preserves as much data as possible: documentation, raw variable text, body.
 *
 * This is a direct port of the old backend's createFallbackPou logic
 * (read-project.ts:190-315), adapted to return the flat port format.
 */
function createFallbackPou(content: string, language: string, pouType: string, pouName: string): FallbackPou {
  // 1. Extract documentation from leading (* ... *) comment
  const docMatch = content.match(/^\s*\(\*\s*(.*?)\s*\*\)\s*\n/s)
  const documentation = docMatch ? docMatch[1].trim() : ''
  const remainingContent = docMatch ? content.slice(docMatch[0].length) : content

  // 2. Find POU declaration to determine where body starts
  const pouTypeKeywords: Record<string, string> = {
    program: 'PROGRAM',
    function: 'FUNCTION',
    'function-block': 'FUNCTION_BLOCK',
  }
  const typeKeyword = pouTypeKeywords[pouType]
  const declarationRegex = new RegExp(`^\\s*(${typeKeyword})\\s+(\\w+)(?:\\s*:\\s*(\\w+))?`, 'i')
  const declarationMatch = remainingContent.match(declarationRegex)
  let bodyStartIndex = declarationMatch ? declarationMatch[0].length : 0

  // 3. Extract raw VAR blocks as variablesText
  const varStartIndex = remainingContent.search(
    /\b(VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT|VAR_EXTERNAL|VAR_TEMP|VAR_GLOBAL|VAR)\b/i,
  )
  let variablesText = 'VAR\nEND_VAR'
  if (varStartIndex !== -1) {
    const lastEnd = findLastEndVarIndex(remainingContent, varStartIndex)
    if (lastEnd !== -1) {
      variablesText = remainingContent.slice(varStartIndex, lastEnd)
      bodyStartIndex = lastEnd
    }
  }

  // 4. Extract body content
  const endKeywords: Record<string, string> = {
    program: 'END_PROGRAM',
    function: 'END_FUNCTION',
    'function-block': 'END_FUNCTION_BLOCK',
  }
  const endKeyword = endKeywords[pouType]
  let bodyValue: unknown

  if (language === 'ld' || language === 'fbd') {
    const endRegex = new RegExp(`\\b${endKeyword}\\b`, 'i')
    const endMatch = remainingContent.slice(bodyStartIndex).search(endRegex)
    const bodyContent =
      endMatch !== -1
        ? remainingContent.slice(bodyStartIndex, bodyStartIndex + endMatch).trim()
        : remainingContent.slice(bodyStartIndex).trim()
    try {
      bodyValue = JSON.parse(bodyContent)
    } catch {
      bodyValue = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
    }
  } else if (language === 'st' || language === 'il' || language === 'python' || language === 'cpp') {
    const endRegex = new RegExp(`\\b${endKeyword}\\b`, 'i')
    const endMatch = remainingContent.slice(bodyStartIndex).search(endRegex)
    bodyValue =
      endMatch !== -1
        ? remainingContent.slice(bodyStartIndex, bodyStartIndex + endMatch).trim()
        : remainingContent.slice(bodyStartIndex).trim()
  } else {
    bodyValue = ''
  }

  // 5. Build flat-format POU
  return {
    name: pouName,
    pouType: pouType as PLCPou['pouType'],
    interface: {
      ...(pouType === 'function' ? { returnType: 'BOOL' } : {}),
      variables: [],
    },
    body: {
      language: language as PLCPou['body']['language'],
      value: bodyValue,
    },
    documentation,
    variablesText,
  }
}

// ---------------------------------------------------------------------------
// POU file parsing
// ---------------------------------------------------------------------------

/**
 * Parse a single POU file from its raw text content.
 * Returns null if the file format is not recognized.
 * On parse failure, falls back to createFallbackPou which preserves
 * documentation, raw variable text, and body content.
 */
function parsePouFile(file: RawProjectFile): (PLCPou & { variablesText?: string }) | null {
  const ext = file.relativePath.split('.').pop()?.toLowerCase()
  if (!ext) return null

  const pouType = detectPouTypeFromPath(file.relativePath)

  // Legacy JSON format
  if (ext === 'json') {
    try {
      const parsed = JSON.parse(file.content) as unknown
      // JSON POUs may be in the old discriminated union format: { type, data }
      if (parsed && typeof parsed === 'object' && 'type' in parsed && 'data' in parsed) {
        const ipcPou = parsed as { type: string; data: Record<string, unknown> }
        return {
          name: (ipcPou.data.name as string) ?? '',
          pouType: ipcPou.type as PLCPou['pouType'],
          interface: {
            returnType: ipcPou.data.returnType as string | undefined,
            variables: (ipcPou.data.variables as PLCVariable[]) ?? [],
          },
          body: ipcPou.data.body as PLCPou['body'],
          documentation: (ipcPou.data.documentation as string) ?? '',
        }
      }
      // Flat format
      return parsed as PLCPou
    } catch {
      return null
    }
  }

  const language = getLanguageFromExt(file.relativePath)
  if (!language) return null

  try {
    if (language === 'st' || language === 'il') {
      return parseTextualPouFromString(file.content, language, pouType)
    } else if (language === 'python' || language === 'cpp') {
      return parseHybridPouFromString(file.content, language, pouType)
    } else if (language === 'ld' || language === 'fbd') {
      return parseGraphicalPouFromString(file.content, language, pouType)
    }
  } catch (err) {
    console.error(`[parseProjectFiles] Failed to parse POU: ${file.relativePath}`, err)
    // Fallback: preserve as much data as possible
    try {
      const pouName = getBaseNameFromPath(file.relativePath)
      return createFallbackPou(file.content, language, pouType, pouName)
    } catch (fallbackErr) {
      console.error(`[parseProjectFiles] Fallback also failed: ${file.relativePath}`, fallbackErr)
      return null
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// POU deduplication
// ---------------------------------------------------------------------------

/**
 * Deduplicate POU files: when both a text-based file (.st, .il, etc.) and
 * a JSON file exist for the same POU name, the text-based file wins.
 * This matches the old backend's readDirectoryRecursive behavior.
 */
function deduplicatePouFiles(pouFiles: RawProjectFile[]): RawProjectFile[] {
  const pouNameMap = new Map<string, { index: number; isTextBased: boolean }>()
  const result: RawProjectFile[] = []

  for (const file of pouFiles) {
    const ext = file.relativePath.split('.').pop()?.toLowerCase() ?? ''
    const baseName = getBaseNameFromPath(file.relativePath)
    const isTextBased = ext !== 'json'
    const existing = pouNameMap.get(baseName)

    if (existing) {
      if (isTextBased && !existing.isTextBased) {
        // Replace JSON entry with text-based entry
        result[existing.index] = file
        pouNameMap.set(baseName, { index: existing.index, isTextBased })
      }
      // If existing is text-based and new is JSON, skip the JSON
    } else {
      pouNameMap.set(baseName, { index: result.length, isTextBased })
      result.push(file)
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parse raw project files into the structured data that handleOpenProjectResponse expects.
 *
 * @param projectPath - Absolute path to the project directory
 * @param projectJson - Raw content of project.json
 * @param deviceConfig - Raw content of devices/configuration.json
 * @param pinMapping - Raw content of devices/pin-mapping.json
 * @param pouFiles - Raw POU files (.st, .il, .ld, .fbd, .py, .cpp, .json)
 * @param serverFiles - Raw server config files from devices/servers/
 * @param remoteDeviceFiles - Raw remote device config files from devices/remote/
 */
export function parseProjectFiles(
  projectPath: string,
  projectJson: string,
  deviceConfig: string,
  pinMapping: string,
  pouFiles: RawProjectFile[],
  serverFiles: RawProjectFile[],
  remoteDeviceFiles: RawProjectFile[],
): ParsedProjectData {
  // Parse project.json
  let project: { meta?: { name?: string; type?: string }; data?: Record<string, unknown> } = {}
  try {
    project = projectJson ? (JSON.parse(projectJson) as typeof project) : {}
  } catch {
    project = {}
  }

  const meta = {
    name: project.meta?.name ?? '',
    type: (project.meta?.type ?? 'plc-project') as 'plc-project' | 'plc-library',
    path: projectPath,
  }

  // Parse device configuration
  let deviceConfiguration: DeviceConfiguration | undefined
  try {
    deviceConfiguration = deviceConfig ? (JSON.parse(deviceConfig) as DeviceConfiguration) : undefined
  } catch {
    deviceConfiguration = undefined
  }

  // Parse pin mapping
  let devicePinMapping: DevicePin[] | undefined
  try {
    devicePinMapping = pinMapping ? (JSON.parse(pinMapping) as DevicePin[]) : undefined
  } catch {
    devicePinMapping = undefined
  }

  // Deduplicate POU files (prefer text-based over JSON when both exist)
  const filteredPouFiles = deduplicatePouFiles(pouFiles)

  // Parse POU files
  const pous: (PLCPou & { variablesText?: string })[] = []
  for (const file of filteredPouFiles) {
    const pou = parsePouFile(file)
    if (pou) {
      // Ensure all POUs have a name (derive from filename if missing)
      if (!pou.name) {
        pou.name = getBaseNameFromPath(file.relativePath)
      }
      pous.push(pou)
    }
  }

  // Parse server configs with Zod validation (matching old backend behavior)
  const servers: PLCServer[] = []
  for (const file of serverFiles) {
    try {
      const parsed = JSON.parse(file.content) as unknown
      const result = PLCServerSchema.safeParse(parsed)
      if (result.success) {
        servers.push(result.data)
      }
    } catch {
      // Silently skip invalid server files
    }
  }

  // Parse remote device configs with Zod validation (matching old backend behavior)
  const remoteDevices: PLCRemoteDevice[] = []
  for (const file of remoteDeviceFiles) {
    try {
      const parsed = JSON.parse(file.content) as unknown
      const result = PLCRemoteDeviceSchema.safeParse(parsed)
      if (result.success) {
        remoteDevices.push(result.data)
      }
    } catch {
      // Silently skip invalid remote device files
    }
  }

  // Extract project data fields
  const data = project.data ?? {}
  const configuration = (data.configuration ??
    data.configurations ?? {
      resource: { tasks: [], instances: [], globalVariables: [] },
    }) as ParsedProjectData['projectData']['configurations']

  // Ensure resource has all required fields
  if (!configuration.resource) {
    configuration.resource = { tasks: [], instances: [], globalVariables: [] }
  }
  if (!configuration.resource.tasks) configuration.resource.tasks = []
  if (!configuration.resource.instances) configuration.resource.instances = []
  if (!configuration.resource.globalVariables) configuration.resource.globalVariables = []

  return {
    meta,
    projectData: {
      dataTypes: (data.dataTypes as PLCDataType[]) ?? [],
      pous,
      configurations: configuration,
      servers: servers.length > 0 ? servers : (data.servers as PLCServer[]) ?? [],
      remoteDevices: remoteDevices.length > 0 ? remoteDevices : (data.remoteDevices as PLCRemoteDevice[]) ?? [],
      debugVariables: data.debugVariables as ParsedProjectData['projectData']['debugVariables'],
    },
    deviceConfiguration,
    devicePinMapping,
  }
}
