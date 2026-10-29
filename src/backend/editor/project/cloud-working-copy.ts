/**
 * A local working copy of an Autonomy Edge project.
 *
 * The compiler reads a project's files from its directory, and a cloud project has none:
 * its identifier is the Edge id. Materializing the project into the directory its build
 * already uses (`resolveBuildWorkspace`) lets the build read it exactly like a local one.
 * Edge stays the source of truth; the copy is refreshed on open, updated on save, and
 * emptied at boot with the rest of the cloud build root.
 */

import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'

import { iterateWriteProjectFiles } from '@root/backend/shared/project/iterate-write-project-files'

import type { RawProjectFile, WriteProjectFiles } from '../../../middleware/shared/ports/project-port'
import { resolveBuildWorkspace } from './cloud-build-workspace'

/** Build output survives a reopen, so a rebuild in the same session stays incremental. */
const KEPT_ON_REFRESH = new Set(['build'])

/** The files of a cloud project as `readCloudProject` receives them. */
export interface CloudProjectFiles {
  projectPath: string
  projectJson: string
  deviceConfig: string
  pinMapping: string
  /** Empty string is the "no library.json" sentinel. */
  libraryManifest: string
  pouFiles: RawProjectFile[]
  serverFiles: RawProjectFile[]
  remoteDeviceFiles: RawProjectFile[]
  dataTypeFiles: RawProjectFile[]
}

let sequence = 0
/** Sequence of the newest read or save applied to each project, so nothing older can overwrite it. */
const lastApplied = new Map<string, number>()
/** One working-copy operation at a time per project, so a refresh never interleaves with a save. */
const queues = new Map<string, Promise<unknown>>()

/** Called before a project read is sent; pass the result to `materializeCloudProject`. */
export function beginCloudProjectRead(): number {
  return ++sequence
}

/** Run `task` after every earlier operation on the same project has settled. */
function exclusive<T>(projectId: string, task: () => Promise<T>): Promise<T> {
  const run = (queues.get(projectId) ?? Promise.resolve()).catch(() => undefined).then(task)
  queues.set(projectId, run)
  return run
}

/**
 * The working-copy directory of a cloud project.
 *
 * Throws for an absolute path: `resolveBuildWorkspace` returns a local project's own
 * directory unchanged, and clearing that would delete the user's project.
 */
function workingCopyDir(projectId: string): string {
  if (projectId.length > 0 && isAbsolute(projectId)) {
    throw new Error(`Not a cloud project: ${projectId}`)
  }

  return resolveBuildWorkspace(projectId)
}

/**
 * Resolve a project-relative path from the API inside `dir`.
 *
 * Any `.`/`..`/empty segment is refused, even one that stays inside the copy: a remote-device
 * named `../pin-mapping.json` would otherwise overwrite the pin mapping.
 */
function insidePath(dir: string, relativePath: string): string {
  const segments = relativePath.split(/[\\/]/)
  if (isAbsolute(relativePath) || segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`Refusing a project file outside its place in the working copy: ${relativePath}`)
  }

  return join(dir, ...segments)
}

/** Every write target of `files` under `dir`, all validated before any is used. */
function plannedWrites(dir: string, files: WriteProjectFiles): Array<{ target: string; content: string }> {
  return Array.from(iterateWriteProjectFiles(files), (entry) => ({
    target: insidePath(dir, entry.relativePath),
    content: entry.content,
  }))
}

/** Write already-validated targets. */
async function writeAll(writes: Array<{ target: string; content: string }>): Promise<void> {
  for (const { target, content } of writes) {
    await fs.mkdir(dirname(target), { recursive: true })
    await fs.writeFile(target, content, 'utf-8')
  }
}

/**
 * Replace the working copy with the files Edge just sent.
 *
 * The new copy is staged beside the old one and swapped in only once it is complete, so a
 * failed refresh leaves the previous copy usable. Returns false when a newer read or a save was
 * applied after `readStartedAt`, since this read then carries an older version than the copy has.
 */
export function materializeCloudProject(project: CloudProjectFiles, readStartedAt?: number): Promise<boolean> {
  return exclusive(project.projectPath, async () => {
    if (readStartedAt !== undefined && (lastApplied.get(project.projectPath) ?? 0) > readStartedAt) {
      return false
    }

    const dir = workingCopyDir(project.projectPath)
    const files: WriteProjectFiles = {
      projectPath: project.projectPath,
      projectJson: project.projectJson,
      deviceConfig: project.deviceConfig,
      pinMapping: project.pinMapping,
      libraryManifest: project.libraryManifest.length > 0 ? project.libraryManifest : undefined,
      pouFiles: project.pouFiles,
      serverFiles: project.serverFiles,
      remoteDeviceFiles: project.remoteDeviceFiles,
      dataTypeFiles: project.dataTypeFiles,
      deletions: [],
    }

    const staging = `${dir}.staging-${randomUUID()}`
    try {
      await writeAll(plannedWrites(staging, files))
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true })
      throw error
    }

    await fs.mkdir(dir, { recursive: true })
    for (const name of await fs.readdir(dir)) {
      if (!KEPT_ON_REFRESH.has(name)) await fs.rm(join(dir, name), { recursive: true, force: true })
    }
    for (const name of await fs.readdir(staging)) {
      await fs.rename(join(staging, name), join(dir, name))
    }
    await fs.rm(staging, { recursive: true, force: true })
    if (readStartedAt !== undefined) lastApplied.set(project.projectPath, readStartedAt)
    return true
  })
}

/** Mirror a project save Edge accepted, deletions included; every path is checked before the first write. */
export function applyCloudProjectSave(files: WriteProjectFiles): Promise<void> {
  return exclusive(files.projectPath, async () => {
    const dir = workingCopyDir(files.projectPath)
    const writes = plannedWrites(dir, files)
    const deletions = files.deletions.filter((path) => path.length > 0).map((path) => insidePath(dir, path))

    lastApplied.set(files.projectPath, ++sequence)
    await writeAll(writes)
    for (const target of deletions) await fs.rm(target, { force: true })
  })
}

/** Mirror a single-file save Edge accepted. */
export function applyCloudFileSave(projectId: string, relativePath: string, content: string): Promise<void> {
  return exclusive(projectId, async () => {
    const target = insidePath(workingCopyDir(projectId), relativePath)

    lastApplied.set(projectId, ++sequence)
    await writeAll([{ target, content }])
  })
}
