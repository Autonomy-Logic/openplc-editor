/**
 * Frontend Project File Parser
 *
 * Parses raw project file contents (strings) into the structured data
 * that handleOpenProjectResponse expects. This is the single source of
 * truth for project parsing — both Electron and web use this.
 *
 * The backend only reads raw files from disk; all parsing happens here.
 */

import { parseDataTypeFromText } from '../../../frontend/utils/PLC/data-type-text-parser'
import {
  detectLanguageFromExtension,
  findGraphicalBodyStartIndex,
  findLastEndVarIndex,
  isGraphicalBodyShape,
  parseGraphicalPouFromString,
  parseHybridPouFromString,
  parseTextualPouFromString,
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
 * Thrown when a POU cannot be recovered at all, as opposed to a POU whose
 * *declarations* are malformed.
 *
 * The distinction drives what the editor does on open (DOPE-592):
 *
 * - **Recoverable** — the variable declarations don't parse. The body is
 *   intact, so the project opens normally and the offending variables table
 *   opens in text mode for the user to fix. `createFallbackPou` keeps the raw
 *   declarations in `variablesText` for exactly this.
 * - **Unrecoverable** — a graphical POU's JSON body doesn't parse. There is
 *   nothing to show and nothing to edit. Substituting an empty body here would
 *   render a blank canvas indistinguishable from a legitimately empty POU, and
 *   the first save would write that emptiness over the user's real diagram.
 *   The project must not open with content in this state.
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
    /** Per-project library enablement.  Defaults to `[]` for legacy
     *  projects that don't carry the field on disk — bundled libs
     *  are always-on regardless. */
    libraries: { name: string; version: string }[]
    /** Raw library manifest content (the bytes of `library.json` at
     *  the project root).  Set for library projects only — same
     *  shape POU bodies live in: text content held in the store,
     *  serialised verbatim to its own file by the save pipeline,
     *  not embedded in `project.json`.  Empty string when the file
     *  was missing on disk (the manifest editor's load effect
     *  seeds a template on first edit). */
    libraryManifest?: string
    debugVariables?: { global?: string[]; pous?: Record<string, string[]> }
  }
  /** POUs that could not be parsed at all. Non-empty means the project must
   *  NOT be opened with content: see `UnrecoverablePouError`. Distinct from
   *  `warnings`, which are recoverable and open normally. */
  fatalErrors?: string[]
  deviceConfiguration?: DeviceConfiguration
  /** Pin mappings parsed from `devices/pin-mapping.json`. Forwarded
   *  to the store's `setDeviceDefinitions`, which accepts BOTH:
   *  - `DevicePin[]` (legacy flat array, pre-per-board-scoping) —
   *    gets keyed under `deviceConfiguration.deviceBoard` on load.
   *  - `Record<string, DevicePin[]>` (per-board dict, canonical) —
   *    taken verbatim, one entry per target the user has touched. */
  devicePinMapping?: DevicePin[] | Record<string, DevicePin[]>
  /** Warnings collected during parsing (e.g. dropped files that failed validation). */
  warnings?: string[]
  /** `datatypes/*.dt` files that failed to parse (or whose declared
   *  name mismatched the file name).  Preserved raw so the save flow
   *  can echo them back verbatim — an unreadable file must never be
   *  silently dropped from disk. */
  unparsedDataTypeFiles?: RawProjectFile[]
  /** True when the project still carries its data types inline in
   *  `project.json` and has no `datatypes/*.dt` on disk — i.e. it predates
   *  DOPE-385 and has never been saved by a `.dt`-writing build. The save
   *  flow reads this to migrate the whole set at once rather than leaving a
   *  half-migrated project behind (see `executeSaveFile`). */
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
 * Splits on BOTH separators: the desktop reader builds relative paths with
 * `path.join`, which emits backslashes on Windows, so a `/`-only split would
 * return the whole `pous\functions\Name` path as the "basename" — the origin of
 * the POU name→path corruption in the "deleting function" bug.
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
 * Fold the legacy inline `project.json` data type list in behind the
 * `datatypes/*.dt` files.
 *
 * A `.dt` file is always authoritative for the type it declares. Anything left
 * only in the inline list is appended, so a project that is HALF migrated — one
 * `.dt` written by a single-file save, or a batch that failed part-way — keeps
 * every type instead of losing the ones that have no file yet. Once a project
 * is fully migrated its inline list is `[]` and this returns the files verbatim.
 *
 * A name owned by an UNPARSED `.dt` is excluded as well: the file is the newer
 * truth even though it cannot be read, and the save flow echoes it back
 * verbatim, so resurrecting the stale inline copy beside it would show the user
 * a version that no longer exists on disk.
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
    // Graphical bodies bound the scan at the JSON, for the reason spelled out on
    // `findLastEndVarIndex`: without it this fallback repeats the very failure it
    // exists to recover from (DOPE-592).
    const bodyStart =
      language === 'ld' || language === 'fbd' ? findGraphicalBodyStartIndex(remainingContent, varStartIndex) : -1
    const lastEnd = findLastEndVarIndex(remainingContent, varStartIndex, bodyStart === -1 ? undefined : bodyStart)
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
      // Valid JSON is not enough. LD consumers read `value.rungs`, FBD
      // consumers read `value.rung.nodes`; anything else (`null`, an object of
      // the *other* language's shape) sails through `JSON.parse` and only fails
      // later, deep in a consumer — which is the same class of bug this whole
      // change exists to remove. Reject it here, where it is still nameable.
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
      // Unrecoverable: see `UnrecoverablePouError`. The old behaviour
      // substituted `{ nodes: [], edges: [], viewport }` here, which is the FBD
      // shape — for a ladder POU it has no `rungs` at all, and it is what made
      // a failed parse look like an empty diagram the user could then save over.
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
/**
 * Migrate legacy variables from the two-field (`location` + `alias`) model to
 * the single-field model, where `location` holds the binding itself — the
 * alias name for an alias-bound variable, a literal `%addr` for a manual one.
 *
 * Any object that carries BOTH a string `location` and a non-empty string
 * `alias` is a legacy alias-bound PLCVariable: its alias name is folded into
 * `location` and the `alias` field dropped. Objects with `alias` but no
 * `location` (producer channels: pins, VPP entries, Modbus points, EtherCAT
 * mappings) keep their alias untouched. Manual variables (empty alias) keep
 * their literal `location`.
 *
 * Generic, idempotent deep walk: projects already in the single-field form
 * (no `alias` on variables) pass through unchanged, so it is safe to run on
 * every load.
 */
