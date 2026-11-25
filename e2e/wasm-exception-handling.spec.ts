/**
 * WebAssembly exception handling with exnref runs in the editor with no flag, in the main process and a worker
 * thread, where the simulator's Python runtime runs on the desktop and the CLI. The renderer is not checked: its CSP
 * allows no WebAssembly, and nothing compiles it there.
 *
 * Running needs a production build; see "Electron e2e" in CLAUDE.md.
 */
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { EXNREF_MODULE } from './fixtures/exnref-module'
import { launch, quitApp } from './helpers/ethercat-project'

test('an exnref module runs in the main process and in a worker thread', async () => {
  const { app, page } = await launch(join(__dirname, '..', 'test-results', 'exnref-userdata'))
  try {
    const inMain = await app.evaluate((_electron, bytes) => {
      const instance = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(bytes)))
      const run = instance.exports.run
      return typeof run === 'function' ? Number(run()) : null
    }, EXNREF_MODULE)
    expect(inMain).toBe(42)

    const inThread = await app.evaluate(
      (_electron, bytes) =>
        new Promise<unknown>((resolve) => {
          const { Worker } = process.getBuiltinModule('node:worker_threads')
          const source = `const { parentPort, workerData } = require('node:worker_threads')
            const instance = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(workerData)))
            parentPort.postMessage(instance.exports.run())`
          const worker = new Worker(source, { eval: true, workerData: bytes })
          worker.on('message', resolve)
          worker.on('error', (error) => resolve(error.message))
        }),
      EXNREF_MODULE,
    )
    expect(inThread).toBe(42)
  } finally {
    await quitApp(app, page)
  }
})
