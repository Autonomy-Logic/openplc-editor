import { Worker } from 'node:worker_threads'

import { PythonBlockHost } from '@root/backend/shared/python/python-block-host'
import { ThreadedPythonRuntime } from '@root/backend/shared/python/python-thread'
import type { PythonThreadMechanism } from '@root/middleware/shared/ports/python-mechanisms'

import type { PythonRuntimePaths } from './python-paths'

/** Starts the Python thread as a worker thread running `python-worker.js`; it lives for the process. */
export function createThreadPythonMechanism(paths: PythonRuntimePaths): PythonThreadMechanism {
  return {
    spawn: () => {
      const worker = new Worker(paths.workerScript, {
        workerData: { sdkEntry: paths.sdkEntry, pythonPackage: paths.pythonPackage, numpyWheel: paths.numpyWheel },
      })
      worker.unref()
      return {
        post: (message) => worker.postMessage(message),
        onMessage: (listener) => worker.on('message', listener),
        onFailure: (listener) => {
          worker.on('error', (error) => listener(error.message))
          worker.on('exit', (code) => listener(`the thread exited with code ${code}`))
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
export function createDesktopPython(paths: PythonRuntimePaths): DesktopPython {
  const runtime = new ThreadedPythonRuntime(createThreadPythonMechanism(paths))
  return { runtime, host: new PythonBlockHost(runtime) }
}
