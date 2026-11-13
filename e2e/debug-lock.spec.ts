/**
 * The debug-mode lock in the desktop build, driven through the test-only seam.
 *
 * Needs a production build made with OPENPLC_E2E_DEBUG_SEAM=1, as the seam is
 * absent from a plain build; see "Electron e2e" in CLAUDE.md.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron, expect, test } from '@playwright/test'

type DebugSessionSeam = { open(): void; close(): void; isOpen(): boolean }

declare global {
  interface Window {
    __OPENPLC_E2E_DEBUG_SESSION__?: DebugSessionSeam
  }
}

const ROOT = join(tmpdir(), 'openplc-e2e-debug-lock')
const FIXTURE = join(ROOT, 'project')
const USER_DATA = join(ROOT, 'userdata')

const vars = `  VAR
    a : BOOL;
    b : BOOL;
  END_VAR
`

function writeFixture(): void {
  rmSync(ROOT, { recursive: true, force: true })
  mkdirSync(join(FIXTURE, 'pous', 'programs'), { recursive: true })
  writeFileSync(
    join(FIXTURE, 'project.json'),
    JSON.stringify({
      meta: { name: 'debug-lock', type: 'plc-project' },
      data: {
        dataTypes: [],
        pous: [{ name: 'ldmain', pouType: 'program', language: 'ld' }],
        globalVariableLists: [],
        servers: [],
        remoteDevices: [],
        configurations: {
          resource: {
            tasks: [{ name: 'task0', triggering: 'Cyclic', interval: 'T#20ms', priority: 1 }],
            instances: [{ name: 'instance0', task: 'task0', program: 'ldmain' }],
            globalVariables: [],
          },
        },
      },
    }),
  )
  writeFileSync(
    join(FIXTURE, 'pous', 'programs', 'ldmain.ld'),
    `PROGRAM ldmain\n${vars}\n${JSON.stringify({ name: 'ldmain', rungs: [] })}\nEND_PROGRAM\n`,
  )

  const history = join(USER_DATA, 'User', 'History')
  mkdirSync(history, { recursive: true })
  writeFileSync(
    join(history, 'projects.json'),
    JSON.stringify([
      {
        name: 'debug-lock',
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
  await page.getByText('debug-lock', { exact: true }).first().click({ timeout: 30000 })
  await page.getByText('ldmain', { exact: true }).first().click({ timeout: 30000 })
  await page.waitForSelector('[aria-label="Rung body"], [aria-label="Create new rung"]', { timeout: 30000 })
}

const openDebugSession = async (page: Page) => {
  await expect.poll(() => page.evaluate(() => typeof window.__OPENPLC_E2E_DEBUG_SESSION__)).toBe('object')
  await page.evaluate(() => window.__OPENPLC_E2E_DEBUG_SESSION__?.open())
}

const closeDebugSession = (page: Page) => page.evaluate(() => window.__OPENPLC_E2E_DEBUG_SESSION__?.close())

test.describe('the debug-mode lock through the test-only seam', () => {
  test('locks the toolbox sources and the rung actions without framing the window, then gives them back', async () => {
    test.setTimeout(180000)
    writeFixture()
    const { app, page } = await launch()
    try {
      await sizeWindow(app)
      await openProject(page)

      const coil = page.getByRole('button', { name: 'Coil' }).first()
      const source = coil.locator('div[draggable]')
      const createRung = page.getByRole('button', { name: 'Create new rung' }).first()
      const frame = page.locator('[data-debug-session-frame="true"]')

      await expect(source).toHaveAttribute('draggable', 'true')
      await expect(createRung).toBeEnabled()
      await expect(frame).toHaveCount(0)

      await openDebugSession(page)

      await expect(source).toHaveAttribute('aria-disabled', 'true')
      await expect(source).not.toHaveAttribute('draggable', 'true')
      await expect(createRung).toBeDisabled()
      await expect(frame).toHaveCount(0)

      await closeDebugSession(page)

      await expect(source).toHaveAttribute('draggable', 'true')
      await expect(createRung).toBeEnabled()
      await expect(frame).toHaveCount(0)
    } finally {
      app.process().kill('SIGKILL')
    }
  })
})
