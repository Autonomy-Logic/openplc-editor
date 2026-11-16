import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron, expect, test } from '@playwright/test'

const ROOT = join(tmpdir(), 'openplc-e2e-type-dropdown')
const FIXTURE = join(ROOT, 'project')
const USER_DATA = join(ROOT, 'userdata')

const FUNCTION_POU = `FUNCTION addnumbers : INT
  VAR_INPUT
    a : INT;
    b : INT;
  END_VAR

  addnumbers := a + b;
END_FUNCTION
`

function writeFixture(): void {
  rmSync(ROOT, { recursive: true, force: true })
  mkdirSync(join(FIXTURE, 'pous', 'functions'), { recursive: true })
  writeFileSync(
    join(FIXTURE, 'project.json'),
    JSON.stringify({
      meta: { name: 'type-dropdown', type: 'plc-project' },
      data: {
        dataTypes: [],
        pous: [],
        configuration: { resource: { tasks: [], instances: [], globalVariables: [] } },
      },
    }),
  )
  writeFileSync(join(FIXTURE, 'pous', 'functions', 'addnumbers.st'), FUNCTION_POU)

  const history = join(USER_DATA, 'User', 'History')
  mkdirSync(history, { recursive: true })
  writeFileSync(
    join(history, 'projects.json'),
    JSON.stringify([
      {
        name: 'type-dropdown',
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

test('the return type list fits a short window and reaches its last type', async () => {
  test.setTimeout(180000)
  writeFixture()

  const { app, page } = await launch()
  try {
    // Short enough that 22 items cannot fit: the clipped popup used to end at DT.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('index.html'))
        ?.setSize(1100, 560)
    })

    await page.getByText('type-dropdown', { exact: true }).first().click({ timeout: 30000 })
    const pou = page.getByText('addnumbers', { exact: true }).first()
    await expect(pou).toBeVisible({ timeout: 30000 })
    await pou.click({ timeout: 30000 })

    const trigger = page.locator('#return-type')
    await expect(trigger).toBeVisible({ timeout: 30000 })
    await trigger.click({ timeout: 15000 })
    const listbox = page.getByRole('listbox')
    await expect(listbox).toBeVisible({ timeout: 15000 })

    const windowHeight = await page.evaluate(() => window.innerHeight)
    const box = await listbox.boundingBox()
    if (!box) throw new Error('the open listbox has no bounding box')
    expect(box.height).toBeLessThanOrEqual(windowHeight)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(windowHeight)

    const last = page.getByRole('option', { name: 'WSTRING' })
    await last.scrollIntoViewIfNeeded({ timeout: 15000 })
    await last.click({ timeout: 15000 })

    await expect(trigger).toHaveText(/WSTRING/, { timeout: 15000 })
  } finally {
    app.process().kill('SIGKILL')
  }
})
