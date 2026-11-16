import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'

import { ClangWorkerPool } from '@root/backend/shared/wasm-toolchain/clang-worker-pool'
import { requireFiles, WASM_TOOLCHAIN_PACKAGE_FILES } from '@root/backend/shared/wasm-toolchain/toolchain-files'
import type { ClangWorkerHandle, ClangWorkerMechanism } from '@root/middleware/shared/ports/wasm-toolchain-mechanisms'

export interface WorkerClangRunnerPaths {
  /** The built worker script (`clang-worker.js`, from `clang-worker.ts`). */
  workerScript: string
  /** The root of the `@yowasp/clang` package, holding `gen/bundle.js` and its WebAssembly files. */
  toolchainDir: string
}

/** Whether a file exists. */
const fileExists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  )

/** Desktop mechanism: each clang worker is a Node worker thread, which holds the process only while it runs a job. */
export function createThreadClangWorkerMechanism(paths: WorkerClangRunnerPaths): ClangWorkerMechanism {
  const bundlePath = join(paths.toolchainDir, 'gen', 'bundle.js')
  return {
    load: () =>
      requireFiles(
        WASM_TOOLCHAIN_PACKAGE_FILES.map((file) => join(paths.toolchainDir, file)),
        fileExists,
        'toolchain',
      ),
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
  }
}

/** Runs clang on one worker thread, started by a job and ended on `release()`. */
export class WorkerClangRunner extends ClangWorkerPool {
  constructor(paths: WorkerClangRunnerPaths) {
    super(createThreadClangWorkerMechanism(paths))
  }
}
