/**
 * The Edge API project envelope and the canonical path↔slot mapping
 * that goes with it.
 *
 * The Edge API stores projects as a nested JSON object (top-level
 * `project.json`, `library.json`, `devices/{...}`, `pous/{cat}/{file}`,
 * `servers/{file}`).  The backend's `flattenFileHierarchy` walks
 * this shape and lands each leaf at its `relativePath` on S3.
 *
 * It used to live in the web adapter, described here as web-specific
 * on the reasoning that the editor writes the same files straight to
 * disk and needs no envelope at all.  That stopped being true when the
 * desktop learned to open a cloud project: `backend/editor/edge-projects`
 * drives the same endpoints over the same envelope, so the shape is
 * shared and lives in `backend/shared` accordingly.  Both builds must
 * compute the same answer from the same bytes.
 *
 * `getInEnvelope` / `setInEnvelope` are the symmetric pair that
 * own the path→slot mapping; both `saveProject` (full-snapshot
 * write) and `saveFile` (single-slot patch) dispatch through them
 * so a future file category added to `iterateWriteProjectFiles`
 * cannot drift on one side without TypeScript flagging the other.
 * `envelopeFromWriteProjectFiles` walks the shared iterator and
 * calls `setInEnvelope` for each entry — the iterator decides
 * "which files exist", this helper decides "where they go".
 */

import { z } from 'zod'

import type { WriteProjectFiles } from '../../../middleware/shared/ports/project-port'
import { iterateWriteProjectFiles } from './iterate-write-project-files'

/**
 * Shape the Edge API uses for project file payloads.  Optional
 * top-level keys (`library.json`, `servers`) are present only when
 * the project owns those files; the canonical `findInEnvelope` /
 * `setInEnvelope` pair handles the missing-container case.
 */
export interface ApiProjectFiles {
  'project.json': string
  /** Library projects only.  Absent on PLC projects. */
  'library.json'?: string
  /**
   * Raw PLCopen XML marker written by Node's raw-import path
   * (`plcopen-pending-import.xml` at the project root). Present ONLY on a
   * project that's pending conversion — Node stores the uploaded XML
   * verbatim and does no server-side parsing, so a project in this state
   * has no `project.json` and no `pous`. Absent on every normal project.
   */
  'plcopen-pending-import.xml'?: string
  devices: Record<string, string> & {
    /** Nested map for `devices/remote/*` files; absent when empty. */
    remote?: Record<string, string>
  }
  /** Nested map: `pous[category][filename]`. */
  pous: Record<string, Record<string, string>>
  /** Flat map for `datatypes/*.dt` files; absent when the project
   *  has no data-type files (predates the format or has no types). */
  datatypes?: Record<string, string>
  /** Flat map for `devices/servers/*` files; absent when empty. */
  servers?: Record<string, string>
  /**
   * Build artifacts: the compiled `<name>.stlib` for library projects
   *  and the verification cache (`.verify-cache-library.json`).  The
   *  shared library-build orchestrator writes both through
   *  `setInEnvelope('build/<name>')`, so the slot must exist here for
   *  the writes to round-trip the save endpoint instead of being
   *  silently dropped by `setInEnvelope`'s unknown-path branch.
   */
  build?: Record<string, string>
}

/**
 * An envelope as it may actually arrive.
 *
 * The API omits every container the project has no files for — a project that has
 * never been saved answers `files: {}`, with no `pous`, no `devices` and not even a
 * `project.json`.  {@link getInEnvelope} guards each container with `?.` and
 * {@link setInEnvelope} creates them on the way in precisely because of that, so this
 * is the type those two actually accept.  Saying so removes the only reason a caller
 * ever had to assert its way past {@link ApiProjectFiles}.
 */
export type IncomingApiProjectFiles = Partial<ApiProjectFiles>

const FileMapSchema = z.record(z.string())

/**
 * `devices` is a flat map of file contents that ALSO carries one nested slot, so a
 * plain record of strings is wrong for it: `remote` is a map, and a schema that
 * demands a string for every key rejects the whole container the moment a project has
 * a remote device — silently emptying it, taking `configuration.json` and
 * `pin-mapping.json` down with it. `catchall` keeps the flat files as strings while
 * `remote` keeps its own shape.
 */
const DevicesSchema = z.object({ remote: FileMapSchema.optional() }).catchall(z.string())

/**
 * The envelope as it arrives from the API, for the callers that read one off
 * the wire.
 *
 * Every container is optional because the server omits the ones a project has
 * no files for — a brand-new project answers `files: {}` — and `getInEnvelope`
 * already guards each with `?.` for that reason.  Only `project.json` is
 * defaulted, to the empty string the readers already treat as "no manifest":
 * the alternative is a validation failure on the one response shape a new
 * project is guaranteed to produce.
 *
 * Loose on purpose about what it does NOT name: zod 3 strips unknown keys
 * rather than rejecting, so a category Edge adds tomorrow costs a slot in the
 * result, never an unreadable project.
 */
export const ApiProjectFilesSchema = z.object({
  'project.json': z.string().catch(''),
  'library.json': z.string().optional(),
  'plcopen-pending-import.xml': z.string().optional(),
  devices: DevicesSchema.catch({}),
  pous: z.record(FileMapSchema).catch({}),
  datatypes: FileMapSchema.optional(),
  servers: FileMapSchema.optional(),
  build: FileMapSchema.optional(),
})

