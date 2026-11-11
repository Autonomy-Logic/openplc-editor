import { access } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'

import { clangWorkerCount, ClangWorkerPool } from '@root/backend/shared/wasm-toolchain/clang-worker-pool'
import type { ClangWorkerHandle, ClangWorkerMechanism } from '@root/middleware/shared/ports/wasm-toolchain-mechanisms'

export interface WorkerClangRunnerPaths {
  /** The built worker script (`clang-worker.js`, from `clang-worker.ts`). */
  workerScript: string
  /** The root of the `@yowasp/clang` package, holding `gen/bundle.js` and its WebAssembly files. */
  toolchainDir: string
}

/** Desktop mechanism: each clang worker is a Node worker thread. */
export function createThreadClangWorkerMechanism(paths: WorkerClangRunnerPaths): ClangWorkerMechanism {
  const bundlePath = join(paths.toolchainDir, 'gen', 'bundle.js')
  return {
    load: () => access(bundlePath),
    spawn: (): ClangWorkerHandle => {
      const worker = new Worker(paths.workerScript, { workerData: { bundleUrl: pathToFileURL(bundlePath).href } })
      // A pool of idle workers must not keep a command-line run alive.
      worker.unref()
      return {
        post: (message) => worker.postMessage(message),
        onMessage: (listener) => worker.on('message', listener),
        onFailure: (listener) => {
          worker.on('error', (error) => listener(error.message))
          worker.on('exit', (code) => listener(`exit code ${code}`))
        },
        terminate: () => worker.terminate(),
      }
    },
  }
}

/** Runs clang in a pool of worker threads, each with its own copy of the toolchain loaded. */
export class WorkerClangRunner extends ClangWorkerPool {
  constructor(paths: WorkerClangRunnerPaths, concurrency: number = clangWorkerCount(availableParallelism())) {
    super(createThreadClangWorkerMechanism(paths), concurrency)
  }
}
