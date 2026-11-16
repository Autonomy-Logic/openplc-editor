// Test worker that loads, then stops on its first job, as a crashed compiler would.
import { parentPort } from 'node:worker_threads'

parentPort.on('message', () => process.exit(3))
parentPort.postMessage({ type: 'ready' })
