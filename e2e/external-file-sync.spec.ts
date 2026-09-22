/**
 * DOPE-652 / GitHub #977 - external file changes must keep reaching the editor.
 *
 * The bug: an ST POU and the STruC++ LSP model sync share one Monaco model, so a
 * disk-driven reload wrote through `updatePou` -> `setValue` -> an `onChange` that
 * `@monaco-editor/react` does not suppress, and the POU was flagged unsaved. From
 * then on `handleExternalChange` refused to reload it, because it only reloads a
 * file that is still saved, and the sync was dead for the rest of the session.
 *
 * Running this suite requires a production build plus the preload at the path a
 * NON-packaged app looks for it; see "Electron e2e" in CLAUDE.md. No CI workflow
 * runs Playwright today, so this is a local check.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron, expect, test } from '@playwright/test'

// The project and the Electron profile are both generated under the OS temp dir, so the
// suite is self-contained and leaves nothing behind in the working tree.
const FIXTURE = join(tmpdir(), 'openplc-e2e-external-file-sync', 'project')
const POU_FILE = join(FIXTURE, 'pous', 'programs', 'main.st')
const IL_FILE = join(FIXTURE, 'pous', 'programs', 'side.il')
const USER_DATA = join(tmpdir(), 'openplc-e2e-external-file-sync', 'userdata')

const body = (marker: number) => `PROGRAM main
  VAR
    counter : INT;
    marker : INT;
  END_VAR

counter := counter + 1;
marker := ${marker};

END_PROGRAM
`

const il = (n: number) => `PROGRAM side
  VAR
    ilCounter : INT;
  END_VAR

LD ilCounter
ADD ${n}
ST ilCounter

END_PROGRAM
`

// `playwright.config.ts` sets `fullyParallel: true`, which would otherwise spread these
// tests across workers: each would launch its own Electron and fight over the same
// fixture directory. They also run in sequence by design, each one leaving the app in
// the state the next expects.
test.describe.configure({ mode: 'serial' })

let app: ElectronApplication
let page: Page

/** Write the minimal on-disk project this suite drives. */
function writeFixture(): void {
  mkdirSync(join(FIXTURE, 'devices'), { recursive: true })
  mkdirSync(join(FIXTURE, 'pous', 'programs'), { recursive: true })

  writeFileSync(
    join(FIXTURE, 'project.json'),
    JSON.stringify(
      {
        meta: { name: 'external-file-sync', type: 'plc-project' },
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
      },
      null,
      2,
    ),
    'utf-8',
  )
  writeFileSync(
    join(FIXTURE, 'devices', 'configuration.json'),
    JSON.stringify(
      {
        deviceBoard: 'OpenPLC Runtime v4',
        communicationPort: '',
        runtimeIpAddress: '192.168.1.50',
        selectedPlatformOptions: {},
      },
      null,
      2,
    ),
    'utf-8',
  )
  writeFileSync(join(FIXTURE, 'devices', 'pin-mapping.json'), '{}', 'utf-8')
  writeFileSync(POU_FILE, body(1), 'utf-8')
  writeFileSync(IL_FILE, il(1), 'utf-8')
}

test.beforeAll(async () => {
  writeFixture()

  const history = join(USER_DATA, 'User', 'History')
  mkdirSync(history, { recursive: true })
  writeFileSync(
    join(history, 'projects.json'),
    JSON.stringify(
      [
        {
          name: 'external-file-sync',
          path: FIXTURE,
          projectFilePath: join(FIXTURE, 'project.json'),
          createdAt: new Date().toISOString(),
          lastOpenedAt: new Date().toISOString(),
        },
      ],
      null,
      2,
    ),
    'utf-8',
  )
  writeFileSync(join(history, 'libraries.json'), '[]', 'utf-8')

  app = await electron.launch({
    args: [join(__dirname, '..', 'release', 'app', 'dist', 'main', 'main.js'), `--user-data-dir=${USER_DATA}`],
    // NOT development: `resolveHtmlPath` would point the window at http://localhost:1212,
    // the webpack dev server, which is not running against a production build.
    env: { ...process.env, NODE_ENV: 'production' },
  })
  page = await mainWindow()
  await page.waitForLoadState('domcontentloaded')
})

/** The app opens a splash window first, so `firstWindow()` races it. Pick the real one by URL. */
async function mainWindow(): Promise<Page> {
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      try {
        if (w.url().includes('index.html')) return w
      } catch {
        /* window is closing; skip it */
      }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('main window never appeared')
}

