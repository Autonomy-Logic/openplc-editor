/**
 * Assemble the source-project archive that rides along with a program upload.
 *
 * The device stores it untouched so the project can be retrieved later. This
 * module is the editor's side of that: read the project off disk, gather the
 * `.stlib` archives it references, and hand both to the shared archive builder.
 *
 * Reading from disk rather than from the renderer's store is deliberate. The
 * build path already saves the whole project before compiling -- the compiler
 * reads its source from disk, so it has to -- which means the tree on disk is
 * the exact project the artifacts were built from. Serialising the store again
 * here would introduce a second source of truth that could disagree with what
 * was actually compiled.
 */

import { promises as fs } from 'fs'
import { join, relative, sep } from 'path'

import {
  buildProjectSnapshot,
  hashText,
  type SnapshotLibrary,
} from '../../shared/project/project-snapshot-archive'

/**
 * Directories and files never worth storing.
 *
 * `build/` is the point: it holds the compiled artifacts, which the device
 * already has, and it is far larger than the source. The rest is local noise
 * that would otherwise travel to a device and back onto someone else's machine.
 */
const EXCLUDED_DIRECTORIES = new Set(['build', '.git', 'node_modules'])
const EXCLUDED_FILES = new Set(['.DS_Store', 'Thumbs.db'])

/** How a caller supplies the `.stlib` text for a library the project uses. */
export type ReadLibraryArchive = (name: string) => Promise<string | null> | (string | null)

export interface BuildUploadSnapshotOptions {
  projectPath: string
  editorVersion: string
  /** Runtime account performing the upload. Informational only. */
  uploadedBy: string
  /** Injected rather than imported: the library manager is Electron-bound, and
   *  this module is otherwise plain filesystem work that can be tested without
   *  standing up an app. */
  readLibraryArchive?: ReadLibraryArchive
  timestamp?: string
}

export interface UploadSnapshot {
  archive: Buffer
  /** JSON, sent as the upload's `snapshot_metadata` field. */
  metadata: string
  /** Libraries the project references that could not be read. Reported rather
   *  than fatal: a project missing a library is still worth storing, and the
   *  alternative is refusing to store anything at all. */
  missingLibraries: string[]
}

/**
 * Every file under `projectPath`, keyed by project-root-relative path.
 *
 * Paths are normalised to forward slashes so an archive written on Windows
 * reads identically everywhere -- ZIP entry names use `/` regardless of host,
 * and a backslash in an entry name is a literal character rather than a
 * separator to anything unpacking it.
 */
export async function readProjectDirectory(projectPath: string): Promise<Map<string, string>> {
  const files = new Map<string, string>()

  async function walk(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const absolute = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRECTORIES.has(entry.name)) continue
        await walk(absolute)
        continue
      }
      if (!entry.isFile() || EXCLUDED_FILES.has(entry.name)) continue

      const relativePath = relative(projectPath, absolute).split(sep).join('/')
      files.set(relativePath, await fs.readFile(absolute, 'utf-8'))
    }
  }

  await walk(projectPath)
  return files
}

/** The library names a project declares, read straight from its `project.json`. */
export function referencedLibraryNames(projectJson: string): string[] {
  try {
    const parsed = JSON.parse(projectJson) as { data?: { libraries?: Array<{ name?: unknown }> } }
    const libraries = parsed.data?.libraries
    if (!Array.isArray(libraries)) return []
    return libraries
      .map((library) => (typeof library?.name === 'string' ? library.name : ''))
      .filter((name) => name.length > 0)
  } catch {
    // A project.json we cannot parse is a project that will not open anyway.
    // Storing it without its libraries is strictly better than storing nothing.
    return []
  }
}

/**
 * Build the archive and its metadata for an upload.
 *
 * Bundling the libraries is what makes a retrieved project compile on a machine
 * whose pool has never seen them. A library that cannot be read is reported and
 * skipped rather than failing the build: the project is still worth storing,
 * and the opening client warns about what is missing.
 */
export async function buildUploadSnapshot(
  options: BuildUploadSnapshotOptions,
): Promise<UploadSnapshot> {
  const files = await readProjectDirectory(options.projectPath)

  const projectJson = files.get('project.json') ?? ''
  const projectName = readProjectName(projectJson, options.projectPath)

  const libraries: SnapshotLibrary[] = []
  const missingLibraries: string[] = []

  if (options.readLibraryArchive) {
    for (const name of referencedLibraryNames(projectJson)) {
      const archive = await options.readLibraryArchive(name)
      if (!archive) {
        missingLibraries.push(name)
        continue
      }
      libraries.push({
        name,
        version: readLibraryVersion(archive),
        hash: await hashText(archive),
        archive,
      })
    }
  }

  const built = await buildProjectSnapshot({
    files,
    projectName,
    editorVersion: options.editorVersion,
    uploadedBy: options.uploadedBy,
    libraries,
    timestamp: options.timestamp,
  })

  return {
    archive: Buffer.from(built.archive),
    metadata: JSON.stringify(built.metadata),
    missingLibraries,
  }
}

/**
 * The project's display name.
 *
 * Falls back to the directory name, because the device shows this in its
 * discovery reply and in the retrieve picker -- an empty name there reads as a
 * broken device rather than as a project that never set one.
 */
function readProjectName(projectJson: string, projectPath: string): string {
  try {
    const parsed = JSON.parse(projectJson) as { meta?: { name?: unknown } }
    if (typeof parsed.meta?.name === 'string' && parsed.meta.name.trim()) {
      return parsed.meta.name.trim()
    }
  } catch {
    // Fall through to the directory name.
  }
  return projectPath.split(sep).filter(Boolean).pop() ?? 'Untitled project'
}

function readLibraryVersion(archive: string): string {
  try {
    const parsed = JSON.parse(archive) as { manifest?: { version?: unknown } }
    return typeof parsed.manifest?.version === 'string' ? parsed.manifest.version : ''
  } catch {
    return ''
  }
}
