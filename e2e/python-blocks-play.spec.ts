/**
 * Python function blocks on the OpenPLC Simulator (desktop): Play runs each block in its own interpreter next to the
 * PLC. A block with a thread and numpy updates its outputs; one that raises shows its traceback and keeps its last
 * outputs; one that never yields does not hold the PLC; one that opens a socket fails with a traceback; Stop ends
 * them all.
 *
 * Running needs a production build plus the preload copy; see "Electron e2e" in CLAUDE.md.
 */
import { cpSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { waitForApp, waitForText } from './helpers/app-console'
import { launch, quitApp } from './helpers/ethercat-project'

const FIXTURE = join(__dirname, 'fixtures', 'python-blocks')
const PROJECT_NAME = 'python-blocks'

interface Leaf {
  elemIdx: number
  path: string
  type: string
  size: number
}

function writeProject(slug: string): { userData: string; project: string } {
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
  return { userData, project }
}

function readLeaves(project: string): Leaf[] {
  const map: unknown = JSON.parse(
    readFileSync(join(project, 'build', 'OpenPLC Simulator', 'src', 'debug-map.json'), 'utf8'),
  )
  const leaves: unknown = typeof map === 'object' && map !== null ? Reflect.get(map, 'leaves') : null
  if (!Array.isArray(leaves)) throw new Error('debug-map.json has no leaves')
  return leaves.filter(
    (leaf): leaf is Leaf =>
      typeof leaf === 'object' &&
      leaf !== null &&
      typeof Reflect.get(leaf, 'elemIdx') === 'number' &&
      typeof Reflect.get(leaf, 'path') === 'string',
  )
}

const simulatorRunning = (page: Page): Promise<boolean> =>
  page.evaluate(async () => {
    const bridge: unknown = Reflect.get(window, 'bridge')
    const isRunning: unknown =
      typeof bridge === 'object' && bridge !== null ? Reflect.get(bridge, 'simulatorIsRunning') : null
    return typeof isRunning === 'function' ? Boolean(await isRunning.call(bridge)) : false
  })

/** The program variables the test watches, read through the debugger; `null` while it cannot read them. */
async function readVariables(page: Page, leaves: Leaf[], names: string[]): Promise<Record<string, number> | null> {
  const wanted = names.map((name) => {
    const leaf = leaves.find((entry) => entry.path === `INSTANCE0.${name}`)
    if (!leaf) throw new Error(`No debug leaf for ${name}`)
    return leaf
  })
  const data = await page.evaluate(
    async (indexes) => {
      const bridge: unknown = Reflect.get(window, 'bridge')
      const read: unknown =
        typeof bridge === 'object' && bridge !== null ? Reflect.get(bridge, 'debuggerGetVariablesList') : null
      if (typeof read !== 'function') return null
      const result: unknown = await read.call(bridge, indexes)
      const bytes: unknown = typeof result === 'object' && result !== null ? Reflect.get(result, 'data') : null
      return Array.isArray(bytes) ? bytes.map(Number) : null
    },
    wanted.map((leaf) => leaf.elemIdx),
  )
  if (data === null) return null
  const view = new DataView(new Uint8Array(data).buffer)
  const values: Record<string, number> = {}
  let offset = 0
  for (const [n, leaf] of wanted.entries()) {
    if (offset + leaf.size > view.byteLength) return null
    values[names[n]] = leaf.type === 'REAL' ? view.getFloat32(offset, true) : view.getInt32(offset, true)
    offset += leaf.size
  }
  return values
}

test('Python blocks run beside the PLC: threads and numpy, failures, a block that never yields, no network', async () => {
  test.setTimeout(180000)
  const { userData, project } = writeProject('openplc-e2e-python-blocks')
  const { app, page } = await launch(userData)
  const names = ['COUNTER', 'PY_COUNT', 'PY_BEATS', 'PY_MEAN', 'FAIL_COUNT', 'SPIN_ENTERED', 'NET_CONNECTED']
  try {
    await page.getByText(PROJECT_NAME, { exact: true }).first().click({ timeout: 30000 })
    const play = page.getByRole('button', { name: 'Play' })
    await play.click({ timeout: 60000 })
    await waitForApp(page, () => simulatorRunning(page), { timeout: 90000, message: 'the simulator never started' })
    const leaves = readLeaves(project)
    const read = () => readVariables(page, leaves, names)

    // TC06: the block's outputs follow its 100 ms loop, its thread runs, numpy computes the mean.
    await expect.poll(async () => (await read())?.PY_COUNT ?? 0, { timeout: 30000 }).toBeGreaterThan(5)
    const first = await read()
    await page.waitForTimeout(2000)
    const later = await read()
    if (!first || !later) throw new Error('the debugger did not answer')
    const loopsPerSecond = (later.PY_COUNT - first.PY_COUNT) / 2
    expect(loopsPerSecond).toBeGreaterThan(6)
    expect(loopsPerSecond).toBeLessThan(11)
    expect(later.PY_BEATS).toBeGreaterThan(first.PY_BEATS)
    expect(later.PY_MEAN).toBeGreaterThan(0)
    // Play opens the debugger tab in the bottom panel; the block output is on the Console tab.
    await page.getByRole('tab', { name: 'Console' }).click()
    await waitForText(page, /\[PyStats\] PyStats started, numpy 2\.3\.2/, { timeout: 30000 })

    // TC07: the failing block's traceback reaches the Console and its output stays at its last value.
    await waitForText(page, /\[PyFail\] RuntimeError: planned failure after 30 loops/, { timeout: 30000 })
    const afterFailure = await read()
    await page.waitForTimeout(1000)
    const stillFailed = await read()
    if (!afterFailure || !stillFailed) throw new Error('the debugger did not answer')
    expect(stillFailed.FAIL_COUNT).toBe(afterFailure.FAIL_COUNT)
    expect(stillFailed.FAIL_COUNT).toBeLessThan(30)
    expect(stillFailed.COUNTER).toBeGreaterThan(afterFailure.COUNTER)

    // TC08: the block stuck in its loop never published, and the PLC keeps scanning.
    expect(stillFailed.SPIN_ENTERED).toBe(0)

    // TC09: no network for Python: the connection fails with a traceback and the output stays 0.
    await waitForText(page, /\[PySocket\] socket\.gaierror/, { timeout: 30000 })
    expect(stillFailed.NET_CONNECTED).toBe(0)

    // Stop ends the PLC and every block, the one that never yields included.
    await play.click()
    await expect.poll(() => simulatorRunning(page), { timeout: 30000 }).toBe(false)
    const lines = await page.locator('text=/\\[PyStats\\] count=/').count()
    await page.waitForTimeout(3000)
    expect(await page.locator('text=/\\[PyStats\\] count=/').count()).toBe(lines)
  } finally {
    await quitApp(app, page)
  }
})
