/**
 * HMI in the project model: screens (`hmi/<Name>.st`), widget blocks (`hmi/widgets/<Name>.st`) and HMI Settings
 * (`hmi/settings.json`) open from disk into the project tree, open in the ST editor, are created from the + menu,
 * renamed with the impact dialog renaming their references, deleted, and saved back to disk.
 *
 * Running it needs a production build plus the preload at the path a NON-packaged app looks for it; see "Electron
 * e2e" in CLAUDE.md. Every wait also reads the app's own error text and fails at once when the app reports one.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron, expect, test } from '@playwright/test'

const ROOT = join(realpathSync(tmpdir()), 'openplc-e2e-hmi-project-model')
const FIXTURE = join(ROOT, 'project')
const USER_DATA = join(ROOT, 'userdata')

const OVERVIEW =
  "FUNCTION_BLOCK Overview EXTENDS HmiScreen\n  VAR\n    Title : HmiLabel := (Text := 'Overview');\n  END_VAR\nEND_FUNCTION_BLOCK\n"
const DETAILS =
  'FUNCTION_BLOCK Details EXTENDS HmiScreen\n  VAR\n    Back : HmiButton;\n  END_VAR\n  IF Back.Clicked THEN HMI_Show(HMI_SCREEN#Overview); END_IF;\nEND_FUNCTION_BLOCK\n'
const SETTINGS = { startScreen: 'Overview', roles: { Overview: { engineer: true, operator: true, viewer: true } } }

/** Messages the app shows when it failed; seeing one ends the test at once. */
const APP_FAILURES = [/Failed to open project/i, /Something went wrong/i, /could not be loaded/i, /Error saving file/i]

