import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { _electron as electron, expect, test } from '@playwright/test'

const ROOT = join(realpathSync(tmpdir()), 'openplc-e2e-resource-action-bars')
const PROJECT_NAME = 'resource-action-bars'

const WINDOW = { width: 1280, height: 800 }

const ACTION_BARS = [
  {
    container: 'Variables editor container',
    bar: 'Variables editor actions',
    add: 'Add table row button',
    remove: 'Remove table row button',
    up: 'Move table row up button',
    down: 'Move table row down button',
  },
  {
    container: 'Tasks editor container',
    bar: 'Tasks editor actions',
    add: 'Add Tasks table row button',
    remove: 'Remove Tasks table row button',
    up: 'Move Tasks table row up button',
    down: 'Move Tasks table row down button',
  },
  {
    container: 'instances editor container',
    bar: 'instances editor actions',
    add: 'Add instances table row button',
    remove: 'Remove instances table row button',
    up: 'Move instances table row up button',
    down: 'Move instances table row down button',
  },
]

function writeFixture(): { project: string; userData: string } {
  const project = join(ROOT, 'project')
  const userData = join(ROOT, 'userdata')
  rmSync(ROOT, { recursive: true, force: true })
  mkdirSync(join(project, 'pous', 'programs'), { recursive: true })
  mkdirSync(join(project, 'devices', 'servers'), { recursive: true })
  mkdirSync(join(project, 'devices', 'remote'), { recursive: true })

  writeFileSync(
    join(project, 'project.json'),
    JSON.stringify({
      meta: { name: PROJECT_NAME, type: 'plc-project' },
      data: {
        dataTypes: [],
        pous: [],
        configuration: {
          resource: {
            tasks: [
              { name: 'task0', triggering: 'Cyclic', interval: 'T#20ms', priority: 1 },
              { name: 'task1', triggering: 'Cyclic', interval: 'T#50ms', priority: 2 },
            ],
            instances: [
              { name: 'instance0', program: 'main', task: 'task0' },
              { name: 'instance1', program: 'main', task: 'task1' },
            ],
            globalVariables: [
              {
                name: 'FirstGlobal',
                class: 'global',
                type: { definition: 'base-type', value: 'BOOL' },
                location: '',
                documentation: '',
              },
              {
                name: 'SecondGlobal',
                class: 'global',
                type: { definition: 'base-type', value: 'INT' },
                location: '',
                documentation: '',
              },
            ],
          },
        },
        libraries: [],
        debugVariables: { global: [], pous: {} },
      },
    }),
  )
  writeFileSync(
    join(project, 'devices', 'configuration.json'),
    JSON.stringify({
      deviceBoard: 'OpenPLC Runtime v4',
      communicationPort: '',
      runtimeIpAddress: '192.168.1.50',
      selectedPlatformOptions: {},
    }),
  )
  writeFileSync(join(project, 'devices', 'pin-mapping.json'), '{}')
  writeFileSync(
    join(project, 'pous', 'programs', 'main.st'),
    'PROGRAM main\n  VAR\n    Idle : BOOL;\n  END_VAR\n\nIdle := TRUE;\n\nEND_PROGRAM\n',
  )

  const history = join(userData, 'User', 'History')
  mkdirSync(history, { recursive: true })
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

  const runtime = join(userData, 'User', 'Runtime')
  mkdirSync(runtime, { recursive: true })
  writeFileSync(join(runtime, 'arduino-core-control.json'), '[]')
  writeFileSync(join(runtime, 'arduino-library-control.json'), '[]')
  return { project, userData }
}

