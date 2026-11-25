import { z } from 'zod'

import type { WriteProjectFiles } from '../../../middleware/shared/ports/project-port'
import { classifyHmiPath } from '../../../middleware/shared/utils/hmi/project-files'
import { iterateWriteProjectFiles } from './iterate-write-project-files'

/** `hmi/`: screens and settings.json by file name, with widget blocks under `widgets`. */
export interface ApiHmiFiles {
  widgets?: Record<string, string>
  [file: string]: string | Record<string, string> | undefined
}

export interface ApiProjectFiles {
  'project.json': string
  /** Library projects only. */
  'library.json'?: string
  /** Present only on a project pending PLCopen conversion; such a project has no `project.json`. */
  'plcopen-pending-import.xml'?: string
  devices: Record<string, string> & {
    remote?: Record<string, string>
    servers?: Record<string, string>
  }
  pous: Record<string, Record<string, string>>
  datatypes?: Record<string, string>
  hmi?: ApiHmiFiles
  /** Legacy top-level server slot. Read as a fallback, never written. */
  servers?: Record<string, string>
  /** Build artifacts (`<name>.stlib`, verification cache). Without this slot they are silently dropped. */
  build?: Record<string, string>
}

/** An envelope as it may arrive: the API omits every container the project has no files for. */
export type IncomingApiProjectFiles = Partial<ApiProjectFiles>

const FileMapSchema = z.record(z.string())

// `devices` mixes flat file strings with nested `remote`/`servers` maps; a plain string record rejects it.
const DevicesSchema = z
  .object({ remote: FileMapSchema.optional(), servers: FileMapSchema.optional() })
  .catchall(z.string())

const HmiSchema = z.object({ widgets: FileMapSchema.optional() }).catchall(z.string())

/** Nothing is defaulted: a malformed container must fail the parse, not become an empty one the next save would persist. */
export const ApiProjectFilesSchema = z.object({
  'project.json': z.string().optional(),
  'library.json': z.string().optional(),
  'plcopen-pending-import.xml': z.string().optional(),
  devices: DevicesSchema.optional(),
  pous: z.record(FileMapSchema).optional(),
  datatypes: FileMapSchema.optional(),
  hmi: HmiSchema.optional(),
  servers: FileMapSchema.optional(),
  build: FileMapSchema.optional(),
  // A field renamed on the interface without being renamed here fails on this line.
}) satisfies z.ZodType<IncomingApiProjectFiles, z.ZodTypeDef, unknown>

/** `undefined` for both a missing file and an unknown path. */
export function getInEnvelope(env: IncomingApiProjectFiles, relativePath: string): string | undefined {
  if (relativePath === 'project.json') return env['project.json']
  if (relativePath === 'library.json') return env['library.json']
  if (relativePath === 'devices/configuration.json') return env.devices?.['configuration.json']
  if (relativePath === 'devices/pin-mapping.json') return env.devices?.['pin-mapping.json']

  const parts = relativePath.split('/')
  if (parts.length === 3 && parts[0] === 'devices' && parts[1] === 'remote') {
    return env.devices?.remote?.[parts[2]]
  }
  if (parts.length === 3 && parts[0] === 'devices' && parts[1] === 'servers') {
    return env.devices?.servers?.[parts[2]] ?? env.servers?.[parts[2]]
  }
  if (parts.length === 3 && parts[0] === 'pous') {
    return env.pous?.[parts[1]]?.[parts[2]]
  }
  if (parts.length === 2 && parts[0] === 'datatypes') {
    return env.datatypes?.[parts[1]]
  }
  // Flat `build/<filename>` only; nested build paths are intentionally not persisted.
  if (parts.length === 2 && parts[0] === 'build') {
    return env.build?.[parts[1]]
  }
  if (parts.length === 2 && parts[0] === 'hmi' && parts[1] !== 'widgets') {
    const file = env.hmi?.[parts[1]]
    return typeof file === 'string' ? file : undefined
  }
  if (parts.length === 3 && parts[0] === 'hmi' && parts[1] === 'widgets') {
    return env.hmi?.widgets?.[parts[2]]
  }
  return undefined
}

