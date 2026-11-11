// Test worker that answers every job with its argv as stderr and its tree unchanged.
import { parentPort } from 'node:worker_threads'

parentPort.on('message', ({ id, argv, tree }) => {
  parentPort.postMessage({ type: 'result', id, result: { exitCode: 0, stderr: argv.join(' '), tree } })
})
parentPort.postMessage({ type: 'ready' })
