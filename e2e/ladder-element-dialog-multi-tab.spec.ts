/**
 * Element dialogs with more than one ladder POU open.
 *
 * Every open ladder tab keeps its editor mounted. With two of them, each POU's element dialogs must still
 * render once and apply their change: the contact dialog saves a new modifier, and the block dialog saves
 * execution control switched on.
 *
 * Needs a production build plus the preload copy; see "Electron e2e" in CLAUDE.md.
 */
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron, expect, test } from '@playwright/test'
import { z } from 'zod'

const nodeSchema = z.object({
  type: z.string(),
  data: z.object({
    variant: z.unknown(),
    executionControl: z.boolean().optional(),
    variable: z.object({ name: z.string() }).partial().optional(),
  }),
})
const ladderFlowSchema = z.object({
  name: z.string(),
  rungs: z.array(z.object({ nodes: z.array(nodeSchema) }).passthrough()),
})

const ROOT = join(realpathSync(tmpdir()), 'openplc-e2e-ladder-element-dialog')
const FIXTURE = join(ROOT, 'project')
const USER_DATA = join(ROOT, 'userdata')
const PROJECT_NAME = 'ladder-dialogs'
const POUS = ['lda', 'ldb'] as const

const VARS = `  VAR
    Motor : BOOL;
    Lamp : BOOL;
    oscillator : BOOL;
    full_up : BOOL;
    full_down : BOOL;
    ramp_cnt : INT;
    CTUD0 : CTUD;
  END_VAR
`

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g

const BLOCK_RUNG = join(
  __dirname,
  '..',
  'src/frontend/utils/PLC/xml-generator/old-editor/language/__tests__/fixtures/ctud-parallel-output-rung.json',
)

/** A contact rung and a CTUD block rung, with every id made unique to `pou`. */
function ladderBody(pou: string): string {
  const contactFlow: unknown = JSON.parse(
    readFileSync(join(__dirname, 'fixtures', 'project-search', 'motor_ladder.ld'), 'utf-8')
      .replaceAll('motor_ladder', pou)
      .replace(UUID, (id) => `${id}-${pou}`),
  )
  const blockRung: unknown = JSON.parse(readFileSync(BLOCK_RUNG, 'utf-8').replace(UUID, (id) => `${id}-${pou}`))
  const flow = z
    .object({ rungs: z.array(z.unknown()) })
    .passthrough()
    .parse(contactFlow)
  return JSON.stringify({ ...flow, rungs: [...flow.rungs, blockRung] })
}

function writeFixture(): void {
  rmSync(ROOT, { recursive: true, force: true })
  mkdirSync(join(FIXTURE, 'pous', 'programs'), { recursive: true })
  mkdirSync(join(FIXTURE, 'devices'), { recursive: true })
  writeFileSync(
    join(FIXTURE, 'project.json'),
    JSON.stringify({
      meta: { name: PROJECT_NAME, type: 'plc-project' },
      data: {
        dataTypes: [],
        pous: [],
        configuration: {
          resource: {
            tasks: [{ name: 'task0', triggering: 'Cyclic', interval: 'T#20ms', priority: 1 }],
            instances: POUS.map((pou, i) => ({ name: `instance${i}`, program: pou, task: 'task0' })),
            globalVariables: [],
          },
        },
        libraries: [],
        debugVariables: { global: [], pous: {} },
      },
    }),
  )
  writeFileSync(
    join(FIXTURE, 'devices', 'configuration.json'),
    JSON.stringify({
      deviceBoard: 'OpenPLC Runtime v3',
      communicationPort: '',
      runtimeIpAddress: '',
      selectedPlatformOptions: {},
    }),
  )
  writeFileSync(join(FIXTURE, 'devices', 'pin-mapping.json'), '{}')
  for (const pou of POUS) {
    writeFileSync(
      join(FIXTURE, 'pous', 'programs', `${pou}.ld`),
      `PROGRAM ${pou}\n${VARS}\n${ladderBody(pou)}\nEND_PROGRAM\n`,
    )
  }

  const history = join(USER_DATA, 'User', 'History')
  mkdirSync(history, { recursive: true })
  writeFileSync(
    join(history, 'projects.json'),
    JSON.stringify([
      {
        name: PROJECT_NAME,
        path: FIXTURE,
        projectFilePath: join(FIXTURE, 'project.json'),
        createdAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
      },
    ]),
  )
  writeFileSync(join(history, 'libraries.json'), '[]')
  const runtime = join(USER_DATA, 'User', 'Runtime')
  mkdirSync(runtime, { recursive: true })
  writeFileSync(join(runtime, 'arduino-core-control.json'), '[]')
  writeFileSync(join(runtime, 'arduino-library-control.json'), '[]')
}

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [join(__dirname, '..', 'release', 'app', 'dist', 'main', 'main.js'), `--user-data-dir=${USER_DATA}`],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      try {
        if (w.url().includes('index.html')) {
          await w.waitForLoadState('domcontentloaded')
          await app.evaluate(({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().includes('index.html'))
            win?.setSize(1500, 950)
          })
          return { app, page: w }
        }
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  await shutdown(app)
  throw new Error('main window never appeared')
}