function writeFixture(): void {
  rmSync(ROOT, { recursive: true, force: true })
  mkdirSync(join(FIXTURE, 'devices'), { recursive: true })
  mkdirSync(join(FIXTURE, 'pous', 'programs'), { recursive: true })
  mkdirSync(join(FIXTURE, 'hmi'), { recursive: true })
  writeFileSync(
    join(FIXTURE, 'project.json'),
    JSON.stringify({
      meta: { name: 'hmi-model', type: 'plc-project' },
      data: {
        dataTypes: [],
        pous: [],
        configuration: {
          resource: {
            tasks: [{ name: 'task0', triggering: 'Cyclic', interval: 'T#20ms', priority: 1 }],
            instances: [{ name: 'instance0', program: 'main', task: 'task0' }],
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
      deviceBoard: 'OpenPLC Runtime v4',
      communicationPort: '',
      runtimeIpAddress: '',
      selectedPlatformOptions: {},
    }),
  )
  writeFileSync(join(FIXTURE, 'devices', 'pin-mapping.json'), '{}')
  writeFileSync(
    join(FIXTURE, 'pous', 'programs', 'main.st'),
    'PROGRAM main\n  VAR\n    level : REAL;\n  END_VAR\n  level := level;\nEND_PROGRAM\n',
  )
  writeFileSync(join(FIXTURE, 'hmi', 'Overview.st'), OVERVIEW)
  writeFileSync(join(FIXTURE, 'hmi', 'Details.st'), DETAILS)
  writeFileSync(join(FIXTURE, 'hmi', 'settings.json'), JSON.stringify(SETTINGS))

  const history = join(USER_DATA, 'User', 'History')
  mkdirSync(history, { recursive: true })
  writeFileSync(
    join(history, 'projects.json'),
    JSON.stringify([
      {
        name: 'hmi-model',
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
        /* window is closing */
      }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('main window never appeared')
}

/** Fails at once with the app's own words when it reports a failure. */
async function failIfAppReportedFailure(page: Page): Promise<void> {
  const text = await page.locator('body').innerText()
  const failure = APP_FAILURES.find((pattern) => pattern.test(text))
  if (failure)
    throw new Error(
      `the app reported a failure: ${text
        .split('\n')
        .filter((l) => failure.test(l))
        .join(' | ')}`,
    )
}

/** Waits for a condition, checking the app's error text on every poll. */
async function waitFor(page: Page, what: string, check: () => Promise<boolean>, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await failIfAppReportedFailure(page)
    if (await check()) return
    await page.waitForTimeout(250)
  }
  await page.screenshot({ path: join(ROOT, 'timeout.png') })
  throw new Error(`timed out waiting for ${what}`)
}

const save = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'))
    win?.webContents.send('project:save-accelerator')
  })

/** A project tree leaf; tabs and breadcrumbs show the same names, so only the tree's leaf rows count. */
const leaf = (page: Page, name: string) =>
  page.locator('li.group').filter({ has: page.getByText(new RegExp(`^(\\* )?${name}$`)) })

/** Monaco renders spaces as non-breaking spaces. */
const editorText = async (page: Page) =>
  (await page.locator('[data-testid="hmi-code-editor"] .view-lines:visible').innerText()).replace(/\u00a0/g, ' ')

const hmiFile = (...parts: string[]) => join(FIXTURE, 'hmi', ...parts)

async function createFromMenu(page: Page, target: 'hmi-screen' | 'hmi-widget', name: string): Promise<void> {
  await page.locator('#create-plc-element-trigger').click()
  await page.locator(`#create-${target}-trigger`).hover()
  await page.locator('#hmi-name').fill(name)
  await page.locator(`#create-${target}-content`).getByRole('button', { name: 'Create' }).click()
}

test.describe('HMI project model', () => {
  test.setTimeout(180000)

  test('opens, creates, renames with references, deletes and saves screens and widget blocks', async () => {
    writeFixture()
    const { app, page } = await launch()
    try {
      await page.getByText('hmi-model', { exact: true }).first().click({ timeout: 30000 })
      await waitFor(
        page,
        'the HMI branch',
        async () => (await page.getByText('HMI Settings', { exact: true }).count()) > 0,
      )

      // A screen opens in the designer; its code view holds the file's text.
      await leaf(page, 'Overview').click()
      await page.getByRole('button', { name: 'Code', exact: true }).click({ timeout: 30000 })
      await waitFor(page, 'the Overview source', async () => (await editorText(page)).includes('EXTENDS HmiScreen'))

      // HMI Settings opens its placeholder tab.
      await leaf(page, 'HMI Settings').click()
      await expect(page.getByTestId('hmi-settings-placeholder')).toBeVisible({ timeout: 10000 })

      // A widget block from the + menu, and a name the HMI library already uses is refused.
      await createFromMenu(page, 'hmi-widget', 'HmiLamp')
      await expect(page.getByText('"HmiLamp" is taken by the HMI library').first()).toBeVisible({ timeout: 10000 })
      await page.locator('#hmi-name').fill('Badge')
      await page.locator('#create-hmi-widget-content').getByRole('button', { name: 'Create' }).click()
      await waitFor(page, 'the Badge editor', async () =>
        (await editorText(page)).includes('FUNCTION_BLOCK Badge EXTENDS HmiElement'),
      )
      await save(app)
      await waitFor(page, 'Badge on disk', async () => existsSync(hmiFile('widgets', 'Badge.st')))
      expect(readFileSync(hmiFile('widgets', 'Badge.st'), 'utf-8')).toMatch(/^FUNCTION_BLOCK Badge EXTENDS HmiElement/)

      // Cancelling the impact dialog renames nothing and reports no failure.
      await leaf(page, 'Overview').locator('span').first().dblclick()
      await page.keyboard.press('ControlOrMeta+A')
      await page.keyboard.type('Start')
      await page.keyboard.press('Enter')
      await page.getByRole('button', { name: 'Cancel rename' }).click({ timeout: 10000 })
      await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10000 })
      await waitFor(page, 'the cancelled rename', async () => (await leaf(page, 'Overview').count()) > 0)
      expect(await leaf(page, 'Start').count()).toBe(0)
      expect(await page.getByText('Rename failed').count()).toBe(0)

      // Renaming a referenced screen asks, and confirming renames the navigation and HMI Settings too.
      await leaf(page, 'Overview').locator('span').first().dblclick()
      await page.keyboard.press('ControlOrMeta+A')
      await page.keyboard.type('Home')
      await page.keyboard.press('Enter')
      await page.getByRole('button', { name: /Yes, rename references/ }).click({ timeout: 10000 })
      await waitFor(page, 'the renamed leaf', async () => (await leaf(page, 'Home').count()) > 0)

      // Deleting a widget block asks first.
      await leaf(page, 'Badge').hover()
      await leaf(page, 'Badge').locator('button').last().click()
      await page.getByText('Delete', { exact: true }).last().click()
      await page.getByRole('button', { name: 'Delete' }).click()
      await waitFor(page, 'Badge leaving the tree', async () => (await leaf(page, 'Badge').count()) === 0)

      await save(app)
      await waitFor(
        page,
        'the save',
        async () =>
          existsSync(hmiFile('Home.st')) &&
          !existsSync(hmiFile('Overview.st')) &&
          !existsSync(hmiFile('widgets', 'Badge.st')),
      )

      expect(readFileSync(hmiFile('Home.st'), 'utf-8')).toMatch(/^FUNCTION_BLOCK Home EXTENDS HmiScreen/)
      expect(readFileSync(hmiFile('Details.st'), 'utf-8')).toContain('HMI_Show(HMI_SCREEN#Home)')
      const settings = JSON.parse(readFileSync(hmiFile('settings.json'), 'utf-8'))
      expect(settings.startScreen).toBe('Home')
      expect(Object.keys(settings.roles)).toEqual(['Home'])
      expect(JSON.parse(readFileSync(join(FIXTURE, 'project.json'), 'utf-8')).data.hmi).toBeUndefined()
    } catch (error) {
      await page.screenshot({ path: join(ROOT, 'failure.png') })
      throw error
    } finally {
      app.process().kill('SIGKILL')
    }

    // What was saved is what opens again.
    const reopened = await launch()
    try {
      await reopened.page.getByText('hmi-model', { exact: true }).first().click({ timeout: 30000 })
      await waitFor(
        reopened.page,
        'the reopened HMI branch',
        async () => (await leaf(reopened.page, 'Home').count()) > 0,
      )
      expect(await leaf(reopened.page, 'Overview').count()).toBe(0)
      expect(await leaf(reopened.page, 'Badge').count()).toBe(0)
      await leaf(reopened.page, 'Details').click()
      await reopened.page.getByRole('button', { name: 'Code', exact: true }).click({ timeout: 30000 })
      await waitFor(reopened.page, 'the Details source', async () =>
        (await editorText(reopened.page)).includes('HMI_Show(HMI_SCREEN#Home)'),
      )
    } catch (error) {
      await reopened.page.screenshot({ path: join(ROOT, 'failure-reopened.png') })
      throw error
    } finally {
      reopened.app.process().kill('SIGKILL')
    }
  })
})
