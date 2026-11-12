/**
 * Desktop clang worker thread (its own webpack entry, `clang-worker.js`). Supplies only the mechanism: the
 * parent port and how to import the toolchain; the shared host does the rest. It adds `WebAssembly.compileStreaming`
 * where the runtime lacks it, and rethrows a host failure outside the promise so the worker fails with that reason.
 */
import { parentPort, workerData } from 'node:worker_threads'

import { serveClangWorker } from '@root/backend/shared/wasm-toolchain/clang-worker-host'

const port = parentPort
const bundleUrl: unknown =
  typeof workerData === 'object' && workerData !== null ? Reflect.get(workerData, 'bundleUrl') : null
if (port === null || typeof bundleUrl !== 'string')
  throw new Error('clang-worker must run as a worker thread with a bundleUrl.')

if (typeof WebAssembly.compileStreaming !== 'function') {
  Reflect.set(WebAssembly, 'compileStreaming', async (source: Response | PromiseLike<Response>) =>
    WebAssembly.compile(await (await source).arrayBuffer()),
  )
}

serveClangWorker(() => import(/* webpackIgnore: true */ bundleUrl), {
  post: (message) => port.postMessage(message),
  onMessage: (listener) => port.on('message', listener),
}).catch((error: unknown) => {
  setImmediate(() => {
    throw error instanceof Error ? error : new Error(String(error))
  })
})
