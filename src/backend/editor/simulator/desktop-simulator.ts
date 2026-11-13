import { join } from 'node:path'
import { Worker } from 'node:worker_threads'

import { PythonSimulator } from '@root/backend/shared/python/python-simulator'
import { ThreadedSimulator } from '@root/backend/shared/simulator/simulator-thread'
import type { SimulatorThreadMechanism } from '@root/middleware/shared/ports/simulator-mechanisms'

import { getDesktopPython } from '../python/desktop-python-service'

/** Starts each simulator run in a worker thread running `simulator-worker.js`, built next to `main.js`. */
export function createThreadSimulatorMechanism(workerScript: string): SimulatorThreadMechanism {
  return {
    spawn: () => {
      const worker = new Worker(workerScript)
      let terminating = false
      return {
        post: (message) => worker.postMessage(message),
        onMessage: (listener) => worker.on('message', listener),
        onFailure: (listener) => {
          worker.on('error', (error) => listener(error.message))
          worker.on('exit', (code) => {
            if (!terminating) listener(`the thread exited with code ${code}`)
          })
        },
        terminate: async () => {
          terminating = true
          await worker.terminate()
        },
      }
    },
  }
}

/**
 * The editor's simulator: one long-lived handle whose runs each get their own worker thread, with the process's
 * Python block host running their Python blocks.
 */
export function createDesktopSimulator(): PythonSimulator {
  return new PythonSimulator(
    new ThreadedSimulator(createThreadSimulatorMechanism(join(__dirname, 'simulator-worker.js'))),
    getDesktopPython().host,
  )
}
