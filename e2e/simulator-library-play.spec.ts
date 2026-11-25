/**
 * Play on the OpenPLC Simulator with library code: a program using TON and CTU from the bundled IEC library and a
 * function block of a user library. The build compiles each library from its own unit; the debugger must still read
 * live values through the debug map, and the user library's object is kept next to its archive, so the next Play
 * compiles no library unit.
 *
 * Running needs a production build; see "Electron e2e" in CLAUDE.md.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { _electron as electron, expect, type Page, test } from '@playwright/test'

import { pageText, waitForApp, waitForText } from './helpers/app-console'
import { shutdown } from './helpers/electron-editor'
import { copyPreload, freshProfile, openNewProject, waitForStartup } from './helpers/editor-session'

const ROOT = join(__dirname, '..')
const MAIN = join(ROOT, 'release', 'app', 'dist', 'main', 'main.js')
const FIXTURE = join(__dirname, 'fixtures', 'simulator-library-project')
const LIBRARY = 'user-delay'
/** INSTANCE0.COUNTER and INSTANCE0.PULSES in the fixture's debug map: array 0, elements 0 and 1. */
const COUNTER = 0
const PULSES = 1
const COMPILED = /Simulator module compiled: (\d+) files \((\d+) reused\)/

const simulatorRunning = (page: Page): Promise<boolean> =>
  page.evaluate(async () => {
    const bridge: unknown = Reflect.get(window, 'bridge')
    const isRunning: unknown =
      typeof bridge === 'object' && bridge !== null ? Reflect.get(bridge, 'simulatorIsRunning') : null
    return typeof isRunning === 'function' ? Boolean(await isRunning.call(bridge)) : false
  })

/** A DINT of the program as the debugger reads it, or null while it cannot. */
const readDint = (page: Page, index: number): Promise<number | null> =>
  page.evaluate(async (at) => {
    const bridge: unknown = Reflect.get(window, 'bridge')
    const read: unknown =
      typeof bridge === 'object' && bridge !== null ? Reflect.get(bridge, 'debuggerGetVariablesList') : null
    if (typeof read !== 'function') return null
    const result: unknown = await read.call(bridge, [at])
    const data: unknown = typeof result === 'object' && result !== null ? Reflect.get(result, 'data') : null
    if (!Array.isArray(data) || data.length < 4) return null
    return data[0] + data[1] * 256 + data[2] * 65536 + data[3] * 16777216
  }, index)

/** Installs the user library into a fresh profile, as the library manager does. */
function profileWithUserLibrary(): { userData: string; folder: string } {
  const userData = freshProfile('simulator-library')
  const folder = join(userData, 'libraries', LIBRARY)
  mkdirSync(folder, { recursive: true })
  const stlibPath = join(folder, `${LIBRARY}.stlib`)
  execFileSync(
    'npx',
    [
      'ts-node',
      '-T',
      '-r',
      'tsconfig-paths/register',
      join('e2e', 'fixtures', 'plc-user-library', 'make-library.ts'),
      stlibPath,
    ],
    { cwd: ROOT, stdio: 'pipe' },
  )
  writeFileSync(
    join(userData, 'libraries', 'registry.json'),
    JSON.stringify({
      formatVersion: '1.0',
      libraries: { [LIBRARY]: { version: '1.0.0', installedAt: new Date().toISOString(), stlibPath, origin: 'stlib' } },
    }),
  )
  return { userData, folder }
}

/** Plays, waits for live values from the program and the user library's block, then stops; returns the build line. */
async function playOnce(page: Page): Promise<{ files: number; reused: number }> {
  const play = page.getByRole('button', { name: 'Play' })
  await play.click({ timeout: 60000 })
  await page.getByRole('tab', { name: 'Console' }).click()
  await waitForApp(page, () => simulatorRunning(page), { timeout: 120000, message: 'the simulator never started' })
  await page.getByRole('tab', { name: 'Console' }).click()
  await waitForText(page, COMPILED, { timeout: 20000 })
  const lines = [...(await pageText(page)).matchAll(new RegExp(COMPILED.source, 'g'))]
  const last = lines[lines.length - 1]
  await waitForApp(page, async () => ((await readDint(page, COUNTER)) ?? 0) > 0, { message: 'no live counter' })
  const first = (await readDint(page, COUNTER)) ?? 0
  await waitForApp(page, async () => ((await readDint(page, COUNTER)) ?? 0) > first, { timeout: 30000 })
  await waitForApp(page, async () => ((await readDint(page, PULSES)) ?? 0) > 0, {
    timeout: 30000,
    message: "the user library's block never counted",
  })
  await play.click()
  await waitForApp(page, async () => !(await simulatorRunning(page)), { timeout: 30000 })
  return { files: Number(last[1]), reused: Number(last[2]) }
}

test('Play runs library code from its own units with live values, and keeps the user library object', async () => {
  test.setTimeout(240000)
  copyPreload()
  const { userData, folder } = profileWithUserLibrary()
  const app = await electron.launch({
    args: [MAIN, `--user-data-dir=${userData}`],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  try {
    const page = await waitForStartup(app)
    const editor = { app, page }
    await openNewProject(editor, FIXTURE, 'simulator-library')

    const first = await playOnce(page)
    expect(existsSync(join(folder, `${LIBRARY}.simulator.wasm-object`))).toBe(true)
    const again = await playOnce(page)
    expect(again.files).toBe(first.files)
    expect(again.reused).toBe(again.files)
  } finally {
    await shutdown(app)
  }
})
