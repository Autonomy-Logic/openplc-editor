/**
 * Build and parse the source-project archive stored on a runtime device.
 *
 * The editor uploads only build artifacts, so a device has never recorded the
 * project they came from. This module produces the archive that closes that
 * gap ("Retrieve Project from PLC") and reads one back.
 *
 * Three things shape it:
 *
 *   - **The archive is the project's own on-disk shape.** Entries use the same
 *     project-root-relative paths `iterateWriteProjectFiles` yields, so a
 *     retrieved archive maps straight onto the existing project-open path
 *     rather than needing a translation layer. `toWriteProjectFiles` below is
 *     the explicit inverse of that generator and has to move with it.
 *
 *   - **The device never opens it.** The runtime stores these bytes untouched
 *     and takes its metadata from a separate field, so the format here can
 *     change without touching the device. `buildProjectSnapshot` returns that
 *     metadata alongside the bytes precisely so the two cannot drift.
 *
 *   - **A retrieved archive is untrusted input.** It arrives from a device
 *     that may not be the one that wrote it, and the stored project is not
 *     signed or encrypted -- anyone with filesystem access to the device can
 *     replace it. `parseProjectSnapshot` therefore validates before it yields
 *     anything, with the same class of checks the runtime applies to uploads.
 *
 * No filesystem, no HTTP, no DOM: callers own reading and writing. Built on
 * JSZip and WebCrypto only, so the identical file runs in the Electron main
 * process and in the browser.
 */

import JSZip from 'jszip'

import type { RawProjectFile, WriteProjectFiles } from '../../../middleware/shared/ports/project-port'

/**
 * Bumped when the archive layout changes in a way an older reader would
 * misread. A reader that does not recognise the version refuses the archive
 * outright rather than guessing at a partial parse.
 */
export const SNAPSHOT_FORMAT_VERSION = 1

/** Manifest entry, kept out of the project tree so it can never collide with a real file. */
export const SNAPSHOT_MANIFEST_PATH = '.openplc-snapshot/manifest.json'

/** Bundled `.stlib` archives live here, one JSON text file each. */
export const SNAPSHOT_LIBRARY_DIR = '.openplc-snapshot/libraries'

/**
 * Limits applied when READING an archive. Generous enough that no real project
 * trips them and tight enough that a hostile device cannot exhaust the client.
 *
 * Injectable into `parseProjectSnapshot` so the refusal paths can be tested
 * without building a 100 MB fixture -- a limit with no test proving it fires
 * is a limit nobody knows is wired up.
 */
export interface SnapshotLimits {
  maxEntries: number
  maxEntryBytes: number
  maxTotalBytes: number
  maxCompressionRatio: number
}

export const SNAPSHOT_LIMITS: SnapshotLimits = {
  maxEntries: 20_000,
  maxEntryBytes: 32 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
  /** A legitimately compressible project of source text sits far below this. */
  maxCompressionRatio: 1_000,
} as const

/** One library bundled with the project. `archive` is the `.stlib` JSON text. */
export interface SnapshotLibrary {
  name: string
  version: string
  /** SHA-256 of `archive`, hex. Lets the opening client tell "same library" from
   *  "same name and version, different bytes" -- the case that silently
   *  produces a different program. */
  hash: string
  archive: string
}

/** What the device stores beside the archive and reports without opening it. */
export interface SnapshotMetadata {
  formatVersion: number
  projectName: string
  editorVersion: string
  uploadedBy: string
  /** ISO 8601, UTC. */
  timestamp: string
  libraries: Array<{ name: string; version: string; hash: string }>
}

export interface BuildProjectSnapshotOptions {
  /** Project-root-relative path to file content, for everything except
   *  `build/`. A Map rather than `WriteProjectFiles` because the two callers
   *  have genuinely different sources: the editor walks the project directory
   *  on disk, web holds the files in memory. `writeProjectFilesToMap` converts
   *  when a caller already has the structured shape. */
  files: Map<string, string>
  projectName: string
  editorVersion: string
  /** Runtime account performing the upload. Informational only. */
  uploadedBy: string
  libraries?: SnapshotLibrary[]
  /** Injectable so tests get a stable manifest; defaults to now. */
  timestamp?: string
}

