/**
 * Play on the OpenPLC Simulator: the editor builds the project to a WebAssembly module, runs it in a worker thread
 * and connects the debugger to it, so live values arrive; Play again stops it. The build runs on one clang worker
 * thread, which has ended once the simulator runs, and a project without Python blocks starts no Python thread. That
 * the editor starts with neither is the cold-start case of `wasm-toolchain.spec.ts`.
 *
 * The test opens a new project in the worker's editor. Running needs a production build; see "Electron e2e" in
 * CLAUDE.md.
 */
import { join } from 'node:path'

import { expect, type Page } from '@playwright/test'

import { waitForApp } from './helpers/app-console'
import { openNewProject, test } from './helpers/editor-session'
import { countOf, resetWorkerThreadPeaks, trackWorkerThreads, workerThreads } from './helpers/worker-threads'

const FIXTURE = join(
  __dirname,
  '..',
  'src',
  'backend',
  'shared',
  'simulator',
  '__tests__',
  'fixtures',
  'simulator-project',
)
/** INSTANCE0.COUNTER in the fixture's debug map: array 0, element 0. */
const COUNTER = 0

const simulatorRunning = (page: Page): Promise<boolean> =>
  page.evaluate(async () => {
    const bridge: unknown = Reflect.get(window, 'bridge')
    const isRunning: unknown =
      typeof bridge === 'object' && bridge !== null ? Reflect.get(bridge, 'simulatorIsRunning') : null
    return typeof isRunning === 'function' ? Boolean(await isRunning.call(bridge)) : false
  })

/** The program's counter as the debugger reads it, or null while it cannot. */
const readCounter = (page: Page): Promise<number | null> =>
  page.evaluate(async (index) => {
    const bridge: unknown = Reflect.get(window, 'bridge')
    const read: unknown =
      typeof bridge === 'object' && bridge !== null ? Reflect.get(bridge, 'debuggerGetVariablesList') : null
    if (typeof read !== 'function') return null
    const result: unknown = await read.call(bridge, [index])
    const data: unknown = typeof result === 'object' && result !== null ? Reflect.get(result, 'data') : null
    if (!Array.isArray(data) || data.length < 4) return null
    return data[0] + data[1] * 256 + data[2] * 65536 + data[3] * 16777216
  }, COUNTER)

test('Play builds the project, runs it as WebAssembly with live values, and Play again stops it', async ({
  editor,
}) => {
  test.setTimeout(180000)
  const { app, page } = editor
  await openNewProject(editor, FIXTURE, 'simulator-fixture')
  await trackWorkerThreads(app)
  await resetWorkerThreadPeaks(app)
  const before = await workerThreads(app)
  expect(countOf(before.live, 'clang-worker.js')).toBe(0)

  const play = page.getByRole('button', { name: 'Play' })
  const started = Date.now()
  await play.click({ timeout: 60000 })

  await waitForApp(page, () => simulatorRunning(page), { timeout: 90000, message: 'the simulator never started' })
  const whileRunning = await workerThreads(app)
  expect(countOf(whileRunning.live, 'clang-worker.js')).toBe(0)
  expect(countOf(whileRunning.started, 'clang-worker.js')).toBeGreaterThan(countOf(before.started, 'clang-worker.js'))
  expect(whileRunning.maxLive['clang-worker.js']).toBe(1)
  expect(countOf(whileRunning.live, 'simulator-worker.js')).toBe(1)
  expect(countOf(whileRunning.started, 'python-worker.js')).toBe(countOf(before.started, 'python-worker.js'))
  await waitForApp(page, async () => ((await readCounter(page)) ?? 0) > 0, { message: 'no live values' })
  const playToLiveMs = Date.now() - started
  const first = (await readCounter(page)) ?? 0
  await waitForApp(page, async () => ((await readCounter(page)) ?? 0) > first, { timeout: 30000 })
  test.info().annotations.push({ type: 'play-to-live-ms', description: String(playToLiveMs) })
  console.log(`Play to live values: ${playToLiveMs} ms`)

  await play.click()
  await waitForApp(page, async () => !(await simulatorRunning(page)), { timeout: 30000 })
})
