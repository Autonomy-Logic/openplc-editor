/**
 * Play on the OpenPLC Simulator: the editor builds the project to a WebAssembly module, runs it in a worker thread
 * and connects the debugger to it, so live values arrive; Play again stops it.
 *
 * Running needs a production build plus the preload copy; see "Electron e2e" in CLAUDE.md.
 */
import { cpSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { launch, quitApp } from './helpers/ethercat-project'

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
const PROJECT_NAME = 'simulator-fixture'
/** INSTANCE0.COUNTER in the fixture's debug map: array 0, element 0. */
const COUNTER = 0

function writeProject(slug: string): { userData: string } {
  const root = join(realpathSync(tmpdir()), slug)
  const project = join(root, 'project')
  const userData = join(root, 'userdata')
  rmSync(root, { recursive: true, force: true })
  cpSync(FIXTURE, project, { recursive: true })
  const history = join(userData, 'User', 'History')
  const runtime = join(userData, 'User', 'Runtime')
  mkdirSync(history, { recursive: true })
  mkdirSync(runtime, { recursive: true })
  mkdirSync(join(userData, 'arduino', 'data'), { recursive: true })
  writeFileSync(
    join(history, 'projects.json'),
    JSON.stringify([
      {
        name: PROJECT_NAME,
        path: project,
        projectFilePath: join(project, 'project.json'),
        createdAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
      },
    ]),
  )
  writeFileSync(join(history, 'libraries.json'), '[]')
  for (const control of ['arduino-core-control.json', 'arduino-library-control.json']) {
    writeFileSync(join(runtime, control), '[]')
  }
  return { userData }
}

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

test('Play builds the project, runs it as WebAssembly with live values, and Play again stops it', async () => {
  test.setTimeout(300000)
  const { userData } = writeProject('openplc-e2e-wasm-simulator-play')
  const { app, page } = await launch(userData)
  try {
    await page.getByText(PROJECT_NAME, { exact: true }).first().click({ timeout: 30000 })
    const play = page.getByRole('button', { name: 'Play' })
    const started = Date.now()
    await play.click({ timeout: 60000 })

    await expect.poll(() => simulatorRunning(page), { timeout: 180000 }).toBe(true)
    await expect.poll(() => readCounter(page), { timeout: 60000 }).toBeGreaterThan(0)
    const playToLiveMs = Date.now() - started
    const first = (await readCounter(page)) ?? 0
    await expect.poll(() => readCounter(page), { timeout: 30000 }).toBeGreaterThan(first)
    test.info().annotations.push({ type: 'play-to-live-ms', description: String(playToLiveMs) })
    console.log(`Play to live values: ${playToLiveMs} ms`)

    await play.click()
    await expect.poll(() => simulatorRunning(page), { timeout: 30000 }).toBe(false)
  } finally {
    await quitApp(app, page)
  }
})
