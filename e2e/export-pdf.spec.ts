/**
 * Export to PDF reaches a rendered preview and an enabled Export.
 *
 * The preview effect used to cancel its own render, so the wizard stayed on
 * "Rendering preview…" forever and Export never became clickable. This drives
 * the real app: real project, real pdf-lib render, real pdf.js canvas. Going
 * back to the options step and forward again has to render a second time.
 *
 * Running this suite needs a production build plus the preload at the path a
 * NON-packaged app looks for it; see "Electron e2e" in CLAUDE.md. No CI workflow
 * runs Playwright today, so this is a local check.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron, expect, test } from '@playwright/test'

const ROOT = join(tmpdir(), 'openplc-e2e-export-pdf')
const FIXTURE = join(ROOT, 'project')
const USER_DATA = join(ROOT, 'userdata')

const PROGRAM = `PROGRAM stmain
  VAR
    a : BOOL;
    b : BOOL;
  END_VAR

  b := NOT a;
END_PROGRAM
`

function writeFixture(): void {
  rmSync(ROOT, { recursive: true, force: true })
  mkdirSync(join(FIXTURE, 'pous', 'programs'), { recursive: true })
  writeFileSync(
    join(FIXTURE, 'project.json'),
    JSON.stringify({
      meta: { name: 'export-pdf', type: 'plc-project' },
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
      },
    }),
  )
  writeFileSync(join(FIXTURE, 'pous', 'programs', 'stmain.st'), PROGRAM)

  const history = join(USER_DATA, 'User', 'History')
  mkdirSync(history, { recursive: true })
  writeFileSync(
    join(history, 'projects.json'),
    JSON.stringify([
      {
        name: 'export-pdf',
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

const exportButton = (page: Page) => page.getByRole('button', { name: 'Export', exact: true })

/** File > Print is a native menu accelerator, which Playwright's keyboard never reaches. */
const print = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'))
    win?.webContents.send('project:print-accelerator')
  })

test('the preview renders and Export becomes available, again after going back', async () => {
  test.setTimeout(180000)
  writeFixture()

  const { app, page } = await launch()
  try {
    await page.getByText('export-pdf', { exact: true }).first().click({ timeout: 30000 })
    await page.waitForTimeout(5000)

    await print(app)

    await page.getByRole('button', { name: 'Next', exact: true }).click({ timeout: 15000 })
    await page.getByRole('button', { name: 'Next', exact: true }).click({ timeout: 15000 })

    await expect(exportButton(page)).toBeEnabled({ timeout: 60000 })
    await expect(page.getByText('Rendering preview…')).toHaveCount(0)
    await expect(page.locator('canvas').first()).toBeVisible()

    await page.getByRole('button', { name: 'Back', exact: true }).click({ timeout: 15000 })
    await page.getByRole('button', { name: 'Next', exact: true }).click({ timeout: 15000 })

    await expect(exportButton(page)).toBeEnabled({ timeout: 60000 })
    await expect(page.locator('canvas').first()).toBeVisible()
  } finally {
    app.process().kill('SIGKILL')
  }
})