function foldLegacyVariableAliases(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(foldLegacyVariableAliases)
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const isLegacyAliasBound = typeof obj.location === 'string' && typeof obj.alias === 'string' && obj.alias.length > 0
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(obj)) {
      if (isLegacyAliasBound && key === 'alias') continue // fold away
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
    // Surface the failure on project open (the console panel shows these
    // warnings) instead of silently loading the POU with no variables —
    // GitHub issue #904. For textual POUs the raw declarations survive in
    // `variablesText`, so point the user at the in-app repair path.
    warnings.push(
      language === 'st' || language === 'il'
        ? `POU "${pouName}" (${file.relativePath}) could not be fully parsed: ${reason} Its variable declarations were preserved as raw text — open the POU's variables editor in code view, fix the declaration, and save.`
        : `POU "${pouName}" (${file.relativePath}) could not be fully parsed and was loaded with partial data: ${reason}`,
    )
    // Fallback: preserve as much data as possible
    try {
      return createFallbackPou(file.content, language, pouType, pouName)
    } catch (fallbackErr) {
      // An unrecoverable body is not a warning: there is nothing to show and
      // nothing to repair in-app, and opening with a blank canvas would invite
      // a save that destroys the original (DOPE-592). Drop the warning pushed
      // above — it says "loaded with partial data", which is now untrue — and
      // report it as fatal so the caller opens the editor empty instead.
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
 * @param libraryManifest - Raw content of library.json (library projects)
 * @param dataTypeFiles - Raw datatypes/*.dt files; when any are present they
 *   win over the legacy `project.json` `data.dataTypes` field
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

  // Parse and Zod-validate project.json (matches old backend safeParseProjectFile behavior)
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

  // Parse and Zod-validate pin mapping. The on-disk schema is a union
  // of `Record<string, DevicePin[]>` (canonical per-board dict) and
  // `DevicePin[]` (legacy flat array). The store-side
  // `setDeviceDefinitions` accepts both shapes; the legacy branch is
  // keyed under whatever `configuration.deviceBoard` resolves to on
  // first load and rewritten in the dict shape on next save.
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

  // Parse server configs with Zod validation (matching old backend behavior)
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
      }
    } catch {
      // Skip unparseable JSON files
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
      } else {
        console.error(`[parseProjectFiles] Remote device "${file.relativePath}" Zod errors:`, result.error.issues)
        warnings.push(`Remote device file "${file.relativePath}" has invalid configuration and was skipped.`)
      }
    } catch {
      // Skip unparseable JSON files
    }
  }

  // Parse data type files (datatypes/<Name>.dt).  Own loop — never
  // through parsePouFile (pou-path detection throws for datatypes/).
  // The declared name must match the file name; a mismatch or any
  // parse failure preserves the raw file so the save flow writes it
  // back verbatim instead of silently dropping it from disk.
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

  // Ensure resource has all required fields.  In practice unreachable: the Zod schema rejects
  // `{ resource: null }` and replaces the whole project with defaults upstream, so by the time we
  // get here `configuration.resource` is always populated.  Kept as a defensive guard against
  // future schema changes that loosen the constraint.
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

  // `data.dataTypes[].name` is unvalidated external input that the save flow
  // turns into a path segment (`datatypes/<name>.dt`). A name carrying `..` or
  // a separator would escape the project directory on the next save, so reject
  // anything that is not a plain IEC identifier at the boundary — the rule
  // CLAUDE.md states for every external payload. A type sourced from a `.dt`
  // file cannot reach here: its name comes from the file name and has already
  // been through the text parser's own identifier check.
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
      // Migration rule: a `.dt` file always wins for the type it declares,
      // and any type still only in the legacy `project.json` list rides along
      // beside it. Merging rather than replacing wholesale is what makes a
      // HALF-migrated project safe: a build that wrote one `.dt` and left the
      // inline list alone — or a save that failed part-way through writing
      // them — would otherwise drop every type that had no file yet.
      dataTypes: mergeDataTypes(dataTypesFromFiles, legacyDataTypes, dataTypeFiles),
      // Global Variable Lists ride along from project.json. Assembling `projectData`
      // field by field means anything not named here is dropped on load, however well
      // the schema validates it — which is how a list survived every unit test and then
      // vanished the moment a real converted project was opened.
      globalVariableLists: (data.globalVariableLists as PLCGlobalVariableList[]) ?? [],
      pous,
      configurations: configuration,
      servers: servers.length > 0 ? servers : ((data.servers as PLCServer[]) ?? []),
      remoteDevices: remoteDevices.length > 0 ? remoteDevices : ((data.remoteDevices as PLCRemoteDevice[]) ?? []),
      // Migration: legacy projects (no `libraries` field on disk)
      // load with an empty list — bundled / canonical strucpp libs
      // are always-on regardless, so the project compiles without
      // needing an explicit enablement record.
      libraries: (data.libraries as ParsedProjectData['projectData']['libraries']) ?? [],
      // Library projects own a `library.json` at the project root.
      // The raw bytes are threaded through here from the disk read
      // (same way the .st POU contents are) so the editor's store
      // has the manifest content the manifest tab + the save flow
      // both read.  Empty string when the file is missing on disk
      // — the manifest editor seeds a template before first save.
      ...(metaType === 'plc-library' ? { libraryManifest } : {}),
      debugVariables: data.debugVariables as ParsedProjectData['projectData']['debugVariables'],
    },
    deviceConfiguration,
    devicePinMapping,
    warnings: warnings.length > 0 ? warnings : undefined,
    fatalErrors: fatalErrors.length > 0 ? fatalErrors : undefined,
    ...(unparsedDataTypeFiles.length > 0 ? { unparsedDataTypeFiles } : {}),
    ...(dataTypeFiles.length === 0 && legacyDataTypes.length > 0 ? { dataTypesNeedMigration: true } : {}),
  }
}
