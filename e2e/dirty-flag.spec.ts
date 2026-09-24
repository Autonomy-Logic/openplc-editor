/**
 * DOPE-655 - a tab is marked unsaved only by a real edit.
 *
 * Several editors committed on blur or pushed interaction state through the same
 * store actions as edits, so opening a project and clicking around put the unsaved
 * asterisk on tabs nobody had changed: the POU description field, the ladder rung
 * comment, the FBD variable and connection boxes, selecting an FBD node, React
 * Flow's mount-time re-measure, and a VPP screen seeding its field defaults.
 *
 * The suite authors content through the UI and saves it, relaunches, then opens
 * every element, focuses and blurs every field, opens every select, selects every
 * FBD node, and asserts no tab picked up the asterisk. It also checks that a real
 * edit still marks the tab and that "Don't Save" on close leaves the file alone.
 *
 * The VPP case needs a board from a vendor package. The ESP32 run copies the
 * packages installed in the local editor profile (~/.config/open-plc-editor) and
 * is skipped when there are none.
 *
 * Running this suite needs a production build plus the preload at the path a
 * NON-packaged app looks for it; see "Electron e2e" in CLAUDE.md. No CI workflow
 * runs Playwright today, so this is a local check.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron, expect, test } from '@playwright/test'

const ROOT = join(tmpdir(), 'openplc-e2e-dirty-flag')
const LOCAL_PACKAGES = join(homedir(), '.config', 'open-plc-editor', 'packages')

const vars = `  VAR
    a : BOOL;
    b : BOOL;
    t0 : TON;
  END_VAR
`

type Paths = { fixture: string; userData: string }

function pathsFor(slug: string): Paths {
  return { fixture: join(ROOT, slug, 'project'), userData: join(ROOT, slug, 'userdata') }
}

/** Write the on-disk project and a profile that lists it, at their initial state. */
function writeFixture({ fixture, userData }: Paths, board: string): void {
  rmSync(join(fixture, '..'), { recursive: true, force: true })
  mkdirSync(join(fixture, 'devices', 'servers'), { recursive: true })
  mkdirSync(join(fixture, 'pous', 'programs'), { recursive: true })
  writeFileSync(
    join(fixture, 'project.json'),
    JSON.stringify({
      meta: { name: 'dirty-flag', type: 'plc-project' },
      data: {
        dataTypes: [],
        pous: [],
        configuration: {
          resource: {
            tasks: [{ name: 'task0', triggering: 'Cyclic', interval: 'T#20ms', priority: 1 }],
            instances: [{ name: 'instance0', program: 'stmain', task: 'task0' }],
            globalVariables: [],
          },
        },
        libraries: [],
        debugVariables: { global: [], pous: {} },
      },
    }),
  )
  writeFileSync(
    join(fixture, 'devices', 'configuration.json'),
    JSON.stringify({
      deviceBoard: board,
      communicationPort: '',
      runtimeIpAddress: '192.168.1.50',
      selectedPlatformOptions: {},
    }),
  )
  writeFileSync(join(fixture, 'devices', 'pin-mapping.json'), '{}')
  writeFileSync(
    join(fixture, 'devices', 'servers', 'MODBUS.json'),
    JSON.stringify({
      name: 'MODBUS',
      protocol: 'modbus-tcp',
      modbusSlaveConfig: { enabled: true, networkInterface: '0.0.0.0', port: 502 },
    }),
  )
  writeFileSync(join(fixture, 'pous', 'programs', 'stmain.st'), `PROGRAM stmain\n${vars}\na := b;\n\nEND_PROGRAM\n`)
  writeFileSync(
    join(fixture, 'pous', 'programs', 'ldmain.ld'),
    `PROGRAM ldmain\n${vars}\n${JSON.stringify({ name: 'ldmain', rungs: [] })}\nEND_PROGRAM\n`,
  )
  writeFileSync(
    join(fixture, 'pous', 'programs', 'fbdmain.fbd'),
    `PROGRAM fbdmain\n${vars}\n${JSON.stringify({
      name: 'fbdmain',
      rung: { comment: '', nodes: [], edges: [], selectedNodes: [] },
    })}\nEND_PROGRAM\n`,
  )

  const history = join(userData, 'User', 'History')
  mkdirSync(history, { recursive: true })
  writeFileSync(
    join(history, 'projects.json'),
    JSON.stringify([
      {
        name: 'dirty-flag',
        path: fixture,
        projectFilePath: join(fixture, 'project.json'),
        createdAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
      },
    ]),
  )
  writeFileSync(join(history, 'libraries.json'), '[]')

  // A fresh profile has no Arduino control files, and without them the board list never loads.
  const runtime = join(userData, 'User', 'Runtime')
  mkdirSync(runtime, { recursive: true })
  writeFileSync(join(runtime, 'arduino-core-control.json'), '[]')
  writeFileSync(join(runtime, 'arduino-library-control.json'), '[]')

  if (existsSync(LOCAL_PACKAGES)) {
    const dest = join(userData, 'packages')
    cpSync(LOCAL_PACKAGES, dest, { recursive: true })
    const registry = join(dest, 'registry.json')
    writeFileSync(registry, readFileSync(registry, 'utf-8').split(LOCAL_PACKAGES).join(dest))
  }
}

