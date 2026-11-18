import { join } from 'node:path'

import type { WorkerClangRunnerPaths } from './worker-clang-runner'

export interface ToolchainLocation {
  isPackaged: boolean
  resourcesPath: string
  cwd: string
  /** The directory of the built main process, which also holds the built `clang-worker.js`. */
  mainDir: string
}

/**
 * Where the clang worker and the clang package live. The worker is built next to the main process; a packaged
 * app ships the prepared clang package as an extra resource outside the asar archive, anything else uses the prepared
 * copy in the repository (`release/yowasp-clang`, written by `scripts/prepare-yowasp-clang.ts`).
 */
export function resolveWasmToolchainPaths(location: ToolchainLocation): WorkerClangRunnerPaths {
  return {
    workerScript: join(location.mainDir, 'clang-worker.js'),
    toolchainDir: location.isPackaged
      ? join(location.resourcesPath, 'yowasp-clang')
      : join(location.cwd, 'release', 'yowasp-clang'),
  }
}
