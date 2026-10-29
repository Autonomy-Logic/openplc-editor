/**
 * DOPE-655 - a tab is marked unsaved only by a real edit.
 *
 * Several editors committed on blur or pushed interaction state through the same
 * store actions as edits, so opening a project and clicking around put the unsaved
 * asterisk on tabs nobody had changed: the POU description field, the ladder rung
 * comment, the FBD variable and connection boxes, selecting an FBD node or wire,
 * React Flow's mount-time re-measure, a VPP screen seeding its field defaults, and
 * the struct, enum and array data type cells.
 *
 * The suite authors content through the UI and saves it, relaunches, then opens
 * every element, focuses and blurs every field, opens every select, selects every
 * FBD and ladder node, and asserts no tab picked up the asterisk. The project
 * covers every POU language, the three data type kinds, a server and a remote
 * device. It also checks that real edits still mark the tab (ladder, FBD, POU
 * description, an array dimension edited without selecting its row, the VPP
 * screen) and that "Don't Save" on close leaves the file alone.
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
  mkdirSync(join(fixture, 'pous', 'function-blocks'), { recursive: true })
  mkdirSync(join(fixture, 'devices', 'remote'), { recursive: true })
  writeFileSync(
    join(fixture, 'project.json'),
    JSON.stringify({
      meta: { name: 'dirty-flag', type: 'plc-project' },
      data: {
        dataTypes: [
          {
            name: 'TANK',
            derivation: 'structure',
            variable: [{ name: 'LEVEL', type: { definition: 'base-type', value: 'INT' } }],
          },
          { name: 'MODE', derivation: 'enumerated', values: [{ description: 'AUTO' }, { description: 'MANUAL' }] },
          {
            name: 'LEVELS',
            derivation: 'array',
            baseType: { definition: 'base-type', value: 'INT' },
            dimensions: [{ dimension: '1..8' }],
          },
        ],
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
    join(fixture, 'pous', 'programs', 'ilmain.il'),
    'PROGRAM ilmain\n  VAR\n    c : INT;\n  END_VAR\n\nLD c\nADD 1\nST c\n\nEND_PROGRAM\n',
  )
  writeFileSync(
    join(fixture, 'pous', 'function-blocks', 'pyfb.py'),
    'FUNCTION_BLOCK pyfb\n  VAR_INPUT\n    x : INT;\n  END_VAR\n\ndef block_init():\n    pass\n\ndef block_loop():\n    pass\nEND_FUNCTION_BLOCK\n',
  )
  writeFileSync(
    join(fixture, 'pous', 'function-blocks', 'cppfb.cpp'),
    'FUNCTION_BLOCK cppfb\n  VAR_INPUT\n    x : INT;\n  END_VAR\n\nvoid setup() {}\n\nvoid loop() {}\nEND_FUNCTION_BLOCK\n',
  )
  writeFileSync(
    join(fixture, 'devices', 'remote', 'REMOTE.json'),
    JSON.stringify({
      name: 'REMOTE',
      protocol: 'modbus-tcp',
      modbusTcpConfig: { transport: 'tcp', host: '192.168.1.60', port: 502, slaveId: 1, timeout: 1000, ioGroups: [] },
    }),
  )
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

// Exact and case-sensitive: `hasText` alone would let "Modbus" match the "MODBUS" server tab.
const tab = (page: Page, name: string) =>
  page
    .locator('[role="tab"]')
    .filter({ has: page.getByText(new RegExp(`^(\\* )?${name}$`)) })
    .first()

/** innerText, not textContent: some tab icons carry an SVG <title> ("Array Icon") in their text. */
const expectTabLabel = (page: Page, name: string, unsaved: boolean) =>
  expect
    .poll(() => tab(page, name).innerText(), { timeout: 10000 })
    .toMatch(new RegExp(`^${unsaved ? '\\* ' : ''}${name}`))

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
  await expectTabLabel(page, 'ldmain', true)
  await expectTabLabel(page, 'fbdmain', true)

  await save(app)
  await expectTabLabel(page, 'fbdmain', false)
  await app.close()
}