export interface BuiltProjectSnapshot {
  /** The archive to send as the upload's `snapshot` field. */
  archive: Uint8Array
  /** The same values, to send as the `snapshot_metadata` field. */
  metadata: SnapshotMetadata
}

export interface ParsedProjectSnapshot {
  metadata: SnapshotMetadata
  /** Project-root-relative path to file content, exactly as stored. */
  files: Map<string, string>
  libraries: SnapshotLibrary[]
}

export class SnapshotArchiveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SnapshotArchiveError'
  }
}

/** SHA-256 hex, via WebCrypto so the one implementation covers Node and the browser. */
export async function hashText(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Reject anything that would escape the destination directory when written.
 *
 * Path traversal is the check that actually matters here: a bomb only exhausts
 * disk, while a `../../` entry writes outside the folder the user chose. Called
 * before any content is handed back, so a bad archive yields nothing at all
 * rather than a half-written tree.
 *
 * Exported so it can be tested directly: JSZip quietly normalises a leading
 * `../` away when it BUILDS an archive, so a test cannot forge that entry
 * through the library -- only a hand-crafted archive carries it. The guard
 * still has to exist and still has to be tested, because nothing here should
 * depend on JSZip's sanitising for correctness.
 */
export function assertSafeEntryPath(rawPath: string): void {
  // Windows-authored archives can carry backslashes; normalise before judging
  // so `..\\..\\x` is not waved through as a single innocent-looking segment.
  const path = rawPath.replace(/\\/g, '/')

  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) {
    throw new SnapshotArchiveError(`Archive contains an absolute path: ${rawPath}`)
  }
  if (path.split('/').some((segment) => segment === '..')) {
    throw new SnapshotArchiveError(`Archive contains a path that escapes the project: ${rawPath}`)
  }
  if (path.includes('\0')) {
    throw new SnapshotArchiveError(`Archive contains a path with a null byte: ${rawPath}`)
  }
}

/**
 * Build the archive for an upload.
 *
 * Everything except `build/` -- which is exactly what `WriteProjectFiles`
 * already carries, since that is the set the editor persists. Bundled
 * libraries ride alongside so a retrieved project can still compile on a
 * machine whose library pool has never seen them.
 */
export async function buildProjectSnapshot(
  options: BuildProjectSnapshotOptions,
): Promise<BuiltProjectSnapshot> {
  const { files, projectName, editorVersion, uploadedBy } = options
  const libraries = options.libraries ?? []
  const timestamp = options.timestamp ?? new Date().toISOString()

  const metadata: SnapshotMetadata = {
    formatVersion: SNAPSHOT_FORMAT_VERSION,
    projectName,
    editorVersion,
    uploadedBy,
    timestamp,
    libraries: libraries.map(({ name, version, hash }) => ({ name, version, hash })),
  }

  const zip = new JSZip()
  zip.file(SNAPSHOT_MANIFEST_PATH, JSON.stringify(metadata, null, 2))

  for (const [relativePath, content] of files) {
    // Refuse to WRITE what we would refuse to read, so a project that somehow
    // holds an escaping path cannot be handed to a device and blamed on the
    // device later.
    assertSafeEntryPath(relativePath)
    zip.file(relativePath, content)
  }

  for (const library of libraries) {
    zip.file(`${SNAPSHOT_LIBRARY_DIR}/${libraryFileName(library)}`, library.archive)
  }

  const archive = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })

  return { archive, metadata }
}

/** Stable, collision-resistant, and safe as a path segment. */
function libraryFileName(library: SnapshotLibrary): string {
  const safeName = library.name.replace(/[^A-Za-z0-9._-]/g, '_')
  return `${safeName}-${library.hash.slice(0, 12)}.stlib`
}

/**
 * A structured `WriteProjectFiles` flattened to the path/content map the
 * archive stores.
 *
 * Deliberately a local walk rather than a call into `iterateWriteProjectFiles`:
 * that generator's entries are typed to a fixed set of literal paths and this
 * needs only the pair. Both walk the same shape, so a new file category has to
 * be added in both -- the round-trip test is what catches a miss.
 */
