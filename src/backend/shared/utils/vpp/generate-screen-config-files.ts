/**
 * Runtime config files a VPP device declares for its custom screens.
 *
 * A device lists them in `hal.screenConfigs`, one entry per screen bucket:
 *
 *   { "storageId": "data-hub", "format": "variable-exports", "file": "data-hub" }
 *
 * The screen data lives in `project.data.vppExtensions[packageId][storageId]`,
 * and each entry becomes `conf/<plugin_name>.<file>.json` next to the plugin's
 * own config, which is where the runtime's VPP deployer looks for siblings.
 * The format names a generator compiled into the editor; a package never ships
 * code to produce its config.
 */

import { buildLeafInfoMap, parseDebugMap } from '../../../../frontend/utils/debug-parser'
import {
  buildDebugPath,
  buildGlobalDebugPath,
  findInstanceName,
  type PLCInstanceMapping,
} from '../../../../frontend/utils/debug-variable-finder'
import type { VppScreenConfigInputs } from '../../../../middleware/shared/ports/compiler-platform-port'

export const SCREEN_CONFIG_FORMATS = ['variable-exports'] as const
export type ScreenConfigFormat = (typeof SCREEN_CONFIG_FORMATS)[number]

export interface ScreenConfigDeclaration {
  storageId: string
  format: ScreenConfigFormat
  file: string
}

export interface DebugEntry {
  arr: number
  elem: number
  datatype: string
}

export interface ScreenConfigFilesResult {
  /** Bundle-relative path -> JSON text. */
  files: Record<string, string>
  /** Problems in the screen data; the file is still written and the build goes on. */
  warnings: string[]
  /** Problems in the declaration itself; the caller aborts the build. */
  errors: string[]
}

const FILE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isScreenConfigFormat(value: unknown): value is ScreenConfigFormat {
  return typeof value === 'string' && (SCREEN_CONFIG_FORMATS as readonly string[]).includes(value)
}

/** Validates `hal.screenConfigs`; any malformed entry is an error, never a silent skip. */
export function readScreenConfigDeclarations(raw: unknown): {
  declarations: ScreenConfigDeclaration[]
  errors: string[]
} {
  if (raw === undefined) return { declarations: [], errors: [] }
  if (!Array.isArray(raw)) return { declarations: [], errors: ['hal.screenConfigs must be an array'] }
  const declarations: ScreenConfigDeclaration[] = []
  const errors: string[] = []
  const files = new Set<string>()
  raw.forEach((entry: unknown, index) => {
    const where = `hal.screenConfigs[${index}]`
    if (!isRecord(entry)) {
      errors.push(`${where} must be an object`)
      return
    }
    const { storageId, format, file } = entry
    if (typeof storageId !== 'string' || storageId === '') {
      errors.push(`${where}.storageId must be a non-empty string`)
      return
    }
    if (!isScreenConfigFormat(format)) {
      errors.push(`${where}.format must be one of: ${SCREEN_CONFIG_FORMATS.join(', ')}`)
      return
    }
    if (typeof file !== 'string' || !FILE_NAME_PATTERN.test(file)) {
      errors.push(`${where}.file must match ${FILE_NAME_PATTERN.source}`)
      return
    }
    if (files.has(file)) {
      errors.push(`${where}.file "${file}" is declared twice`)
      return
    }
    files.add(file)
    declarations.push({ storageId, format, file })
  })
  return { declarations, errors }
}

/**
 * Resolves a `<POU>.<var>` or `GVL.<var>` qualifier to its STruC++ debug-map
 * leaf, the same path the debugger and the OPC-UA config use.
 */
export function createDebugEntryResolver(
  debugMapContent: string,
  instances: ReadonlyArray<{ name: string; program: string }>,
): (qualifier: string) => DebugEntry | null {
  const parsed = debugMapContent ? parseDebugMap(debugMapContent) : undefined
  const leaves = parsed ? buildLeafInfoMap(parsed) : null
  const mapping: PLCInstanceMapping[] = instances.map((i) => ({ name: i.name, program: i.program }))
  return (qualifier) => {
    if (leaves === null) return null
    const dot = qualifier.indexOf('.')
    if (dot <= 0) return null
    const pouName = qualifier.slice(0, dot)
    const variablePath = qualifier.slice(dot + 1)
    let debugPath: string
    if (pouName === 'GVL' || pouName === 'CONFIG') {
      debugPath = buildGlobalDebugPath(variablePath)
    } else {
      const instanceName = findInstanceName(pouName, mapping)
      if (instanceName === null) return null
      debugPath = buildDebugPath(instanceName, variablePath)
    }
    const info = leaves.get(debugPath.toUpperCase())
    return info === undefined ? null : { arr: info.arr, elem: info.elem, datatype: info.type }
  }
}