/** Mutates `env`, creating every container: a never-saved project arrives as `files: {}`. Unknown paths are a no-op. */
export function setInEnvelope(env: IncomingApiProjectFiles, relativePath: string, content: string): void {
  if (relativePath === 'project.json') {
    env['project.json'] = content
    return
  }
  if (relativePath === 'library.json') {
    env['library.json'] = content
    return
  }
  if (relativePath === 'devices/configuration.json') {
    if (!env.devices) env.devices = {}
    env.devices['configuration.json'] = content
    return
  }
  if (relativePath === 'devices/pin-mapping.json') {
    if (!env.devices) env.devices = {}
    env.devices['pin-mapping.json'] = content
    return
  }

  const parts = relativePath.split('/')
  if (parts.length === 3 && parts[0] === 'devices' && parts[1] === 'remote') {
    if (!env.devices) env.devices = {}
    if (!env.devices.remote) env.devices.remote = {}
    env.devices.remote[parts[2]] = content
    return
  }
  if (parts.length === 3 && parts[0] === 'devices' && parts[1] === 'servers') {
    if (!env.devices) env.devices = {}
    if (!env.devices.servers) env.devices.servers = {}
    env.devices.servers[parts[2]] = content
    // A copy left at the legacy top-level slot would shadow nothing on read but
    // would keep a stale `servers/{file}` alive on the server.
    if (env.servers) delete env.servers[parts[2]]
    return
  }
  if (parts.length === 3 && parts[0] === 'pous') {
    if (!env.pous) env.pous = {}
    if (!env.pous[parts[1]]) env.pous[parts[1]] = {}
    env.pous[parts[1]][parts[2]] = content
    return
  }
  if (parts.length === 2 && parts[0] === 'datatypes') {
    if (!env.datatypes) env.datatypes = {}
    env.datatypes[parts[1]] = content
    return
  }
  if (parts.length === 2 && parts[0] === 'build') {
    if (!env.build) env.build = {}
    env.build[parts[1]] = content
    return
  }
  if (parts.length === 2 && parts[0] === 'hmi' && parts[1] !== 'widgets') {
    if (!env.hmi) env.hmi = {}
    env.hmi[parts[1]] = content
    return
  }
  if (parts.length === 3 && parts[0] === 'hmi' && parts[1] === 'widgets') {
    if (!env.hmi) env.hmi = {}
    if (!env.hmi.widgets) env.hmi.widgets = {}
    env.hmi.widgets[parts[2]] = content
  }
}

export function envelopeFromWriteProjectFiles(files: WriteProjectFiles): ApiProjectFiles {
  const env: ApiProjectFiles = {
    'project.json': '',
    devices: {},
    pous: {},
  }
  for (const entry of iterateWriteProjectFiles(files)) {
    setInEnvelope(env, entry.relativePath, entry.content)
  }
  return env
}

/** Every key this envelope models. Anything else on the wire is a file we do not manage. */
const MODELLED_KEYS = [
  'project.json',
  'library.json',
  'plcopen-pending-import.xml',
  'devices',
  'pous',
  'datatypes',
  'hmi',
  'servers',
  'build',
] as const

const ProjectTypeSchema = z.object({ meta: z.object({ type: z.string() }) })

/** Whether the envelope's `project.json` declares a library project. */
function isLibraryEnvelope(env: ApiProjectFiles): boolean {
  let value: unknown
  try {
    value = JSON.parse(env['project.json'])
  } catch {
    return false
  }
  const parsed = ProjectTypeSchema.safeParse(value)
  return parsed.success && parsed.data.meta.type === 'plc-library'
}