export function writeProjectFilesToMap(files: WriteProjectFiles): Map<string, string> {
  const map = new Map<string, string>()
  map.set('project.json', files.projectJson)
  if (files.deviceConfig !== undefined) map.set('devices/configuration.json', files.deviceConfig)
  if (files.pinMapping !== undefined) map.set('devices/pin-mapping.json', files.pinMapping)
  if (files.libraryManifest !== undefined) map.set('library.json', files.libraryManifest)
  for (const group of [files.pouFiles, files.serverFiles, files.remoteDeviceFiles, files.dataTypeFiles]) {
    for (const file of group) map.set(file.relativePath, file.content)
  }
  return map
}

/**
 * Read an archive retrieved from a device.
 *
 * Validates the whole archive before returning any of it, so a rejected
 * archive never leaves a partially written project behind.
 */
export async function parseProjectSnapshot(
  bytes: Uint8Array,
  limits: SnapshotLimits = SNAPSHOT_LIMITS,
): Promise<ParsedProjectSnapshot> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch (error) {
    throw new SnapshotArchiveError(
      `Not a readable project archive: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const entries = Object.values(zip.files).filter((entry) => !entry.dir)

  if (entries.length > limits.maxEntries) {
    throw new SnapshotArchiveError(
      `Archive has too many files (${entries.length}, limit ${limits.maxEntries})`,
    )
  }

  // Check declared sizes before reading anything: the point of a zip bomb is
  // that decompressing it is what hurts, so the refusal has to come first.
  let declaredTotal = 0
  for (const entry of entries) {
    assertSafeEntryPath(entry.name)

    // JSZip exposes these on the internal record; absent for archives it built
    // in memory, in which case the post-read total below is the backstop.
    const meta = (entry as unknown as { _data?: { uncompressedSize?: number; compressedSize?: number } })._data
    const uncompressed = meta?.uncompressedSize ?? 0
    const compressed = meta?.compressedSize ?? 0

    if (uncompressed > limits.maxEntryBytes) {
      throw new SnapshotArchiveError(`Archive entry is too large: ${entry.name}`)
    }
    if (compressed > 0 && uncompressed / compressed > limits.maxCompressionRatio) {
      throw new SnapshotArchiveError(`Archive entry has a suspicious compression ratio: ${entry.name}`)
    }
    declaredTotal += uncompressed
  }
  if (declaredTotal > limits.maxTotalBytes) {
    throw new SnapshotArchiveError(
      `Archive is too large uncompressed (${declaredTotal} bytes, limit ${limits.maxTotalBytes})`,
    )
  }

  const manifestEntry = zip.file(SNAPSHOT_MANIFEST_PATH)
  if (!manifestEntry) {
    throw new SnapshotArchiveError('Archive has no project snapshot manifest')
  }
  const metadata = parseManifest(await manifestEntry.async('string'))

  const files = new Map<string, string>()
  const libraries: SnapshotLibrary[] = []
  let readTotal = 0

  for (const entry of entries) {
    const path = entry.name.replace(/\\/g, '/')
    if (path === SNAPSHOT_MANIFEST_PATH) continue

    const content = await entry.async('string')
    readTotal += content.length
    // Backstop for an archive that lied about, or omitted, its declared sizes.
    if (readTotal > limits.maxTotalBytes) {
      throw new SnapshotArchiveError('Archive expanded beyond the size limit while reading')
    }

    if (path.startsWith(`${SNAPSHOT_LIBRARY_DIR}/`)) {
      libraries.push({
        ...matchLibraryMetadata(metadata, path),
        archive: content,
      })
      continue
    }

    files.set(path, content)
  }

  if (!files.has('project.json')) {
    throw new SnapshotArchiveError('Archive has no project.json')
  }

  return { metadata, files, libraries }
}

/**
 * Pair a bundled library file with its manifest entry.
 *
 * The manifest is the authority on name and version; the file name only has to
 * be unique. An entry with no manifest match still comes back -- dropping it
 * silently would turn a malformed archive into a project that compiles against
 * a library the user was never told about.
 */
function matchLibraryMetadata(
  metadata: SnapshotMetadata,
  path: string,
): { name: string; version: string; hash: string } {
  const fileName = path.slice(`${SNAPSHOT_LIBRARY_DIR}/`.length)
  const match = metadata.libraries.find(
    (library) => libraryFileName({ ...library, archive: '' }) === fileName,
  )
  return match ?? { name: fileName.replace(/\.stlib$/, ''), version: '', hash: '' }
}

function parseManifest(text: string): SnapshotMetadata {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new SnapshotArchiveError(
      `Project snapshot manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  if (typeof raw !== 'object' || raw === null) {
    throw new SnapshotArchiveError('Project snapshot manifest is not an object')
  }
  const record = raw as Record<string, unknown>

  const formatVersion = record.formatVersion
  if (typeof formatVersion !== 'number' || !Number.isInteger(formatVersion)) {
    throw new SnapshotArchiveError('Project snapshot manifest has no formatVersion')
  }
  if (formatVersion > SNAPSHOT_FORMAT_VERSION) {
    throw new SnapshotArchiveError(
      `This project was stored by a newer editor (archive format ${formatVersion}, this editor reads ${SNAPSHOT_FORMAT_VERSION}). Update the editor to open it.`,
    )
  }

  const libraries = Array.isArray(record.libraries)
    ? record.libraries.flatMap((entry) => {
        if (typeof entry !== 'object' || entry === null) return []
        const library = entry as Record<string, unknown>
        if (typeof library.name !== 'string' || !library.name) return []
        return [
          {
            name: library.name,
            version: typeof library.version === 'string' ? library.version : '',
            hash: typeof library.hash === 'string' ? library.hash : '',
          },
        ]
      })
    : []

  return {
    formatVersion,
    projectName: typeof record.projectName === 'string' ? record.projectName : '',
    editorVersion: typeof record.editorVersion === 'string' ? record.editorVersion : '',
    uploadedBy: typeof record.uploadedBy === 'string' ? record.uploadedBy : '',
    timestamp: typeof record.timestamp === 'string' ? record.timestamp : '',
    libraries,
  }
}

/**
 * Turn a parsed archive back into the shape the project-open path consumes.
 *
 * The explicit inverse of `iterateProjectEntries`. Anything under a known
 * directory goes to its bucket; anything else is dropped rather than guessed
 * at, because a file the writer cannot place is a file the next save would
 * lose anyway.
 */
export function toWriteProjectFiles(
  parsed: ParsedProjectSnapshot,
  projectPath: string,
): WriteProjectFiles {
  const pouFiles: RawProjectFile[] = []
  const serverFiles: RawProjectFile[] = []
  const remoteDeviceFiles: RawProjectFile[] = []
  const dataTypeFiles: RawProjectFile[] = []

  let projectJson = ''
  let deviceConfig: string | undefined
  let pinMapping: string | undefined
  let libraryManifest: string | undefined

  for (const [relativePath, content] of parsed.files) {
    if (relativePath === 'project.json') {
      projectJson = content
    } else if (relativePath === 'devices/configuration.json') {
      deviceConfig = content
    } else if (relativePath === 'devices/pin-mapping.json') {
      pinMapping = content
    } else if (relativePath === 'library.json') {
      libraryManifest = content
    } else if (relativePath.startsWith('pous/')) {
      pouFiles.push({ relativePath, content })
    } else if (relativePath.startsWith('devices/servers/')) {
      serverFiles.push({ relativePath, content })
    } else if (relativePath.startsWith('devices/remote/')) {
      remoteDeviceFiles.push({ relativePath, content })
    } else if (relativePath.startsWith('datatypes/')) {
      dataTypeFiles.push({ relativePath, content })
    }
  }

  return {
    projectPath,
    projectJson,
    deviceConfig,
    pinMapping,
    libraryManifest,
    pouFiles,
    serverFiles,
    remoteDeviceFiles,
    dataTypeFiles,
    // A retrieved project is written into an empty destination, so there is
    // nothing to delete. Carrying deletions from the archive would let a
    // hostile device name files to remove on the opening machine.
    deletions: [],
  }
}
