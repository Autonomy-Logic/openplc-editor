/**
 * A local working copy of an Autonomy Edge project.
 *
 * The compiler reads a project's files from its directory, and a cloud project has none:
 * its identifier is the Edge id. Materializing the project into the directory its build
 * already uses (`resolveBuildWorkspace`) lets the build read it exactly like a local one.
 * Edge stays the source of truth; the copy is refreshed on open, updated on save, and
 * emptied at boot with the rest of the cloud build root.
 */

import { promises as fs } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

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

function isInside(dir: string, filePath: string): boolean {
  const rel = relative(resolve(dir), resolve(filePath))
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

/** Paths come from the API, so one that escapes the working copy is refused, never written. */
function insidePath(dir: string, relativePath: string): string {
  const target = join(dir, relativePath)
  if (!isInside(dir, target)) {
    throw new Error(`Refusing a project file outside the working copy: ${relativePath}`)
  }

  return target
}

async function writeFiles(dir: string, files: WriteProjectFiles): Promise<void> {
  for (const entry of iterateWriteProjectFiles(files)) {
    const target = insidePath(dir, entry.relativePath)
    await fs.mkdir(dirname(target), { recursive: true })
    await fs.writeFile(target, entry.content, 'utf-8')
  }
}

/** Replace the working copy with the files Edge just sent. */
export async function materializeCloudProject(project: CloudProjectFiles): Promise<void> {
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

  // Every path is checked before anything is removed, so a hostile envelope leaves the old copy intact.
  for (const entry of iterateWriteProjectFiles(files)) insidePath(dir, entry.relativePath)

  await fs.mkdir(dir, { recursive: true })
  for (const name of await fs.readdir(dir)) {
    if (!KEPT_ON_REFRESH.has(name)) await fs.rm(join(dir, name), { recursive: true, force: true })
  }

  await writeFiles(dir, files)
}

/** Mirror a project save Edge accepted, deletions included. */
export async function applyCloudProjectSave(files: WriteProjectFiles): Promise<void> {
  const dir = workingCopyDir(files.projectPath)
  const deletions = files.deletions.filter((path) => path.length > 0).map((path) => insidePath(dir, path))

  await writeFiles(dir, files)
  for (const target of deletions) await fs.rm(target, { force: true })
}

/** Mirror a single-file save Edge accepted. */
export async function applyCloudFileSave(projectId: string, relativePath: string, content: string): Promise<void> {
  const target = insidePath(workingCopyDir(projectId), relativePath)
  await fs.mkdir(dirname(target), { recursive: true })
  await fs.writeFile(target, content, 'utf-8')
}