/** The files under `hmi/` that the project model does not hold, which a save must keep. */
function unmodelledHmiFiles(existing: ApiHmiFiles | undefined): ApiHmiFiles {
  const kept: ApiHmiFiles = {}
  for (const [name, content] of Object.entries(existing ?? {})) {
    if (name !== 'widgets' && typeof content === 'string' && !classifyHmiPath(`hmi/${name}`)) kept[name] = content
  }
  for (const [name, content] of Object.entries(existing?.widgets ?? {})) {
    if (!classifyHmiPath(`hmi/widgets/${name}`)) kept.widgets = { ...kept.widgets, [name]: content }
  }
  return kept
}

/** The `hmi` container a save sends: the generated files over the unmodelled ones; a library's is kept as it is. */
function mergeHmi(existing: ApiHmiFiles | undefined, generated: ApiProjectFiles): ApiHmiFiles | undefined {
  if (isLibraryEnvelope(generated)) return existing
  const kept = unmodelledHmiFiles(existing)
  const widgets = { ...kept.widgets, ...generated.hmi?.widgets }
  const merged: ApiHmiFiles = { ...kept, ...generated.hmi }
  if (Object.keys(widgets).length > 0) merged.widgets = widgets
  else delete merged.widgets
  return Object.keys(merged).length > 0 ? merged : undefined
}

/**
 * The save endpoint deletes by omission, so a payload built only from the store would drop
 * every file this envelope does not model — `README.md` above all. Modelled containers are
 * replaced wholesale, except the `hmi/` files the model does not hold; the rest is carried through.
 */
export function mergeEnvelopeOverExisting(
  existing: IncomingApiProjectFiles,
  generated: ApiProjectFiles,
): ApiProjectFiles {
  const carried: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(existing)) {
    if (!MODELLED_KEYS.some((modelled) => modelled === key)) carried[key] = value
  }

  const hmi = mergeHmi(existing.hmi, generated)
  const { hmi: _generatedHmi, ...rest } = generated
  return { ...carried, ...rest, ...(hmi ? { hmi } : {}) }
}

/** Inverse of `envelopeFromWriteProjectFiles`. */
export function apiFilesToRaw(projectPath: string, files: IncomingApiProjectFiles) {
  const pouFiles = []
  for (const [category, categoryFiles] of Object.entries(files.pous ?? {})) {
    for (const [filename, content] of Object.entries(categoryFiles)) {
      pouFiles.push({ relativePath: `pous/${category}/${filename}`, content })
    }
  }
  const serverFiles = []
  // The canonical slot wins over the legacy top-level one when both name a file.
  for (const [filename, content] of Object.entries({ ...files.servers, ...files.devices?.servers })) {
    serverFiles.push({ relativePath: `devices/servers/${filename}`, content })
  }
  const remoteDeviceFiles = []
  for (const [filename, content] of Object.entries(files.devices?.remote ?? {})) {
    remoteDeviceFiles.push({ relativePath: `devices/remote/${filename}`, content })
  }
  const dataTypeFiles = []
  for (const [filename, content] of Object.entries(files.datatypes ?? {})) {
    dataTypeFiles.push({ relativePath: `datatypes/${filename}`, content })
  }
  const hmiFiles = []
  const { widgets, ...hmi } = files.hmi ?? {}
  for (const [filename, content] of Object.entries(hmi)) {
    if (typeof content === 'string') hmiFiles.push({ relativePath: `hmi/${filename}`, content })
  }
  for (const [filename, content] of Object.entries(widgets ?? {})) {
    hmiFiles.push({ relativePath: `hmi/widgets/${filename}`, content })
  }
  return {
    projectPath,
    projectJson: files['project.json'] ?? '',
    deviceConfig: files.devices?.['configuration.json'] ?? '{}',
    pinMapping: files.devices?.['pin-mapping.json'] ?? '[]',
    // Empty string is the documented sentinel for "no library.json".
    libraryManifest: files['library.json'] ?? '',
    pouFiles,
    serverFiles,
    remoteDeviceFiles,
    dataTypeFiles,
    hmiFiles,
    pendingPlcopenSource: files['plcopen-pending-import.xml'],
  }
}
