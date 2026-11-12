import { join } from 'node:path'
import { Worker } from 'node:worker_threads'

import { ThreadedSimulator } from '@root/backend/shared/simulator/simulator-thread'
import type { SimulatorThreadMechanism } from '@root/middleware/shared/ports/simulator-mechanisms'

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

/** The editor's simulator: one long-lived handle whose runs each get their own worker thread. */
export function createDesktopSimulator(): ThreadedSimulator {
  return new ThreadedSimulator(createThreadSimulatorMechanism(join(__dirname, 'simulator-worker.js')))
}