/** Focus and blur every field and open every select on the current screen, changing nothing. */
async function touchEveryField(page: Page): Promise<void> {
  const fields = page.locator('input:visible, textarea:visible')
  const fieldCount = Math.min(await fields.count(), 25)
  for (let i = 0; i < fieldCount; i++) {
    const field = fields.nth(i)
    await field.focus().catch(() => undefined)
    await page.waitForTimeout(150)
    // Blur programmatically: a Tab keypress inside Monaco inserts indentation, which is a real edit.
    await field.evaluate((element) => (element as HTMLElement).blur()).catch(() => undefined)
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

async function sweep(board: string, slug: string, expectVpp = false): Promise<void> {
  const paths = pathsFor(slug)
  writeFixture(paths, board)
  await authorContent(paths)

  const { app, page } = await launch(paths)
  try {
    await page.getByText('dirty-flag', { exact: true }).first().click({ timeout: 30000 })
    await page.waitForTimeout(5000)
    await expectNoUnsavedTab(page, 'opening the project')

    const elements = ['ldmain', 'fbdmain', 'stmain', 'ilmain', 'pyfb', 'cppfb', 'TANK', 'MODE', 'LEVELS']
    for (const name of [...elements, 'Global Variables', 'Resource', 'Configuration', 'MODBUS', 'REMOTE']) {
      const item = page.getByText(name, { exact: true }).first()
      await item.scrollIntoViewIfNeeded({ timeout: 15000 })
      await item.click({ timeout: 15000 })
      await page.waitForTimeout(3000)
      await expectNoUnsavedTab(page, `opening ${name}`)
    }

    for (const name of [
      'ldmain',
      'fbdmain',
      'stmain',
      'pyfb',
      'TANK',
      'MODE',
      'LEVELS',
      'Resource',
      'Configuration',
      'MODBUS',
      'REMOTE',
    ]) {
      await tab(page, name).click({ timeout: 5000 })
      await page.waitForTimeout(1000)
      await touchEveryField(page)
      await expectNoUnsavedTab(page, `focusing and blurring every field on ${name}`)
    }

    // The VPP Modbus screen only exists on a vendor-package board.
    if (expectVpp) {
      const vppModbus = page.getByText('Modbus', { exact: true }).first()
      await vppModbus.scrollIntoViewIfNeeded({ timeout: 15000 })
      await vppModbus.click()
      await page.waitForTimeout(2000)
      await touchEveryField(page)
      await expectNoUnsavedTab(page, 'opening the board Modbus screen and touching its fields')
    }

    await tab(page, 'ldmain').click({ timeout: 5000 })
    await page.waitForTimeout(1000)
    const ladderNodes = page.locator('.react-flow__node:visible')
    const ladderNodeCount = await ladderNodes.count()
    for (let i = 0; i < ladderNodeCount; i++) {
      await ladderNodes
        .nth(i)
        .click({ position: { x: 2, y: 2 }, timeout: 3000 })
        .catch(() => undefined)
      await page.waitForTimeout(300)
    }
    await page.keyboard.press('Escape')
    await page.waitForTimeout(1500)
    await expectNoUnsavedTab(page, 'selecting every ladder node')

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

    // Editing an array dimension without clicking its row first used to rebuild
    // the rows from a stale, empty snapshot. It must mark the tab and keep the row.
    await tab(page, 'LEVELS').click({ timeout: 5000 })
    const dimension = page.locator('#dimension-input-0:visible')
    await dimension.fill('1..9')
    await dimension.evaluate((element) => (element as HTMLElement).blur())
    await expectTabLabel(page, 'LEVELS', true)
    await expect(dimension).toHaveValue('1..9')

    // A real edit to the POU description still marks the tab.
    await tab(page, 'stmain').click({ timeout: 5000 })
    const description = page.locator('input#description:visible').first()
    await description.click()
    await page.keyboard.type('edited')
    await page.keyboard.press('Tab')
    await expectTabLabel(page, 'stmain', true)

    if (expectVpp) {
      // A real change on the board Modbus screen still marks it. (Switching it back does
      // not clear the mark: turning a section on seeds the fields it reveals, so the
      // stored data did change.) ToggleSwitch is an sr-only checkbox inside a <label>.
      await page.getByText('Modbus', { exact: true }).first().click()
      await page.waitForTimeout(1500)
      await page.locator('label:has(> input[type="checkbox"]):visible').first().click()
      await expectTabLabel(page, 'Modbus', true)
    }
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
  await sweep('Arduino Nano ESP32', 'nano-esp32', true)
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
    await expectTabLabel(page, 'stmain', true)

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
