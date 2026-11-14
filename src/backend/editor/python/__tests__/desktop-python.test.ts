/**
 * createThreadPythonMechanism against real worker threads running tiny scripts from a temporary directory.
 * @jest-environment node
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'

import { afterAll, afterEach, describe, expect, it, jest } from '@jest/globals'

import type { PythonThreadHandle, PythonThreadMechanism } from '@root/middleware/shared/ports/python-mechanisms'

import { createThreadPythonMechanism } from '../desktop-python'
import type { PythonRuntimePaths } from '../python-paths'

const root = mkdtempSync(join(tmpdir(), 'desktop-python-'))
const threads: PythonThreadHandle[] = []

afterEach(() => {
  for (const thread of threads.splice(0)) thread.terminate()
  jest.restoreAllMocks()
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

/** Writes a worker script and returns the paths that point the mechanism at it. */
function workerPaths(name: string, source: string): PythonRuntimePaths {
  const workerScript = join(root, `${name}.js`)
  writeFileSync(workerScript, source)
  return {
    workerScript,
    sdkEntry: '/sdk/node.js',
    pythonPackage: '/runtime/python.webc',
    numpyWheel: '/runtime/np.whl',
  }
}

const ECHO_WORKER = `
const { parentPort, workerData } = require('node:worker_threads')
parentPort.on('message', (message) => parentPort.postMessage({ message, workerData }))
setInterval(() => {}, 1000)
`

async function spawn(mechanism: PythonThreadMechanism): Promise<PythonThreadHandle> {
  const thread = await mechanism.spawn()
  threads.push(thread)
  return thread
}

function nextMessage(thread: PythonThreadHandle): Promise<unknown> {
  return new Promise((resolve) => thread.onMessage(resolve))
}

function nextFailure(thread: PythonThreadHandle): Promise<string> {
  return new Promise((resolve) => thread.onFailure(resolve))
}

describe('createThreadPythonMechanism', () => {
  it('locates the runtime only when the thread starts, so a failing resolver throws from spawn', () => {
    const resolvePaths = jest.fn((): PythonRuntimePaths => {
      throw new Error('python-runtime.json is missing')
    })

    const mechanism = createThreadPythonMechanism(resolvePaths)

    expect(resolvePaths).not.toHaveBeenCalled()
    expect(() => mechanism.spawn()).toThrow('python-runtime.json is missing')
    expect(resolvePaths).toHaveBeenCalledTimes(1)
  })

  it('runs the resolved worker script with the runtime locations and carries messages both ways', async () => {
    const paths = workerPaths('echo', ECHO_WORKER)
    const thread = await spawn(createThreadPythonMechanism(() => paths))

    const reply = nextMessage(thread)
    thread.post({ type: 'ping' })

    await expect(reply).resolves.toEqual({
      message: { type: 'ping' },
      workerData: { sdkEntry: paths.sdkEntry, pythonPackage: paths.pythonPackage, numpyWheel: paths.numpyWheel },
    })
  })

  it('reports a failure when the worker exits on its own', async () => {
    const thread = await spawn(createThreadPythonMechanism(() => workerPaths('exits', 'process.exit(3)')))

    await expect(nextFailure(thread)).resolves.toBe('the thread exited with code 3')
  })

  it('reports a failure when the worker throws', async () => {
    const thread = await spawn(createThreadPythonMechanism(() => workerPaths('throws', "throw new Error('boom')")))

    const failures: string[] = []
    thread.onFailure((reason) => failures.push(reason))
    await expect(nextFailure(thread)).resolves.toBe('boom')
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(failures).toEqual(['boom'])
  })

  it('does not report the exit that terminate() causes as a failure', async () => {
    const terminate = jest.spyOn(Worker.prototype, 'terminate')
    const thread = await spawn(createThreadPythonMechanism(() => workerPaths('terminated', ECHO_WORKER)))
    const failures: string[] = []
    thread.onFailure((reason) => failures.push(reason))
    const ready = nextMessage(thread)
    thread.post('ready?')
    await ready

    thread.terminate()

    expect(terminate).toHaveBeenCalledTimes(1)
    await terminate.mock.results[0].value
    await new Promise((resolve) => setImmediate(resolve))
    expect(failures).toEqual([])
  })
})