async function launch({ userData }: Paths): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [join(__dirname, '..', 'release', 'app', 'dist', 'main', 'main.js'), `--user-data-dir=${userData}`],
    // NOT development: `resolveHtmlPath` would point the window at the webpack dev
    // server on localhost:1212, which is not running against a production build.
    env: { ...process.env, NODE_ENV: 'production' },
  })
  // The app opens a splash window first; pick the real one by URL.
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      try {
        if (w.url().includes('index.html')) {
          await w.waitForLoadState('domcontentloaded')
          return { app, page: w }
        }
      } catch {
        /* window is closing; skip it */
      }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('main window never appeared')
}

/** Ctrl+S is a native menu accelerator, which Playwright's keyboard never reaches. */
const save = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'))
    win?.webContents.send('project:save-accelerator')
  })

const tabLabels = async (page: Page) =>
  (await page.locator('[role="tab"]').allInnerTexts()).map((label) => label.trim())

const tab = (page: Page, name: string) => page.locator('[role="tab"]', { hasText: name }).first()

async function expectNoUnsavedTab(page: Page, step: string): Promise<void> {
  const unsaved = (await tabLabels(page)).filter((label) => label.startsWith('*'))
  expect.soft(unsaved, `no tab should be marked unsaved after: ${step}`).toEqual([])
}

/** Give the ladder and the FBD real content through the UI, check it marks them, and save. */
async function authorContent(paths: Paths): Promise<void> {
  const { app, page } = await launch(paths)
  await page.getByText('dirty-flag', { exact: true }).first().click({ timeout: 30000 })

  await page.getByText('ldmain', { exact: true }).first().click({ timeout: 30000 })
  await page.getByText('Create new rung').locator('..').locator('button, svg').last().click({ timeout: 30000 })
  const drags = page.locator('[draggable="true"]')
  const pane = page.locator('.react-flow__pane:visible').first()
  // The ladder toolbox order is Block, Coil, Contact.
  for (const index of [2, 1, 0]) {
    await drags.nth(index).dragTo(pane, { targetPosition: { x: 150, y: 50 } })
    await page.waitForTimeout(1500)
  }
  for (const name of ['a', 'b']) {
    await page.getByPlaceholder('???').first().click()
    await page.keyboard.type(name)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(1000)
  }
  await page.keyboard.press('Escape')

  await page.getByText('fbdmain', { exact: true }).first().click({ timeout: 30000 })
  await page.waitForTimeout(1500)
  const fbdDrags = page.locator('[draggable="true"]:visible')
  const fbdPane = page.locator('.react-flow__pane:visible').first()
  for (let i = 0; i < 4; i++) {
    await fbdDrags.nth(i).dragTo(fbdPane, { targetPosition: { x: 150 + i * 180, y: 150 } })
    await page.waitForTimeout(1200)
    await page.keyboard.press('Escape')
  }

  // A real edit must still mark the tab.
  await expect(tab(page, 'ldmain')).toHaveText(/^\* ldmain/)
  await expect(tab(page, 'fbdmain')).toHaveText(/^\* fbdmain/)

  await save(app)
  await expect(tab(page, 'fbdmain')).toHaveText(/^fbdmain/, { timeout: 10000 })
  await app.close()
}

