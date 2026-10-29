/**
 * Where a cloud project keeps the files the cloud does not hold.
 *
 * A cloud project is addressed by its Edge id, not by a directory, so anything
 * that does `join(projectPath, …)` builds a RELATIVE path and writes into
 * `process.cwd()` — the repository root under `npm run dev`, and wherever the
 * app was launched from once packaged.
 *
 * Separate from `cloud-build-workspace` on purpose: build output is regenerable
 * and gets wiped at boot, while what lands here (the EtherCAT ESI repository) is
 * uploaded by hand, is not part of the project envelope, and would be gone on the
 * next restart if it shared that root.
 */

import { createHash } from 'node:crypto'
import { isAbsolute, join } from 'node:path'

import { app } from 'electron'

/** One safe path segment per project id; a hash for anything that is not already one. */
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,120}$/

function segmentFor(projectId: string): string {
  return SAFE_SEGMENT.test(projectId) ? projectId : createHash('sha256').update(projectId).digest('hex').slice(0, 32)
}

/** Root holding one directory per cloud project. Persistent, never wiped. */
export function cloudProjectDataRoot(): string {
  return join(app.getPath('userData'), 'cloud-projects')
}

/**
 * The directory `projectPath` may write project-local files into.
 *
 * An absolute path is a project on disk and is returned unchanged, so a local
 * project keeps its files beside its sources, where the user can see them.
 */
export function resolveProjectDataDir(projectPath: string): string {
  if (projectPath.length > 0 && isAbsolute(projectPath)) {
    return projectPath
  }

  return join(cloudProjectDataRoot(), segmentFor(projectPath))
}