async function launch(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [join(__dirname, '..', 'release', 'app', 'dist', 'main', 'main.js'), `--user-data-dir=${userData}`],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      try {
        if (w.url().includes('index.html')) {
          await w.waitForLoadState('domcontentloaded')
          return { app, page: w }
        }
      } catch {
        continue
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('the editor window never appeared')
}

/** Selecting a row can leave a cell editor or a dropdown open, which then swallows the next click. */
async function selectRow(page: Page, rows: Locator, index: number): Promise<void> {
  await rows.nth(index).locator('td').first().click()
  await page.keyboard.press('Escape')
}

async function openResourceScreen(page: Page): Promise<void> {
  await page.getByText(PROJECT_NAME, { exact: true }).first().click()
  await page.getByText('Resource', { exact: true }).first().click()
  await expect(page.locator("[aria-label='Tasks editor actions']")).toBeVisible()
}

async function expectBarFitsItsContainer(page: Page, container: string, bar: string, buttons: string[]): Promise<void> {
  const measured = await page.evaluate(
    ({ container, bar }) => {
      // Tabs stay mounted and hidden, so several copies of the same editor are in the DOM.
      const roots = Array.from(document.querySelectorAll(`[aria-label='${container}']`))
      const root = roots.find((el) => el.getClientRects().length > 0)
      const el = root?.querySelector(`[aria-label='${bar}']`)
      if (!root || !el) return null
      return {
        bar: el.getBoundingClientRect().width,
        holder: root.clientWidth,
        barClient: el.clientWidth,
        barScroll: el.scrollWidth,
      }
    },
    { container, bar },
  )

  expect(measured, `the action bar '${bar}' is not in the DOM`).not.toBeNull()
  if (!measured) return
  expect(measured.bar, `'${bar}' is wider than the panel that holds it`).toBeLessThanOrEqual(measured.holder + 1)
  expect(measured.barScroll, `'${bar}' overflows its own width`).toBeLessThanOrEqual(measured.barClient + 1)

  const viewport = page.viewportSize() ?? WINDOW
  for (const button of buttons) {
    const box = await buttonIn(page, container, button).boundingBox()
    expect(box, `'${button}' has no box`).not.toBeNull()
    if (!box) continue
    expect(box.x, `'${button}' starts left of the window`).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, `'${button}' runs past the right edge of the window`).toBeLessThanOrEqual(viewport.width)
  }
}

function containerOf(page: Page, container: string): Locator {
  return page.locator(`[aria-label='${container}']:visible`).first()
}

function buttonIn(page: Page, container: string, button: string): Locator {
  return containerOf(page, container).locator(`[aria-label='${button}']:visible`).first()
}

function rowsOf(page: Page, container: string): Locator {
  return containerOf(page, container).locator('tbody:visible tr')
}

test.describe('Resource action bars follow the panel width', () => {
  test.describe.configure({ mode: 'serial', timeout: 120000 })

  let app: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    test.setTimeout(180000)
    const { userData } = writeFixture()
    const launched = await launch(userData)
    app = launched.app
    page = launched.page
    await page.setViewportSize(WINDOW)
    await openResourceScreen(page)
  })

  test.afterAll(() => {
    app?.process().kill('SIGKILL')
  })

  test('AC8 - every action bar fits the Resource panel, and add, remove and move still work', async () => {
    for (const { container, bar, add, remove, up, down } of ACTION_BARS) {
      await expectBarFitsItsContainer(page, container, bar, [add, remove, up, down])

      const rows = rowsOf(page, container)
      const before = await rows.count()

      await buttonIn(page, container, add).click()
      await expect(rows).toHaveCount(before + 1)

      await selectRow(page, rows, before)
      await expect(buttonIn(page, container, up)).toBeEnabled()
      await buttonIn(page, container, up).click()
      await expect(rows).toHaveCount(before + 1)

      await selectRow(page, rows, before - 1)
      await expect(buttonIn(page, container, down)).toBeEnabled()
      await buttonIn(page, container, down).click()
      await expect(rows).toHaveCount(before + 1)

      await selectRow(page, rows, before)
      await buttonIn(page, container, remove).click()
      await expect(rows).toHaveCount(before)
    }
  })

  test('AC8 - the Resource panel never scrolls sideways at the narrowest supported width', async () => {
    await page.setViewportSize({ width: 1024, height: 800 })
    for (const { container, bar, add, remove, up, down } of ACTION_BARS) {
      await expectBarFitsItsContainer(page, container, bar, [add, remove, up, down])
    }
    await page.setViewportSize(WINDOW)
  })
})