/** Focus and blur every field and open every select on the current screen, changing nothing. */
async function touchEveryField(page: Page): Promise<void> {
  const fields = page.locator('input:visible, textarea:visible')
  const fieldCount = Math.min(await fields.count(), 25)
  for (let i = 0; i < fieldCount; i++) {
    await fields
      .nth(i)
      .focus()
      .catch(() => undefined)
    await page.waitForTimeout(150)
    await page.keyboard.press('Tab')
    await page.waitForTimeout(150)
  }
  const selects = page.locator('button[role="combobox"]:visible')
  const selectCount = Math.min(await selects.count(), 10)
  for (let i = 0; i < selectCount; i++) {
    await selects
      .nth(i)
      .click({ timeout: 2000 })
      .catch(() => undefined)
    await page.waitForTimeout(300)
    await page.keyboard.press('Escape')
  }
  await page.waitForTimeout(1500)
}

async function sweep(board: string, slug: string): Promise<void> {
  const paths = pathsFor(slug)
  writeFixture(paths, board)
  await authorContent(paths)

  const { app, page } = await launch(paths)
  try {
    await page.getByText('dirty-flag', { exact: true }).first().click({ timeout: 30000 })
    await page.waitForTimeout(5000)
    await expectNoUnsavedTab(page, 'opening the project')

    for (const name of ['ldmain', 'fbdmain', 'stmain', 'Resource', 'Configuration', 'MODBUS']) {
      await page.getByText(name, { exact: true }).first().click({ timeout: 15000 })
      await page.waitForTimeout(3000)
      await expectNoUnsavedTab(page, `opening ${name}`)
    }

    for (const name of ['ldmain', 'fbdmain', 'Resource', 'Configuration', 'MODBUS']) {
      await tab(page, name).click({ timeout: 5000 })
      await page.waitForTimeout(1000)
      await touchEveryField(page)
      await expectNoUnsavedTab(page, `focusing and blurring every field on ${name}`)
    }

    // The VPP Modbus screen only exists on a vendor-package board.
    const vppModbus = page.getByText('Modbus', { exact: true }).first()
    if (await vppModbus.isVisible()) {
      await vppModbus.click()
      await page.waitForTimeout(2000)
      await touchEveryField(page)
      await expectNoUnsavedTab(page, 'opening the board Modbus screen and touching its fields')
    }

    await tab(page, 'fbdmain').click({ timeout: 5000 })
    await page.waitForTimeout(1000)
    const nodes = page.locator('.react-flow__node:visible')
    const nodeCount = await nodes.count()
    expect(nodeCount, 'the FBD should have reopened with its nodes').toBeGreaterThan(0)
    for (let i = 0; i < nodeCount; i++) {
      await nodes.nth(i).click({ position: { x: 3, y: 3 }, timeout: 3000 })
      await page.waitForTimeout(500)
    }
    await page
      .locator('.react-flow__pane:visible')
      .first()
      .click({ position: { x: 5, y: 5 } })
    await page.waitForTimeout(1500)
    await expectNoUnsavedTab(page, 'selecting every FBD node')
  } finally {
    await app.close()
  }
}

test('Runtime v4: opening and clicking around marks no tab unsaved', async () => {
  test.setTimeout(300000)
  await sweep('OpenPLC Runtime v4', 'runtime-v4')
})

test('Nano ESP32 (VPP): opening and clicking around marks no tab unsaved', async () => {
  test.skip(
    !existsSync(join(LOCAL_PACKAGES, 'com.openplc.arduino')),
    'needs the Arduino vendor package installed locally',
  )
  test.setTimeout(300000)
  await sweep('Arduino Nano ESP32', 'nano-esp32')
})

test("Don't Save on close leaves the file on disk untouched", async () => {
  test.setTimeout(120000)
  const paths = pathsFor('discard')
  writeFixture(paths, 'OpenPLC Runtime v4')
  const stFile = join(paths.fixture, 'pous', 'programs', 'stmain.st')
  const before = readFileSync(stFile, 'utf-8')

  const { app, page } = await launch(paths)
  try {
    await page.getByText('dirty-flag', { exact: true }).first().click({ timeout: 30000 })
    await page.getByText('stmain', { exact: true }).first().click({ timeout: 30000 })
    await page.locator('.view-lines:visible').first().click()
    await page.keyboard.type('(* discard me *)')
    await expect(tab(page, 'stmain')).toHaveText(/^\* stmain/)

    await tab(page, 'stmain').hover()
    await tab(page, 'stmain').locator('svg').last().click()
    await page.getByRole('button', { name: "Don't Save" }).click({ timeout: 10000 })
    await expect(tab(page, 'stmain')).toHaveCount(0)
    await page.waitForTimeout(2000)

    expect(readFileSync(stFile, 'utf-8'), "Don't Save must not write the file").toBe(before)
  } finally {
    await app.close()
  }
})
