/**
 * The debugger tag table in the desktop build, driven through the test-only seam.
 *
 * Needs a production build made with OPENPLC_E2E_DEBUG_SEAM=1, as the seam is
 * absent from a plain build; see "Electron e2e" in CLAUDE.md.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron, expect, test } from '@playwright/test'

type DebugTreeNode = {
  name: string
  fullPath: string
  compositeKey: string
  type: string
  isComplex: boolean
  debugIndex?: number
}

type DebugSessionSeam = {
  open(): void
  close(): void
  isOpen(): boolean
  publishVariables(nodes: DebugTreeNode[], indexes?: Record<string, number>): void
}

declare global {
  interface Window {
    __OPENPLC_E2E_DEBUG_SESSION__?: DebugSessionSeam
  }
}

const ROOT = join(tmpdir(), 'openplc-e2e-debug-tag-table')
const FIXTURE = join(ROOT, 'project')
const USER_DATA = join(ROOT, 'userdata')
const PROJECT_FILE = join(FIXTURE, 'project.json')

const TAGS: DebugTreeNode[] = [
  { name: 'motor', fullPath: 'main.motor', compositeKey: 'main:MOTOR', type: 'BOOL', isComplex: false, debugIndex: 0 },
  { name: 'speed', fullPath: 'main.speed', compositeKey: 'main:SPEED', type: 'INT', isComplex: false, debugIndex: 1 },
  {
    name: 'SystemOn',
    fullPath: 'SystemOn',
    compositeKey: 'Config0:SYSTEMON',
    type: 'BOOL',
    isComplex: false,
    debugIndex: 2,
  },
]

const INDEXES = { 'main.motor': 0, 'main.speed': 1, SystemOn: 2 }

function writeFixture(): void {
  rmSync(ROOT, { recursive: true, force: true })
  mkdirSync(join(FIXTURE, 'pous', 'programs'), { recursive: true })
  mkdirSync(join(FIXTURE, 'devices'), { recursive: true })

  writeFileSync(
    PROJECT_FILE,
    JSON.stringify({
      meta: { name: 'tag-table', type: 'plc-project' },
      data: {
        dataTypes: [],
        pous: [],
        globalVariableLists: [],
        servers: [],
        remoteDevices: [],
        configuration: {
          resource: {
            tasks: [{ name: 'task0', triggering: 'Cyclic', interval: 'T#20ms', priority: 1 }],
            instances: [{ name: 'instance0', program: 'main', task: 'task0' }],
            globalVariables: [
              {
                name: 'SystemOn',
                class: 'global',
                type: { definition: 'base-type', value: 'BOOL' },
                location: '%IX0.0',
                initialValue: null,
                documentation: 'plant running',
                debug: true,
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
    join(FIXTURE, 'pous', 'programs', 'main.st'),
    'PROGRAM main\n' +
      '  VAR\n' +
      '    motor : BOOL AT %QX0.0; (* main motor output *)\n' +
      '    speed : INT := 5; (* conveyor setpoint *)\n' +
      '  END_VAR\n\n' +
      'speed := speed;\n\n' +
      'END_PROGRAM\n',
  )

  writeFileSync(
    join(FIXTURE, 'devices', 'configuration.json'),
    JSON.stringify({
      deviceBoard: 'OpenPLC Runtime v4',
      communicationPort: '',
      runtimeIpAddress: '192.168.1.50',
      selectedPlatformOptions: {},
    }),
  )
  writeFileSync(join(FIXTURE, 'devices', 'pin-mapping.json'), '{}')

  const history = join(USER_DATA, 'User', 'History')
  mkdirSync(history, { recursive: true })
  writeFileSync(
    join(history, 'projects.json'),
    JSON.stringify([
      {
        name: 'tag-table',
        path: FIXTURE,
        projectFilePath: PROJECT_FILE,
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

/** The window the harness opens is small enough to clip the project cards. */
async function sizeWindow(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'))
    win?.setSize(1600, 1000)
  })
}

async function openProject(page: Page): Promise<void> {
  await page.getByText('tag-table', { exact: true }).first().click({ timeout: 30000 })
  await page.getByText('main', { exact: true }).first().click({ timeout: 30000 })
}

async function openTagTable(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => typeof window.__OPENPLC_E2E_DEBUG_SESSION__)).toBe('object')
  await page.evaluate(
    ([nodes, indexes]) => {
      window.__OPENPLC_E2E_DEBUG_SESSION__?.open()
      window.__OPENPLC_E2E_DEBUG_SESSION__?.publishVariables(
        nodes as DebugTreeNode[],
        indexes as Record<string, number>,
      )
    },
    [TAGS, INDEXES],
  )
  await page.getByRole('tab', { name: 'Tags', exact: true }).click()
}

/** Ctrl+S is a native menu accelerator, which Playwright's keyboard never reaches. */
const save = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'))
    win?.webContents.send('project:save-accelerator')
  })

const tagTable = (page: Page) => page.getByRole('table', { name: 'Debug tag table' })
const rowOf = (page: Page, name: string) => tagTable(page).getByRole('row').filter({ hasText: name })

test.describe('the debugger tag table through the test-only seam', () => {
  test('lists every published tag with its address and comment, filters them, and keeps a monitor view in the project file', async () => {
    test.setTimeout(180000)
    writeFixture()
    const { app, page } = await launch()
    try {
      await sizeWindow(app)
      await openProject(page)
      await openTagTable(page)

      const motor = rowOf(page, 'motor')
      await expect(motor).toContainText('%QX0.0')
      await expect(motor).toContainText('main motor output')
      await expect(motor).toContainText('BOOL')
      await expect(rowOf(page, 'speed')).toContainText('conveyor setpoint')
      await expect(rowOf(page, 'SystemOn')).toContainText('%IX0.0')
      await expect(page.getByText('3 of 3 tags')).toBeVisible()

      await page.getByLabel('Filter tags').fill('motor')
      await expect(page.getByText('1 of 3 tags')).toBeVisible()
      await expect(rowOf(page, 'speed')).toHaveCount(0)

      await page.getByLabel('Filter tags').fill('')
      await page.getByRole('button', { name: 'New view' }).click()
      await page.getByLabel('Monitor view').selectOption({ label: 'All tags' })
      await page.getByLabel('Area of motor').selectOption('View 1')
      await page.getByLabel('Monitor view').selectOption('View 1')
      await expect(rowOf(page, 'motor')).toHaveCount(1)
      await expect(rowOf(page, 'speed')).toHaveCount(0)

      await save(app)
      await expect
        .poll(
          () => {
            const saved: { data?: { monitorViews?: { name: string; entries: string[] }[] } } = JSON.parse(
              readFileSync(PROJECT_FILE, 'utf8'),
            )
            return saved.data?.monitorViews
          },
          { timeout: 30000 },
        )
        .toEqual([{ name: 'View 1', entries: ['main:MOTOR'] }])

      await page.evaluate(() => window.__OPENPLC_E2E_DEBUG_SESSION__?.close())
      await expect(page.getByRole('tab', { name: 'Tags', exact: true })).toHaveCount(0)
    } finally {
      app.process().kill('SIGKILL')
    }
  })
})
