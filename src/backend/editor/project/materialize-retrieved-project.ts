/**
 * Write a project retrieved from a device onto disk.
 *
 * It lands in a scratch directory, not a location the user picked, and the
 * project is marked ephemeral until they choose one. That is what makes the
 * rest of the editor work unchanged:
 *
 *   - `meta.path` is always a real, writable directory, and never the
 *     previously open project's path. Every write in `save-actions` derives
 *     from `meta.path`, so a retrieved project loaded while the store still
 *     pointed at the old one would save its contents over the user's actual
 *     work.
 *
 *   - The compile pipeline reads source from disk. A project with no location
 *     could not be built at all, so "no location" is not a state worth
 *     supporting -- a scratch location is.
 *
 * The user-facing Save is refused for an ephemeral project and points at Save
 * As; the pre-build flush still writes here, which is why the build path needs
 * no change. Blocking every save would break compilation instead of protecting
 * anything.
 *
 * Everything in the archive is untrusted: it came from a device where the
 * stored project is neither signed nor encrypted, so anyone with filesystem
 * access could have replaced it. `parseProjectSnapshot` validates before
 * yielding content, and every path is re-checked here against the destination
 * before a single byte is written.
 */

import { promises as fs } from 'fs'
import { join, resolve, sep } from 'path'

import {
  parseProjectSnapshot,
  SnapshotArchiveError,
  type SnapshotLibrary,
  type SnapshotMetadata,
} from '../../shared/project/project-snapshot-archive'

export interface MaterializedProject {
  /** Scratch directory holding the project tree. */
  projectPath: string
  projectName: string
  metadata: SnapshotMetadata
  /** Bundled `.stlib` archives, for the caller to offer to install. */
  libraries: SnapshotLibrary[]
}

export interface MaterializeOptions {
  /** Directory to create the project folder inside. */
  scratchRoot: string
  /** Overridden in tests; defaults to a timestamp so two retrievals of the same
   *  project in one session do not collide. */
  folderName?: string
}

/**
 * A project name reduced to something safe to use as a directory name.
 *
 * The name comes from a device and is echoed straight into a path here, so it
 * gets the same treatment as any other untrusted path segment: separators,
 * traversal and control characters out. An empty result falls back rather than
 * producing a directory called "".
 */
export function safeFolderName(projectName: string): string {
  const cleaned = projectName
    // Separators first, so "a/b" becomes one segment rather than two directories.
    .replace(/[\\/]/g, '-')
    // Control characters (the NUL truncates a path in some syscalls) plus the
    // characters Windows reserves, including the colon that names an alternate
    // data stream.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f:*?"<>|]/g, '')
    // A leading dot gives a hidden directory, and a name of "." or ".." gives
    // the wrong directory entirely.
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 80)
  return cleaned || 'retrieved-project'
}

/**
 * Unpack `archive` into a fresh directory under `scratchRoot`.
 *
 * Throws `SnapshotArchiveError` for an archive that cannot be trusted or read;
 * nothing is written in that case, so a rejected archive never leaves a partial
 * project behind.
 */
export async function materializeRetrievedProject(
  archive: Uint8Array,
  options: MaterializeOptions,
): Promise<MaterializedProject> {
  const parsed = await parseProjectSnapshot(archive)

  const projectName = parsed.metadata.projectName || 'Retrieved project'
  const folder = options.folderName ?? `${safeFolderName(projectName)}-${Date.now()}`
  const projectPath = join(options.scratchRoot, folder)

  // Resolve every destination and confirm containment BEFORE writing anything.
  // parseProjectSnapshot already refuses escaping entries, but the guard that
  // matters is the one next to the write: this is the only place that knows
  // what the destination actually is.
  const destinationRoot = resolve(projectPath)
  const writes: Array<{ absolute: string; content: string }> = []
  for (const [relativePath, content] of parsed.files) {
    const absolute = resolve(destinationRoot, relativePath)
    if (absolute !== destinationRoot && !absolute.startsWith(destinationRoot + sep)) {
      throw new SnapshotArchiveError(
        `The device sent a project containing a file that would be written outside the destination: ${relativePath}`,
      )
    }
    writes.push({ absolute, content })
  }

  await fs.mkdir(destinationRoot, { recursive: true })
  for (const { absolute, content } of writes) {
    await fs.mkdir(join(absolute, '..'), { recursive: true })
    await fs.writeFile(absolute, content, 'utf-8')
  }

  return {
    projectPath: destinationRoot,
    projectName,
    metadata: parsed.metadata,
    libraries: parsed.libraries,
  }
}