/**
 * Compile-time proof that what the schema produces IS an `ApiProjectFiles`.
 * A field renamed on the interface without being renamed here fails at this
 * line rather than at some distant call site.
 */
const _schemaProducesTheInterface: (parsed: z.infer<typeof ApiProjectFilesSchema>) => ApiProjectFiles = (parsed) =>
  parsed

/**
 * Look up a single file's content by its project-root-relative path.
 * Returns `undefined` when the envelope doesn't carry the file
 * (e.g. PLC project's `library.json`) OR when the path is unknown.
 * Callers distinguishing "missing" from "unknown path" should
 * validate the path shape themselves; the contract here is the
 * superset of both.
 */
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
    return env.servers?.[parts[2]]
  }
  if (parts.length === 3 && parts[0] === 'pous') {
    return env.pous?.[parts[1]]?.[parts[2]]
  }
  if (parts.length === 2 && parts[0] === 'datatypes') {
    return env.datatypes?.[parts[1]]
  }
  // Flat `build/<filename>`: `build/<name>.stlib` and
  // `build/.verify-cache-library.json`.  Nested build paths (e.g.
  // `build/library/src/plc.xml`) are intentionally not persisted by
  // the orchestrator and are dropped here for symmetry — see the
  // path-constants comment in library-build-orchestrator.ts.
  if (parts.length === 2 && parts[0] === 'build') {
    return env.build?.[parts[1]]
  }
  return undefined
}

/**
 * Patch the envelope so the slot for `relativePath` carries `content`.
 * Creates every container on the way in — the top-level `env.devices` /
 * `env.pous` maps as well as the nested `env.devices.remote`,
 * `env.servers`, `env.pous[category]`.  No-op for unknown paths so
 * callers can blindly forward an iterator's output without a path
 * allowlist — unknown categories simply fall through.
 *
 * Creating the TOP-LEVEL containers is load-bearing, not defensive
 * tidiness.  `getInEnvelope` guards every container with `?.` because the
 * API omits a container the project has no files for; this function used
 * to assume `env.devices` and `env.pous` were always objects and threw a
 * TypeError when they were not.  A brand-new project's `/details` answers
 * `files: {}` — no `pous`, no `devices`, not even `project.json` — so
 * `saveFile`'s load-patch-save round trip died on the patch, returned a
 * failure, and Ctrl+S did nothing but flash a toast: the GET went out, the
 * POST never did, and the file stayed dirty with no explanation. Full
 * project saves were unaffected because `envelopeFromWriteProjectFiles`
 * starts from a complete literal, which is why this only bit the
 * single-file path and only until the first full save.
 *
 * Mutates `env` in place.  Idempotent for the same `(path, content)`.
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
    if (!env.servers) env.servers = {}
    env.servers[parts[2]] = content
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
  // Flat `build/<filename>`.  See the matching branch in
  // `getInEnvelope` for the rationale; this lets the library-build
  // orchestrator's `.stlib` write + verification-cache write round-
  // trip the save endpoint instead of being silently dropped here.
  if (parts.length === 2 && parts[0] === 'build') {
    if (!env.build) env.build = {}
    env.build[parts[1]] = content
    return
  }
  // Unknown path — silently ignored.  Iterator output stays in sync
  // with this mapping; an iterator change that adds a new category
  // without updating this function would surface as "envelope is
  // missing the file" in integration tests rather than crashing here.
}

/**
 * Build a fresh envelope from a flat `WriteProjectFiles`.  Iterates
 * the shared generator and slots each entry; both sides — what
 * files exist, where they go — are now expressed in one place
 * (iterator + envelope mapping), nowhere does the project-adapter
 * hand-roll the envelope shape.
 */
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

/**
 * Envelope -> the shape a project reader hands back.
 *
 * The inverse of `envelopeFromWriteProjectFiles`, and it lives beside it for that
 * reason: the two describe one wire format, and a change to either that is not
 * mirrored in the other corrupts a round trip. It used to live in the web adapter,
 * which meant the desktop editor could not read a cloud project without a second
 * copy of the same knowledge.
 */
export function apiFilesToRaw(projectPath: string, files: ApiProjectFiles) {
  const pouFiles = []
  for (const [category, categoryFiles] of Object.entries(files.pous ?? {})) {
    for (const [filename, content] of Object.entries(categoryFiles)) {
      pouFiles.push({ relativePath: `pous/${category}/${filename}`, content })
    }
  }
  const serverFiles = []
  for (const [filename, content] of Object.entries(files.servers ?? {})) {
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
    projectJson: files['project.json'],
    deviceConfig: files.devices?.['configuration.json'] ?? '{}',
    pinMapping: files.devices?.['pin-mapping.json'] ?? '[]',
    // Empty string when the API doesn't carry a `library.json`
    // (PLC projects don't have one; library projects do).  The
    // shared `RawProjectFiles` contract makes this field
    // non-optional so PLC-vs-library callers don't have to
    // special-case its presence — empty string is the documented
    // sentinel.  When the web backend adds library-project support
    // it can surface `files['library.json']` and the same shape
    // continues to work.
    libraryManifest: files['library.json'] ?? '',
    pouFiles,
    serverFiles,
    remoteDeviceFiles,
    dataTypeFiles,
    // `undefined` when absent — that's the "not a pending PLCopen import"
    // case. Present only when Node's project directory is a bare
    // `plcopen-pending-import.xml` marker (see openProjectByPath).
    pendingPlcopenSource: files['plcopen-pending-import.xml'],
  }
}
