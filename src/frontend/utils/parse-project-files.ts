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
  PLCServer,
  PLCTask,
  PLCVariable,
} from '../../middleware/shared/ports/types'
import {
  detectLanguageFromExtension,
  parseGraphicalPouFromString,
  parseHybridPouFromString,
  parseTextualPouFromString,
} from './PLC/pou-text-parser'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedProjectData {
  meta: {
    name: string
    type: 'plc-project' | 'plc-library'
    path: string
  }
  projectData: {
    dataTypes: PLCDataType[]
    pous: PLCPou[]
    configurations: {
      resource: {
        tasks: PLCTask[]
        instances: PLCInstance[]
        globalVariables: PLCVariable[]
      }
    }
    servers?: PLCServer[]
    remoteDevices?: unknown[]
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
 * e.g., 'pous/programs/main.st' → 'program'
 */
function detectPouTypeFromPath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/')
  if (normalized.includes('pous/programs/')) return 'program'
  if (normalized.includes('pous/functions/') && !normalized.includes('pous/function-blocks/')) return 'function'
  if (normalized.includes('pous/function-blocks/')) return 'function-block'
  return 'program' // fallback
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
 * Parse a single POU file from its raw text content.
 * Returns null if the file format is not recognized.
 */
function parsePouFile(file: RawProjectFile): PLCPou | null {
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
    // Fallback: create a minimal POU with raw body
    return {
      name: file.relativePath.split('/').pop()?.replace(/\.\w+$/, '') ?? 'unknown',
      pouType: pouType as PLCPou['pouType'],
      interface: { variables: [] },
      body: { language: language as PLCPou['body']['language'], value: file.content },
      documentation: '',
    }
  }

  return null
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

  // Parse POU files
  const pous: PLCPou[] = []
  for (const file of pouFiles) {
    const pou = parsePouFile(file)
    if (pou) {
      pous.push(pou)
    }
  }

  // Parse server configs
  const servers: PLCServer[] = []
  for (const file of serverFiles) {
    try {
      const server = JSON.parse(file.content) as PLCServer
      servers.push(server)
    } catch {
      console.error(`[parseProjectFiles] Failed to parse server: ${file.relativePath}`)
    }
  }

  // Parse remote device configs
  const remoteDevices: unknown[] = []
  for (const file of remoteDeviceFiles) {
    try {
      const device = JSON.parse(file.content) as unknown
      remoteDevices.push(device)
    } catch {
      console.error(`[parseProjectFiles] Failed to parse remote device: ${file.relativePath}`)
    }
  }

  // Extract project data fields
  const data = project.data ?? {}
  const configuration = (data.configuration ?? data.configurations ?? {
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
      remoteDevices: remoteDevices.length > 0 ? remoteDevices : (data.remoteDevices as unknown[]) ?? [],
      debugVariables: data.debugVariables as ParsedProjectData['projectData']['debugVariables'],
    },
    deviceConfiguration,
    devicePinMapping,
  }
}
