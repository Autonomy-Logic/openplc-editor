/**
 * Parses raw project file contents into the structured data `handleOpenProjectResponse`
 * expects — the single source of truth for project parsing on both Electron and web.
 */

import { parseDataTypeFromText } from '../../../frontend/utils/PLC/data-type-declarations'
import {
  detectLanguageFromExtension,
  extractDocumentation,
  extractVariablesSection,
  isGraphicalBodyShape,
  matchPouHeader,
  parseGraphicalPouFromString,
  parseHybridPouFromString,
  parseTextualPouFromString,
  POU_END_KEYWORDS,
} from '../../../frontend/utils/PLC/pou-text-parser'
import type { RawProjectFile } from '../../../middleware/shared/ports/project-port'
import type {
  DeviceConfiguration,
  DevicePin,
  PLCDataType,
  PLCGlobalVariableList,
  PLCInstance,
  PLCPou,
  PLCRemoteDevice,
  PLCServer,
  PLCTask,
  PLCVariable,
} from '../../../middleware/shared/ports/types'
import { deviceConfigurationSchema, pinMappingFileSchema } from '../types/PLC/devices'
import { PLCProjectSchema, PLCRemoteDeviceSchema, PLCServerSchema } from '../types/PLC/open-plc'
import { getDefaultSchemaValues } from './default-zod-schema-values'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FallbackPou = PLCPou & { variablesText?: string }

/**
 * Thrown when a POU's body is unrecoverable (unparsable JSON), not merely malformed variable
 * declarations: an empty substitute body would look like a legitimately empty diagram and let
 * the next save overwrite the real one.
 */
export class UnrecoverablePouError extends Error {
  constructor(
    message: string,
    readonly relativePath: string,
  ) {
    super(message)
    this.name = 'UnrecoverablePouError'
  }
}

/** The first few zod issues as `path: message`, for a one-line reason. */
function describeZodIssues(error: { issues: { path: (string | number | symbol)[]; message: string }[] }): string {
  const shown = error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ')
  return error.issues.length > 3 ? `${shown}; +${error.issues.length - 3} more` : shown
}

