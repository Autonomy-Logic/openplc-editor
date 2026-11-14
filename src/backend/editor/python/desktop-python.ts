import { totalmem } from 'node:os'
import { Worker } from 'node:worker_threads'

import { PythonBlockHost } from '@root/backend/shared/python/python-block-host'
import { maxPythonInterpreters } from '@root/backend/shared/python/python-memory-budget'
import { ThreadedPythonRuntime } from '@root/backend/shared/python/python-thread'
import type { PythonThreadMechanism } from '@root/middleware/shared/ports/python-mechanisms'

import type { PythonRuntimePaths } from './python-paths'

/**
 * Starts the Python thread as a worker thread running `python-worker.js`; it lives for the process. The runtime's
 * files are located when the thread starts, so a missing or broken manifest fails the load instead of startup.
 */
export function createThreadPythonMechanism(resolvePaths: () => PythonRuntimePaths): PythonThreadMechanism {
  return {
    spawn: () => {
      const paths = resolvePaths()
      const worker = new Worker(paths.workerScript, {
        workerData: { sdkEntry: paths.sdkEntry, pythonPackage: paths.pythonPackage, numpyWheel: paths.numpyWheel },
      })
      worker.unref()
      let terminating = false
      return {
        post: (message) => worker.postMessage(message),
        onMessage: (listener) => worker.on('message', listener),
        onFailure: (listener) => {
          let reported = false
          const report = (reason: string): void => {
            if (reported || terminating) return
            reported = true
            listener(reason)
          }
          worker.on('error', (error) => report(error.message))
          worker.on('exit', (code) => report(`the thread exited with code ${code}`))
        },
        terminate: () => {
          terminating = true
          void worker.terminate()
        },
      }
    },
  }
}

export interface DesktopPython {
  runtime: ThreadedPythonRuntime
  host: PythonBlockHost
}

/** The process's Python runtime and the block host that uses it. */
export function createDesktopPython(resolvePaths: () => PythonRuntimePaths): DesktopPython {
  const runtime = new ThreadedPythonRuntime(createThreadPythonMechanism(resolvePaths))
  return { runtime, host: new PythonBlockHost(runtime, undefined, maxPythonInterpreters(totalmem())) }
}
