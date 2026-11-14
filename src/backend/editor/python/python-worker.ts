/**
 * Desktop Python worker thread (its own webpack entry, `python-worker.js`). Supplies only the mechanism: the parent
 * port, the Wasmer SDK imported from its own folder, and the runtime files read from disk.
 */
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { parentPort, workerData } from 'node:worker_threads'

import { servePythonThread } from '@root/backend/shared/python/python-thread'
import { isWasmerSdk, WasmerPythonRuntime } from '@root/backend/shared/python/wasmer-python-runtime'

const field = (name: string): string => {
  const value: unknown = typeof workerData === 'object' && workerData !== null ? Reflect.get(workerData, name) : null
  if (typeof value !== 'string') throw new Error(`python-worker needs '${name}' in its workerData.`)
  return value
}

const port = parentPort
if (port === null) throw new Error('python-worker must run as a worker thread.')

servePythonThread(
  {
    post: (message) => port.postMessage(message),
    onMessage: (listener) => port.on('message', listener),
  },
  async () => {
    const sdk: unknown = await import(/* webpackIgnore: true */ pathToFileURL(field('sdkEntry')).href)
    if (!isWasmerSdk(sdk)) throw new Error('The Wasmer SDK does not export Wasmer.create.')
    const [pythonPackage, numpyWheel] = await Promise.all([
      readFile(field('pythonPackage')),
      readFile(field('numpyWheel')),
    ])
    return WasmerPythonRuntime.load(sdk, {
      pythonPackage: new Uint8Array(pythonPackage.buffer, pythonPackage.byteOffset, pythonPackage.byteLength),
      numpyWheel: new Uint8Array(numpyWheel.buffer, numpyWheel.byteOffset, numpyWheel.byteLength),
    })
  },
)
