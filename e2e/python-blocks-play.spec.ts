/**
 * Python function blocks on the OpenPLC Simulator (desktop): Play runs each block in its own interpreter next to the
 * PLC. A block with a thread and numpy updates its outputs; one that raises shows its traceback and keeps its last
 * outputs; one that never yields does not hold the PLC; one that opens a socket fails with a traceback; Stop ends
 * them all, so a second Play starts the blocks over. Play opens the Debugger tab, so the spec opens the Console tab to
 * read block output. Play on a project with Python blocks runs one Python thread, and no clang worker is left once it
 * runs; that the editor starts with no Python thread is the cold-start case of `wasm-toolchain.spec.ts`.
 *
 * The test opens a new project in the worker's editor. Running needs a production build; see "Electron e2e" in
 * CLAUDE.md.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, type Page } from '@playwright/test'

import { pageText, waitForApp, waitForText } from './helpers/app-console'
import { openNewProject, test } from './helpers/editor-session'
import { countOf, trackWorkerThreads, workerThreads } from './helpers/worker-threads'

const FIXTURE = join(__dirname, 'fixtures', 'python-blocks')

interface Leaf {
  elemIdx: number
  path: string
  type: string
  size: number
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

/** The Console text after the last "Simulator stopped." line, or `''` while there is none. */
async function afterLastStop(page: Page): Promise<string> {
  const text = await pageText(page)
  const at = text.lastIndexOf('Simulator stopped.')
  return at < 0 ? '' : text.slice(at)
}

test('Python blocks run beside the PLC: threads and numpy, failures, a block that never yields, no network', async ({
  editor,
}) => {
  test.setTimeout(180000)
  const { app, page } = editor
  const { path: project } = await openNewProject(editor, FIXTURE, 'python-blocks')
  const names = ['COUNTER', 'PY_COUNT', 'PY_BEATS', 'PY_MEAN', 'FAIL_COUNT', 'SPIN_ENTERED', 'NET_CONNECTED']
  await trackWorkerThreads(app)

  const play = page.getByRole('button', { name: 'Play' })
  const openConsole = () => page.getByRole('tab', { name: 'Console' }).click()
  await play.click({ timeout: 60000 })
  await openConsole()
  await waitForApp(page, () => simulatorRunning(page), { timeout: 90000, message: 'the simulator never started' })
  await openConsole()
  const whileRunning = await workerThreads(app)
  expect(countOf(whileRunning.live, 'python-worker.js')).toBe(1)
  expect(countOf(whileRunning.live, 'clang-worker.js')).toBe(0)
  const leaves = readLeaves(project)
  const read = () => readVariables(page, leaves, names)
  const loopsAfter = async (from: number, loops: number): Promise<Record<string, number>> => {
    const sample = { values: (await read()) ?? {} }
    await waitForApp(
      page,
      async () => {
        sample.values = (await read()) ?? sample.values
        return (sample.values.PY_COUNT ?? 0) - from >= loops
      },
      { timeout: 30000, intervals: [50], message: `PY_COUNT never advanced ${loops} loops past ${from}` },
    )
    return sample.values
  }

  await waitForApp(page, async () => ((await read())?.PY_COUNT ?? 0) > 5, {
    timeout: 30000,
    message: 'the Python block never counted past 5',
  })
  const first = await read()
  if (!first) throw new Error('the debugger did not answer')
  const since = Date.now()
  const later = await loopsAfter(first.PY_COUNT, 16)
  const loopsPerSecond = (later.PY_COUNT - first.PY_COUNT) / ((Date.now() - since) / 1000)
  expect(loopsPerSecond).toBeGreaterThan(6)
  expect(loopsPerSecond).toBeLessThan(11)
  expect(later.PY_BEATS).toBeGreaterThan(first.PY_BEATS)
  expect(later.PY_MEAN).toBeGreaterThan(0)
  await waitForText(page, /\[PyStats\] PyStats started, numpy 2\.3\.2/, { timeout: 30000 })

  await waitForText(page, /\[PyFail\] RuntimeError: planned failure after 30 loops/, { timeout: 30000 })
  const afterFailure = await read()
  if (!afterFailure) throw new Error('the debugger did not answer')
  const stillFailed = await loopsAfter(afterFailure.PY_COUNT, 8)
  expect(stillFailed.FAIL_COUNT).toBe(afterFailure.FAIL_COUNT)
  expect(stillFailed.FAIL_COUNT).toBeLessThan(30)
  expect(stillFailed.COUNTER).toBeGreaterThan(afterFailure.COUNTER)

  expect(stillFailed.SPIN_ENTERED).toBe(0)

  await waitForText(page, /\[PySocket\] socket\.gaierror/, { timeout: 30000 })
  const output = await pageText(page)
  expect(output).toMatch(/\[PySocket\] raw IP connect failed: \w+/)
  expect(output).toMatch(/\[PySocket\] host file hidden: \w+/)
  expect(output).not.toMatch(/raw IP connect succeeded|host file read/)
  expect(stillFailed.NET_CONNECTED).toBe(0)

  await play.click()
  await waitForApp(page, async () => !(await simulatorRunning(page)), {
    timeout: 30000,
    message: 'Stop never stopped the simulator',
  })
  await waitForApp(page, async () => (await afterLastStop(page)) !== '', { message: 'Stop was never reported' })

  await play.click()
  await openConsole()
  await waitForApp(page, () => simulatorRunning(page), { timeout: 90000, message: 'the second Play never started' })
  await openConsole()
  await waitForApp(page, async () => /\[PyStats\] count=\d+/.test(await afterLastStop(page)), {
    timeout: 30000,
    message: 'the second run printed no PyStats count',
  })
  expect((await afterLastStop(page)).match(/\[PyStats\] count=(\d+)/)?.[1]).toBe('20')
  expect(countOf((await workerThreads(app)).live, 'python-worker.js')).toBe(1)

  await play.click()
  await waitForApp(page, async () => !(await simulatorRunning(page)), {
    timeout: 30000,
    message: 'the second Stop never stopped the simulator',
  })
})
