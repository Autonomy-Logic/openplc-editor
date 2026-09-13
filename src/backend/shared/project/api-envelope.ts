/** The Edge API project envelope and its path <-> slot mapping. Shared by both builds. */

import { z } from 'zod'

import type { WriteProjectFiles } from '../../../middleware/shared/ports/project-port'
import { iterateWriteProjectFiles } from './iterate-write-project-files'

/** Shape the Edge API uses for project file payloads. */
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

/**
 * Wire schema for an incoming envelope. Nothing is defaulted: a malformed container must
 * fail the parse, not become an empty one the next save would persist.
 */
export const ApiProjectFilesSchema = z.object({
  'project.json': z.string().optional(),
  'library.json': z.string().optional(),
  'plcopen-pending-import.xml': z.string().optional(),
  devices: DevicesSchema.optional(),
  pous: z.record(FileMapSchema).optional(),
  datatypes: FileMapSchema.optional(),
  servers: FileMapSchema.optional(),
  build: FileMapSchema.optional(),
  // A field renamed on the interface without being renamed here fails on this line.
}) satisfies z.ZodType<IncomingApiProjectFiles, z.ZodTypeDef, unknown>

/** Look up a file by project-relative path; `undefined` for both a missing file and an unknown path. */
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
  return undefined
}

/**
 * Write `content` into the slot for `relativePath`, mutating `env`. Creates every container,
 * including the top-level ones: a never-saved project arrives as `files: {}`. Unknown paths are a no-op.
 */
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
  // Unknown path: silently ignored.
}

/** Build a fresh envelope from a flat `WriteProjectFiles`. */
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

/** Envelope -> the shape a project reader hands back. Inverse of `envelopeFromWriteProjectFiles`. */
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
    pendingPlcopenSource: files['plcopen-pending-import.xml'],
  }
}
