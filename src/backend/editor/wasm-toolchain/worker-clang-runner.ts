import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { cpus, freemem } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'

import { fileExists } from '@root/backend/editor/utils/file-exists'
import { ClangWorkerPool } from '@root/backend/shared/wasm-toolchain/clang-worker-pool'
import { checkWasmToolchainPackage } from '@root/backend/shared/wasm-toolchain/toolchain-files'
import { darwinAvailableBytes, linuxAvailableBytes } from '@root/backend/shared/wasm-toolchain/worker-limit'
import type { ClangWorkerHandle, ClangWorkerMechanism } from '@root/middleware/shared/ports/wasm-toolchain-mechanisms'

export interface WorkerClangRunnerPaths {
  /** The built worker script (`clang-worker.js`, from `clang-worker.ts`). */
  workerScript: string
  /** The root of the prepared `@yowasp/clang` package, holding the patched `gen/bundle.js` and its WebAssembly files. */
  toolchainDir: string
}

/**
 * Memory the OS can hand out now: `vm_stat` on macOS, `/proc/meminfo` on Linux, `os.freemem()` on Windows (which
 * reports available memory there); undefined when it cannot be read.
 */
function availableMemoryBytes(): number | undefined {
  try {
    if (process.platform === 'darwin') return darwinAvailableBytes(execFileSync('vm_stat', { encoding: 'utf8' }))
    if (process.platform === 'linux') return linuxAvailableBytes(readFileSync('/proc/meminfo', 'utf8'))
    if (process.platform === 'win32') return freemem()
  } catch {
    return undefined
  }
  return undefined
}

/** Desktop mechanism: each clang worker is a Node worker thread, which holds the process only while it runs a job. */
export function createThreadClangWorkerMechanism(paths: WorkerClangRunnerPaths): ClangWorkerMechanism {
  const bundlePath = join(paths.toolchainDir, 'gen', 'bundle.js')
  return {
    load: () =>
      checkWasmToolchainPackage((file) => join(paths.toolchainDir, file), {
        exists: fileExists,
        readText: (path) => readFile(path, 'utf8'),
      }),
    spawn: (): ClangWorkerHandle => {
      const worker = new Worker(paths.workerScript, { workerData: { bundleUrl: pathToFileURL(bundlePath).href } })
      return {
        post: (message) => worker.postMessage(message),
        onMessage: (listener) => worker.on('message', listener),
        onFailure: (listener) => {
          worker.on('error', (error) => listener(error.message))
          worker.on('exit', (code) => listener(`exit code ${code}`))
        },
        setBusy: (busy) => (busy ? worker.ref() : worker.unref()),
        terminate: () => worker.terminate(),
      }
    },
    availableMemoryBytes,
    cores: () => cpus().length,
  }
}

/** Runs clang on worker threads, one unless held, started by jobs and ended on `release()`. */
export class WorkerClangRunner extends ClangWorkerPool {
  constructor(paths: WorkerClangRunnerPaths) {
    super(createThreadClangWorkerMechanism(paths))
  }
}