/** Ctrl+S is a native menu accelerator, which Playwright's keyboard never reaches. */
const save = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'))
    win?.webContents.send('project:save-accelerator')
  })

/** The quit confirmation holds every quit, so `app.close()` would hang. */
async function shutdown(app: ElectronApplication): Promise<void> {
  const proc = app.process()
  if (proc.exitCode !== null) return
  const exited = new Promise((resolve) => proc.once('exit', resolve))
  proc.kill('SIGKILL')
  await exited
}

/** The saved nodes of `pou`, or undefined while a save is still writing the file. */
function savedNodes(pou: string): z.infer<typeof nodeSchema>[] | undefined {
  try {
    const text = readFileSync(join(FIXTURE, 'pous', 'programs', `${pou}.ld`), 'utf-8')
    const json = text.slice(text.indexOf('END_VAR') + 'END_VAR'.length, text.lastIndexOf('END_PROGRAM'))
    return ladderFlowSchema.parse(JSON.parse(json)).rungs.flatMap((rung) => rung.nodes)
  } catch {
    return undefined
  }
}

/** Saves until `read` sees the expected value on disk. */
const expectSaved = (read: () => unknown, expected: unknown) =>
  expect
    .poll(
      async () => {
        await save(app)
        return read()
      },
      { timeout: 30000, intervals: [1000] },
    )
    .toBe(expected)

/** Clicks the centre of the topmost match, the way a user's click lands. */
async function clickTop(page: Page, locator: ReturnType<Page['locator']>): Promise<void> {
  const box = await locator.last().boundingBox()
  if (!box) throw new Error('nothing to click')
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}

let app: ElectronApplication
let page: Page
const pageErrors: string[] = []

/** Waits for `locator`, failing at once if the renderer throws instead. */
async function waitOrCrash(locator: ReturnType<Page['locator']>, timeout = 30000): Promise<void> {
  const crashed = new Promise<never>((_, reject) => page.once('pageerror', (e) => reject(e)))
  await Promise.race([locator.waitFor({ timeout }), crashed])
}

test.describe.configure({ mode: 'default', timeout: 120000 })

test.beforeAll(async () => {
  test.setTimeout(180000)
  writeFixture()
  ;({ app, page } = await launch())
  page.on('pageerror', (e) => pageErrors.push(e.message))
  await page.getByText(PROJECT_NAME, { exact: true }).first().click({ timeout: 60000 })
  for (const pou of POUS) {
    await waitOrCrash(page.getByText(pou, { exact: true }).first())
    await page.getByText(pou, { exact: true }).first().click()
    await waitOrCrash(page.locator('.react-flow__node-block:visible'))
  }
})

test.afterEach(() => {
  expect(pageErrors, 'the renderer threw').toEqual([])
})

test.afterAll(async () => {
  if (app) await shutdown(app)
})

for (const pou of POUS) {
  test(`with two ladder tabs open, the contact dialog of ${pou} applies a new modifier`, async () => {
    await page.getByText(pou, { exact: true }).first().click()
    const contact = page.locator('.react-flow__node-contact:visible').filter({ hasText: 'Motor' })
    await expect(contact).toHaveCount(1)
    const box = await contact.boundingBox()
    if (!box) throw new Error('contact has no box')
    await contact.dblclick({ position: { x: box.width / 2, y: box.height - 4 } })

    const title = page.getByText('Edit Contact Values', { exact: true })
    await expect(title.first()).toBeVisible()
    await clickTop(page, page.getByText('negated', { exact: true }))
    await clickTop(page, page.locator('button', { hasText: /^Confirm$/ }))
    await expect(title, 'Confirm applies the change and closes the dialog').toHaveCount(0)

    await expectSaved(
      () => savedNodes(pou)?.find((n) => n.type === 'contact' && n.data.variable?.name === 'Motor')?.data.variant,
      'negated',
    )
  })

  test(`with two ladder tabs open, the block dialog of ${pou} switches execution control on`, async () => {
    await page.getByText(pou, { exact: true }).first().click()
    const block = page.locator('.react-flow__node-block:visible')
    await expect(block).toHaveCount(1)
    await block.dblclick()

    const title = page.getByText('Block Properties', { exact: true })
    await expect(title.first()).toBeVisible()
    await clickTop(page, page.locator('[id="executionControlSwitch"]'))
    await clickTop(page, page.locator('button', { hasText: /^Ok$/ }))
    await expect(title, 'Ok applies the change and closes the dialog').toHaveCount(0)

    await expectSaved(() => savedNodes(pou)?.find((n) => n.type === 'block')?.data.executionControl, true)
  })
}