test.afterAll(async () => {
  await app?.close()
})

/** Poll the Monaco viewport until it shows `marker := <n>;`, or time out. */
async function waitForMarker(n: number, timeoutMs = 10000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    last = (await page.locator('.view-lines:visible').first().innerText()).replace(/ /g, ' ')
    if (last.includes(`marker := ${n};`)) return last
    await page.waitForTimeout(400)
  }
  return last
}

test('external edits keep syncing and do not dirty the ST POU', async () => {
  test.setTimeout(180000)
  await page.getByText('external-file-sync', { exact: true }).first().click()

  // Workspace is up once the project tree offers the POU.
  await page.getByText('main', { exact: true }).first().click({ timeout: 20000 })

  const initial = await waitForMarker(1)
  expect(initial, 'editor should show the on-disk body on open').toContain('marker := 1;')

  // Criterion 1: first external edit lands.
  writeFileSync(POU_FILE, body(2), 'utf-8')
  expect(await waitForMarker(2), 'first external edit must reach the editor').toContain('marker := 2;')

  // Criterion 2: the sync must not latch off. This is what fails without the guard,
  // because the first reload flags the POU unsaved and `handleExternalChange` then
  // refuses to reload a file that is no longer saved.
  writeFileSync(POU_FILE, body(3), 'utf-8')
  expect(await waitForMarker(3), 'second external edit must reach the editor').toContain('marker := 3;')

  writeFileSync(POU_FILE, body(4), 'utf-8')
  expect(await waitForMarker(4), 'third external edit must reach the editor').toContain('marker := 4;')

  expect(readFileSync(POU_FILE, 'utf-8')).toContain('marker := 4;')
})

test('typing marks the POU dirty, which correctly suspends the disk sync', async () => {
  test.setTimeout(180000)
  // The dirty flag is not rendered anywhere we can assert on, but it is observable
  // through its own consequence: `handleExternalChange` only reloads a file that is
  // still saved. So a real user edit must make the next external edit NOT land.
  await page.locator('.view-lines:visible').first().click()
  await page.keyboard.type('(* local edit *)')
  await page.waitForTimeout(500)

  writeFileSync(POU_FILE, body(9), 'utf-8')
  const after = await waitForMarker(9, 6000)
  // Guard against a vacuous pass: the editor must still be showing a real body.
  expect(after, 'editor should still show the typed text').toContain('(* local edit *)')
  expect(after, 'editor should still show the last synced marker').toContain('marker := 4;')
  expect(after, 'a dirty POU must not be overwritten from disk').not.toContain('marker := 9;')
})

test('reopening the tab picks up the on-disk body and leaves it saved', async () => {
  test.setTimeout(180000)
  // Close the tab, discarding the local edit from the previous test.
  const tab = page.locator('div.group', { hasText: 'main' }).first()
  await tab.hover()
  await tab.locator('svg').last().click()
  const discard = page.getByRole('button', { name: /don't save|discard|no/i }).first()
  if (await discard.isVisible().catch(() => false)) await discard.click()

  writeFileSync(POU_FILE, body(5), 'utf-8')
  await page.getByText('main', { exact: true }).first().click({ timeout: 20000 })
  expect(await waitForMarker(5), 'reopened tab must show the on-disk body').toContain('marker := 5;')

  // Still saved, so a further external edit must land.
  writeFileSync(POU_FILE, body(6), 'utf-8')
  expect(await waitForMarker(6), 'reopened tab must stay saved and keep syncing').toContain('marker := 6;')
})

test('an IL POU is unaffected: external edits land and keep landing', async () => {
  test.setTimeout(180000)
  await page.getByText('side', { exact: true }).first().click({ timeout: 20000 })

  const waitForAdd = async (n: number, timeoutMs = 10000) => {
    const deadline = Date.now() + timeoutMs
    let last = ''
    while (Date.now() < deadline) {
      last = (await page.locator('.view-lines:visible').first().innerText()).replace(/\u00a0/g, ' ')
      if (last.includes(`ADD ${n}`)) return last
      await page.waitForTimeout(400)
    }
    return last
  }

  expect(await waitForAdd(1), 'IL body should load from disk').toContain('ADD 1')

  writeFileSync(IL_FILE, il(2), 'utf-8')
  expect(await waitForAdd(2), 'first external IL edit must land').toContain('ADD 2')

  writeFileSync(IL_FILE, il(3), 'utf-8')
  expect(await waitForAdd(3), 'IL sync must not latch off either').toContain('ADD 3')
})