export interface ParsedProjectData {
  meta: {
    name: string
    type: 'plc-project' | 'plc-library'
    path: string
  }
  projectData: {
    dataTypes: PLCDataType[]
    globalVariableLists: PLCGlobalVariableList[]
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
    /** Per-project library enablement; defaults to `[]` for legacy projects — bundled libs are
     *  always-on regardless of this list. */
    libraries: { name: string; version: string }[]
    /** Raw `library.json` bytes, library projects only. Empty string when the file is missing
     *  on disk — the manifest editor seeds a template on first edit. */
    libraryManifest?: string
    debugVariables?: { global?: string[]; pous?: Record<string, string[]> }
  }
  /** POUs that could not be parsed at all — non-empty means the project must NOT open with
   *  content (see `UnrecoverablePouError`); distinct from recoverable `warnings`. */
  fatalErrors?: string[]
  deviceConfiguration?: DeviceConfiguration
  /** Pin mappings from `devices/pin-mapping.json`, forwarded to `setDeviceDefinitions`, which
   *  accepts both the legacy flat `DevicePin[]` and the canonical per-board `Record<string, DevicePin[]>`. */
  devicePinMapping?: DevicePin[] | Record<string, DevicePin[]>
  /** Warnings collected during parsing (e.g. dropped files that failed validation). */
  warnings?: string[]
  /** `datatypes/*.dt` files that failed to parse; preserved raw so the save flow can echo
   *  them back verbatim instead of silently dropping them from disk. */
  unparsedDataTypeFiles?: RawProjectFile[]
  /** Server / remote-device files that could not be read.  A skipped file is
   *  invisible in `projectData`, so a caller that writes the project back
   *  overwrites a config it never saw.  Separate from `warnings` so a caller
   *  can refuse rather than parse prose. */
  unreadableProtocolFiles?: { relativePath: string; reason: string }[]
  /** True when the project still carries its data types inline in `project.json` with no
   *  `datatypes/*.dt` on disk; the save flow migrates the whole set at once (see `executeSaveFile`). */
  dataTypesNeedMigration?: boolean
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
 *
 * Splits on both `\` and `/`: the desktop reader builds relative paths with `path.join`,
 * which emits backslashes on Windows.
 */
function getBaseNameFromPath(relativePath: string): string {
  return (
    relativePath
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.\w+$/, '') ?? 'unknown'
  )
}

/** A plain IEC 61131-3 identifier — the only shape safe to use as a file name. */
const iecIdentifierRegex = /^[A-Za-z_]\w*$/

/**
 * A `datatypes/*.dt` file wins for the type it declares, even an unparsed one; types left only
 * in the legacy inline `project.json` list are appended, so a half-migrated project keeps all.
 */
function mergeDataTypes(
  fromFiles: PLCDataType[],
  fromProjectJson: PLCDataType[],
  dataTypeFiles: RawProjectFile[],
): PLCDataType[] {
  if (dataTypeFiles.length === 0) return fromProjectJson
  const ownedByAFile = new Set(dataTypeFiles.map((file) => getBaseNameFromPath(file.relativePath).toLowerCase()))
  return [...fromFiles, ...fromProjectJson.filter((dt) => !ownedByAFile.has(dt.name.toLowerCase()))]
}

// ---------------------------------------------------------------------------
// Fallback POU creation
// ---------------------------------------------------------------------------

/**
 * Recreates a POU from raw content when normal parsing fails, preserving documentation,
 * raw variable text, and body as best-effort.
 */
function createFallbackPou(content: string, language: string, pouType: string, pouName: string): FallbackPou {
  // 1. Documentation, header and declarations, through the same helpers the
  //    successful path uses. They were written out a second time here and had
  //    already drifted: this copy sliced the declarations from the `VAR`
  //    keyword rather than from the start of its line, so a POU that failed to
  //    parse came back re-indented on the next save while the others did not.
  const { documentation, remainingContent } = extractDocumentation(content)

  const header = matchPouHeader(remainingContent, pouType)
  const section = extractVariablesSection(remainingContent, header ? header.text.length : 0, {
    boundAtGraphicalBody: language === 'ld' || language === 'fbd',
  })
  // An empty block, not an empty string: this text is what the code view opens
  // on, and it has to be something the user can add a declaration to.
  const variablesText = section.text === '' ? 'VAR\nEND_VAR' : section.text
  const bodyStartIndex = section.bodyStartIndex

  // 2. Extract body content
  const endKeyword = POU_END_KEYWORDS[pouType]
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
      // Valid JSON isn't enough: an object of the wrong language's shape (or null) would pass
      // `JSON.parse` and only fail later, deep in a consumer.
      if (!isGraphicalBodyShape(bodyValue, language)) {
        throw new SyntaxError(
          `body is not a valid ${language.toUpperCase()} diagram (expected ${
            language === 'ld'
              ? 'an object with a "rungs" array'
              : 'an object with a "rung" object holding a "nodes" array'
          })`,
        )
      }
    } catch (bodyErr) {
      throw new UnrecoverablePouError(
        bodyErr instanceof Error ? bodyErr.message : String(bodyErr),
        `${pouName}${language === 'ld' ? '.ld' : '.fbd'}`,
      )
    }
  } else if (language === 'st' || language === 'il' || language === 'python' || language === 'cpp') {
    const endRegex = new RegExp(`\\b${endKeyword}\\b`, 'i')
    const endMatch = remainingContent.slice(bodyStartIndex).search(endRegex)
    bodyValue =
      endMatch !== -1
        ? remainingContent.slice(bodyStartIndex, bodyStartIndex + endMatch).trim()
        : remainingContent.slice(bodyStartIndex).trim()
  } else {
    /* istanbul ignore next -- defensive: unreachable via public API (getLanguageFromExt filters to the 6 languages handled above) */
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
    // An explicit marker, because "has text and no variables" stopped meaning
    // "did not parse" the moment every loaded POU started carrying its text.
    // An empty POU has both, and was being forced into the code view on open
    // (DOPE-650) — which is exactly the POU a user is most likely to have, now
    // that an empty one compiles.
    variablesTextUnparsed: true,
  }
}

// ---------------------------------------------------------------------------
// POU file parsing
// ---------------------------------------------------------------------------

/** Parses a single POU file; returns null if unrecognized, falls back to `createFallbackPou` on parse failure. */
/**
 * Legacy two-field (`location` + `alias`) variables to the single-field model: an alias-bound
 * variable's alias name is folded into `location`. Producer channels keep `alias` alone.
 * Idempotent.
 */
