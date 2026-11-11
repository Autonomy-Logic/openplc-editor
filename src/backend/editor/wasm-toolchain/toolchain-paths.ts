import { join } from 'node:path'

import type { WorkerClangRunnerPaths } from './worker-clang-runner'

export interface ToolchainLocation {
  isPackaged: boolean
  resourcesPath: string
  cwd: string
}

/**
 * Where the worker script and the clang package live. A packaged app ships both as extra resources outside the
 * asar archive; anything else runs from the repository.
 */
export function resolveWasmToolchainPaths(location: ToolchainLocation): WorkerClangRunnerPaths {
  return location.isPackaged
    ? {
        workerScript: join(location.resourcesPath, 'sources', 'wasm-toolchain', 'clang-worker.mjs'),
        toolchainDir: join(location.resourcesPath, 'yowasp-clang'),
      }
    : {
        workerScript: join(location.cwd, 'resources', 'sources', 'wasm-toolchain', 'clang-worker.mjs'),
        toolchainDir: join(location.cwd, 'node_modules', '@yowasp', 'clang'),
      }
}
