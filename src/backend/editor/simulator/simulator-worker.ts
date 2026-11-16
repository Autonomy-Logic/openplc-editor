/** Worker thread entry: runs the OpenPLC Simulator's module through the shared simulator thread host. */
import { parentPort } from 'node:worker_threads'

import { serveSimulatorThread } from '@root/backend/shared/simulator/simulator-thread'

const port = parentPort
if (port) {
  serveSimulatorThread({
    post: (message) => port.postMessage(message),
    onMessage: (listener) => port.on('message', listener),
  })
}