/** Leaf types the runtime's variable publishers can encode. */
const VARIABLE_EXPORT_DATATYPES = new Set([
  'BOOL',
  'SINT',
  'USINT',
  'BYTE',
  'INT',
  'UINT',
  'WORD',
  'DINT',
  'UDINT',
  'DWORD',
  'LINT',
  'ULINT',
  'LWORD',
  'REAL',
  'LREAL',
  'TIME',
  'DATE',
  'TOD',
  'DT',
  'STRING',
  'WSTRING',
])

const HOST_PORT_PATTERN = /^([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?):([0-9]{1,5})$/

function isHostPort(value: string): boolean {
  const match = HOST_PORT_PATTERN.exec(value)
  if (!match) return false
  const port = Number(match[2])
  return port >= 1 && port <= 65535
}

function readString(data: Record<string, unknown>, key: string): string {
  const value = data[key]
  return typeof value === 'string' ? value : ''
}

/**
 * `variable-exports`: a publisher that exports program variables through the
 * runtime's debug surface. Disabled data still yields `{ "enabled": false }`,
 * because the runtime keeps a sibling config from an earlier deploy otherwise.
 */
export function generateVariableExportsConfig(
  label: string,
  data: unknown,
  resolve: (qualifier: string) => DebugEntry | null,
): { content: Record<string, unknown>; warnings: string[] } {
  const record = isRecord(data) ? data : {}
  if (record.enabled !== true) return { content: { enabled: false }, warnings: [] }

  const warnings: string[] = []
  const clientName = readString(record, 'clientName')
  const clientId = readString(record, 'clientId')
  const clientSecret = readString(record, 'clientSecret')
  const natsAddress = readString(record, 'natsAddress').trim()
  if (natsAddress && !isHostPort(natsAddress)) {
    warnings.push(`${label}: address ${natsAddress} must be host:port, for example 172.18.0.1:49360`)
  }

  const exports: Array<Record<string, unknown>> = []
  const picked = Array.isArray(record.exports) ? record.exports : []
  for (const entry of picked) {
    if (!isRecord(entry) || typeof entry.qualifier !== 'string') continue
    const debugEntry = resolve(entry.qualifier)
    if (debugEntry === null) {
      warnings.push(
        `${label}: ${entry.qualifier} is not in the compiled debug map; recompile after adding it to a POU or GVL`,
      )
      continue
    }
    const datatype = debugEntry.datatype.toUpperCase()
    if (!VARIABLE_EXPORT_DATATYPES.has(datatype)) {
      warnings.push(`${label}: ${entry.qualifier} has datatype ${datatype || '<unknown>'} which is not exported yet`)
      continue
    }
    exports.push({
      qualifier: entry.qualifier,
      direction: entry.direction === 'RW' ? 'RW' : 'RO',
      arr: debugEntry.arr,
      elem: debugEntry.elem,
      datatype,
    })
  }

  if (!clientName) warnings.push(`${label}: clientName is required when enabled`)
  if (!clientId) warnings.push(`${label}: clientId is required when enabled`)
  if (!clientSecret) warnings.push(`${label}: clientSecret is required when enabled`)

  const content: Record<string, unknown> = { enabled: true, clientName, clientId, clientSecret, exports }
  // Absent lets the plugin pick its own default address.
  if (natsAddress) content.natsAddress = natsAddress
  return { content, warnings }
}

/** Builds every `conf/<pluginName>.<file>.json` the device declares. */
export function generateScreenConfigFiles(args: {
  pluginName: string
  packageId: string
  screenConfigs: unknown
  inputs: VppScreenConfigInputs
}): ScreenConfigFilesResult {
  const { declarations, errors } = readScreenConfigDeclarations(args.screenConfigs)
  const files: Record<string, string> = {}
  const warnings: string[] = []
  if (errors.length > 0 || declarations.length === 0) return { files, warnings, errors }

  const resolve = createDebugEntryResolver(args.inputs.debugMapContent, args.inputs.instances)
  const buckets = args.inputs.vppExtensions[args.packageId] ?? {}
  for (const declaration of declarations) {
    const generated = generateVariableExportsConfig(declaration.storageId, buckets[declaration.storageId], resolve)
    files[`conf/${args.pluginName}.${declaration.file}.json`] = JSON.stringify(generated.content, null, 2)
    warnings.push(...generated.warnings)
  }
  return { files, warnings, errors }
}
