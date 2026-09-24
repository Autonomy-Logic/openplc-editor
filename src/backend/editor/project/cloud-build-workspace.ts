/**
 * Where a build may write when the project has no directory of its own.
 *
 * A cloud project is identified by its Edge id, not by a path, so every
 * `join(projectPath, 'build', …)` in the compiler produced a RELATIVE path and
 * landed in `process.cwd()`: the repository root under `npm run dev`, and
 * whatever directory the app happened to be launched from once packaged.
 */

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { isAbsolute, join } from 'node:path'

import { app } from 'electron'

/** One safe path segment per project id; a hash for anything that is not already one. */
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,120}$/

function segmentFor(projectId: string): string {
  return SAFE_SEGMENT.test(projectId) ? projectId : createHash('sha256').update(projectId).digest('hex').slice(0, 32)
}

/** Scratch root holding one directory per cloud project built this session. */
export function cloudBuildRoot(): string {
  return join(app.getPath('userData'), 'cloud-builds')
}

/**
 * The directory a build for `projectPath` owns.
 *
 * An absolute path is a project on disk and is returned unchanged, so local
 * projects keep building next to their sources and stay incremental.
 */
export function resolveBuildWorkspace(projectPath: string): string {
  if (!isCloudBuild(projectPath)) {
    return projectPath
  }

  return join(cloudBuildRoot(), segmentFor(projectPath))
}

/** True when `projectPath` is an Edge id, so its build runs in the scratch workspace. */
export function isCloudBuild(projectPath: string): boolean {
  return !(projectPath.length > 0 && isAbsolute(projectPath))
}

/**
 * Write a cloud project's device files where the compiler reads them.
 *
 * The compiler reads `devices/*.json` from the build's project directory, and a cloud project's
 * scratch workspace only ever holds build output. A local project is refused, never overwritten:
 * its files already sit beside it.
 */
export async function writeCloudBuildDeviceFiles(
  projectPath: string,
  files: { configuration: string; pinMapping: string },
): Promise<boolean> {
  if (!isCloudBuild(projectPath)) {
    return false
  }

  const devicesDir = join(resolveBuildWorkspace(projectPath), 'devices')
  await fs.mkdir(devicesDir, { recursive: true })
  await fs.writeFile(join(devicesDir, 'configuration.json'), files.configuration, 'utf-8')
  await fs.writeFile(join(devicesDir, 'pin-mapping.json'), files.pinMapping, 'utf-8')
  return true
}

/**
 * Empty the scratch root. Called once at boot: the cloud is the source of truth
 * for these projects, so nothing here is worth carrying across a restart.
 */
export async function clearCloudBuildRoot(): Promise<void> {
  await fs.rm(cloudBuildRoot(), { recursive: true, force: true })
}