function foldLegacyVariableAliases(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(foldLegacyVariableAliases)
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const isLegacyAliasBound = typeof obj.location === 'string' && typeof obj.alias === 'string' && obj.alias.length > 0
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(obj)) {
      if (isLegacyAliasBound && key === 'alias') continue
      if (isLegacyAliasBound && key === 'location') {
        out.location = obj.alias as string
        continue
      }
      out[key] = foldLegacyVariableAliases(child)
    }
    return out
  }
  return value
}

function parsePouFile(
  file: RawProjectFile,
  warnings: string[],
  fatalErrors: string[],
): (PLCPou & { variablesText?: string }) | null {
  const ext = file.relativePath.split('.').pop()?.toLowerCase()
  /* istanbul ignore if -- defensive: parseProjectFiles upstream only forwards files whose
     extension matched the POU file glob; an extension-less file path can never reach here */
  if (!ext) return null

  const pouType = detectPouTypeFromPath(file.relativePath)

  // Legacy JSON format
  if (ext === 'json') {
    try {
      const parsed = foldLegacyVariableAliases(JSON.parse(file.content))
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
    const pouName = getBaseNameFromPath(file.relativePath)
    const reason =
      err instanceof Error ? err.message : /* istanbul ignore next -- every parser throw site uses Error */ String(err)
    // Surface the failure instead of silently loading with no variables; textual POUs still
    // have their raw declarations in `variablesText` for the user to fix.
    warnings.push(
      language === 'st' || language === 'il'
        ? `POU "${pouName}" (${file.relativePath}) could not be fully parsed: ${reason} Its variable declarations were preserved as raw text — open the POU's variables editor in code view, fix the declaration, and save.`
        : `POU "${pouName}" (${file.relativePath}) could not be fully parsed and was loaded with partial data: ${reason}`,
    )
    // Fallback: preserve as much data as possible
    try {
      return createFallbackPou(file.content, language, pouType, pouName)
    } catch (fallbackErr) {
      // Unrecoverable body: replace the earlier "partial data" warning with a fatal error so the
      // caller opens the project empty instead of over content that cannot be repaired.
      if (fallbackErr instanceof UnrecoverablePouError) {
        warnings.pop()
        fatalErrors.push(
          `POU "${pouName}" (${file.relativePath}) could not be parsed and the project was not opened: ${fallbackErr.message}`,
        )
        return null
      }
      /* istanbul ignore next -- defensive: createFallbackPou itself is non-throwing for any
         (content, language, pouType, pouName) tuple producible by getLanguageFromExt */
      console.error(`[parseProjectFiles] Fallback also failed: ${file.relativePath}`, fallbackErr)
      /* istanbul ignore next -- paired with the catch above */
      return null
    }
  }

  /* istanbul ignore next -- unreachable: the try block above either returns or throws into the
     catch which itself returns; this fallthrough exists only because TS narrowing of the
     `language` union doesn't carry through into the catch's return-coverage analysis */
  return null
}

// ---------------------------------------------------------------------------
// POU deduplication
// ---------------------------------------------------------------------------

/** When both a text-based file (.st, .il, …) and a JSON file exist for the same POU name, the text-based file wins. */
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
 * @param pouFiles - Raw POU files (.st, .il, .ld, .fbd, .py, .cpp, .json)
 * @param dataTypeFiles - When present, wins over the legacy `project.json` `data.dataTypes` field
 */
export function parseProjectFiles(
  projectPath: string,
  projectJson: string,
  deviceConfig: string,
  pinMapping: string,
  pouFiles: RawProjectFile[],
  serverFiles: RawProjectFile[],
  remoteDeviceFiles: RawProjectFile[],
  libraryManifest: string = '',
  dataTypeFiles: RawProjectFile[] = [],
): ParsedProjectData {
  const warnings: string[] = []
  const fatalErrors: string[] = []

  let project: { meta?: { name?: string; type?: string }; data?: Record<string, unknown> }
  try {
    const raw = projectJson ? foldLegacyVariableAliases(JSON.parse(projectJson)) : null
    if (raw) {
      const result = PLCProjectSchema.safeParse(raw)
      if (result.success) {
        project = result.data as typeof project
      } else {
        console.error('[parseProjectFiles] project.json Zod errors:', result.error.issues)
        warnings.push('project.json has invalid structure and was loaded with defaults.')
        project = getDefaultSchemaValues(PLCProjectSchema) as typeof project
      }
    } else {
      // Absent is not the same as valid: flag it rather than silently opening a default
      // project indistinguishable from a real empty one.
      warnings.push('project.json was missing or empty. The project was opened with default settings.')
      project = getDefaultSchemaValues(PLCProjectSchema) as typeof project
    }
  } catch {
    warnings.push('project.json is malformed and could not be read. Using defaults.')
    project = getDefaultSchemaValues(PLCProjectSchema) as typeof project
  }

  const metaType: 'plc-project' | 'plc-library' = project.meta?.type === 'plc-library' ? 'plc-library' : 'plc-project'
  const meta = {
    name: project.meta?.name ?? '',
    type: metaType,
    path: projectPath,
  }

  // Parse and Zod-validate device configuration
  let deviceConfiguration: DeviceConfiguration | undefined
  try {
    const raw = deviceConfig ? (JSON.parse(deviceConfig) as unknown) : null
    if (raw) {
      const result = deviceConfigurationSchema.safeParse(raw)
      if (result.success) {
        deviceConfiguration = result.data
      } else {
        console.error('[parseProjectFiles] devices/configuration.json Zod errors:', result.error.issues)
        warnings.push('devices/configuration.json has invalid structure and was loaded with defaults.')
        deviceConfiguration = getDefaultSchemaValues(deviceConfigurationSchema) as DeviceConfiguration
      }
    } else {
      deviceConfiguration = getDefaultSchemaValues(deviceConfigurationSchema) as DeviceConfiguration
    }
  } catch {
    warnings.push('devices/configuration.json is malformed and could not be read. Using defaults.')
    deviceConfiguration = getDefaultSchemaValues(deviceConfigurationSchema) as DeviceConfiguration
  }

  let devicePinMapping: DevicePin[] | Record<string, DevicePin[]> | undefined
  try {
    const raw = pinMapping ? (JSON.parse(pinMapping) as unknown) : null
    if (raw) {
      const result = pinMappingFileSchema.safeParse(raw)
      if (result.success) {
        devicePinMapping = result.data
      } else {
        console.error('[parseProjectFiles] devices/pin-mapping.json Zod errors:', result.error.issues)
        warnings.push('devices/pin-mapping.json has invalid structure and was loaded with defaults.')
        devicePinMapping = {}
      }
    } else {
      devicePinMapping = {}
    }
  } catch {
    warnings.push('devices/pin-mapping.json is malformed and could not be read. Using defaults.')
    devicePinMapping = {}
  }

  // Deduplicate POU files (prefer text-based over JSON when both exist)
  const filteredPouFiles = deduplicatePouFiles(pouFiles)

  // Parse POU files
  const pous: (PLCPou & { variablesText?: string })[] = []
  for (const file of filteredPouFiles) {
    const pou = parsePouFile(file, warnings, fatalErrors)
    if (pou) {
      // Ensure all POUs have a name (derive from filename if missing)
      if (!pou.name) {
        pou.name = getBaseNameFromPath(file.relativePath)
      }
      pous.push(pou)
    }
  }

  const unreadableProtocolFiles: { relativePath: string; reason: string }[] = []

  const servers: PLCServer[] = []
  for (const file of serverFiles) {
    try {
      const parsed = JSON.parse(file.content) as unknown
      const result = PLCServerSchema.safeParse(parsed)
      if (result.success) {
        servers.push(result.data)
      } else {
        console.error(`[parseProjectFiles] Server "${file.relativePath}" Zod errors:`, result.error.issues)
        warnings.push(`Server file "${file.relativePath}" has invalid configuration and was skipped.`)
        unreadableProtocolFiles.push({ relativePath: file.relativePath, reason: describeZodIssues(result.error) })
      }
    } catch {
      warnings.push(`Server file "${file.relativePath}" is not valid JSON and was skipped.`)
      unreadableProtocolFiles.push({ relativePath: file.relativePath, reason: 'not valid JSON' })
    }
  }

  const remoteDevices: PLCRemoteDevice[] = []
  for (const file of remoteDeviceFiles) {
    try {
      const parsed = JSON.parse(file.content) as unknown
      const result = PLCRemoteDeviceSchema.safeParse(parsed)
      if (result.success) {
        remoteDevices.push(result.data)
      } else {
        console.error(`[parseProjectFiles] Remote device "${file.relativePath}" Zod errors:`, result.error.issues)
        warnings.push(`Remote device file "${file.relativePath}" has invalid configuration and was skipped.`)
        unreadableProtocolFiles.push({ relativePath: file.relativePath, reason: describeZodIssues(result.error) })
      }
    } catch {
      warnings.push(`Remote device file "${file.relativePath}" is not valid JSON and was skipped.`)
      unreadableProtocolFiles.push({ relativePath: file.relativePath, reason: 'not valid JSON' })
    }
  }

  // A name mismatch or parse failure preserves the raw file so save can write it back verbatim.
  const dataTypesFromFiles: PLCDataType[] = []
  const unparsedDataTypeFiles: RawProjectFile[] = []
  for (const file of dataTypeFiles) {
    const expectedName = getBaseNameFromPath(file.relativePath)
    const result = parseDataTypeFromText(file.content, expectedName)
    if (result.dataType) {
      dataTypesFromFiles.push(result.dataType)
    } else {
      warnings.push(
        `Data type file "${file.relativePath}" could not be parsed and was preserved as-is: ${result.error ?? 'unknown error'}`,
      )
      unparsedDataTypeFiles.push(file)
    }
  }

  // Extract project data fields
  const data = project.data ?? {}
  const configuration = (data.configuration ??
    data.configurations ?? {
      resource: { tasks: [], instances: [], globalVariables: [] },
    }) as ParsedProjectData['projectData']['configurations']

  /* istanbul ignore if -- defensive: PLCProjectSchema requires resource, so this is unreachable */
  if (!configuration.resource) {
    configuration.resource = { tasks: [], instances: [], globalVariables: [] }
  }
  /* istanbul ignore next -- defensive: PLCConfigurationSchema requires tasks/instances/
     globalVariables as arrays, so post-Zod the fields are always populated.  Kept as a guard
     against future schema changes that loosen the constraints. */
  if (!configuration.resource.tasks) configuration.resource.tasks = []
  /* istanbul ignore next -- defensive guard, same rationale as above */
  if (!configuration.resource.instances) configuration.resource.instances = []
  /* istanbul ignore next -- defensive guard, same rationale as above */
  if (!configuration.resource.globalVariables) configuration.resource.globalVariables = []

  // `data.dataTypes[].name` becomes a path segment (`datatypes/<name>.dt`) on save; reject
  // anything that isn't a plain IEC identifier here to block directory traversal via `..` or a separator.
  const legacyDataTypes: PLCDataType[] = []
  for (const dt of (data.dataTypes as PLCDataType[]) ?? []) {
    if (iecIdentifierRegex.test(dt.name)) {
      legacyDataTypes.push(dt)
      continue
    }
    warnings.push(`Data type "${dt.name}" in project.json has an invalid name and was skipped.`)
  }

  return {
    meta,
    projectData: {
      dataTypes: mergeDataTypes(dataTypesFromFiles, legacyDataTypes, dataTypeFiles),
      // Assembled field-by-field: anything not named here is dropped on load regardless of
      // how well the schema validates it.
      globalVariableLists: (data.globalVariableLists as PLCGlobalVariableList[]) ?? [],
      pous,
      configurations: configuration,
      servers: servers.length > 0 ? servers : ((data.servers as PLCServer[]) ?? []),
      remoteDevices: remoteDevices.length > 0 ? remoteDevices : ((data.remoteDevices as PLCRemoteDevice[]) ?? []),
      libraries: (data.libraries as ParsedProjectData['projectData']['libraries']) ?? [],
      ...(metaType === 'plc-library' ? { libraryManifest } : {}),
      debugVariables: data.debugVariables as ParsedProjectData['projectData']['debugVariables'],
    },
    deviceConfiguration,
    devicePinMapping,
    warnings: warnings.length > 0 ? warnings : undefined,
    fatalErrors: fatalErrors.length > 0 ? fatalErrors : undefined,
    ...(unparsedDataTypeFiles.length > 0 ? { unparsedDataTypeFiles } : {}),
    ...(unreadableProtocolFiles.length > 0 ? { unreadableProtocolFiles } : {}),
    ...(dataTypeFiles.length === 0 && legacyDataTypes.length > 0 ? { dataTypesNeedMigration: true } : {}),
  }
}
