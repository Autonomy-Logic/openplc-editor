/**
 * DOPE-652 / GitHub #977 - external file changes must keep reaching the editor.
 *
 * An ST POU's body editor and the STruC++ LSP model sync are bound to the same
 * `pou://` model, so a disk-driven reload wrote through to the editor's own model
 * and surfaced as a user edit, flagging the POU unsaved. The file watcher only
 * reloads a POU that is still saved, so the sync then stopped for good.
 *
 * Running this suite needs a production build plus the preload at the path a
 * NON-packaged app looks for it; see "Electron e2e" in CLAUDE.md. No CI workflow
 * runs Playwright today, so this is a local check.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron, expect, test } from '@playwright/test'

const ROOT = join(tmpdir(), 'openplc-e2e-external-file-sync')

// Each test gets its own project directory and its own Electron profile, keyed by
// the test title, so nothing is shared across tests and they can run in parallel
// and be reported independently. Nothing is written inside the working tree.
let FIXTURE = ''
let USER_DATA = ''
let ST_FILE = ''
let IL_FILE = ''

const stBody = (marker: number) => `PROGRAM main
  VAR
    counter : INT;
    marker : INT;
  END_VAR

counter := counter + 1;
marker := ${marker};

END_PROGRAM
`

const ilBody = (n: number) => `PROGRAM side
  VAR
    ilCounter : INT;
  END_VAR

LD ilCounter
ADD ${n}
ST ilCounter

END_PROGRAM
`

let app: ElectronApplication
let page: Page

/** Write the minimal on-disk project this suite drives, at its initial state. */
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
  writeFileSync(ST_FILE, stBody(1), 'utf-8')
  writeFileSync(IL_FILE, ilBody(1), 'utf-8')
}

/** Seed the recent-projects list so the start screen offers the fixture. */
function writeRecentProjects(): void {
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
}

/**
 * The app opens a splash window first, so `firstWindow()` races it and returns a
 * page that closes moments later. Pick the real one by URL.
 */
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

/**
 * Every open tab keeps its Monaco editor mounted, hidden with `display: none`,
 * so the body has to be read from the visible one.
 */
const visibleBody = () => page.locator('.view-lines:visible').first()

/** Poll the visible editor until it shows `needle`. Returns the last text either way. */
async function waitForText(needle: string, timeoutMs = 10000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    last = (await visibleBody().innerText()).replace(/ /g, ' ')
    if (last.includes(needle)) return last
    await page.waitForTimeout(400)
  }
  return last
}

/** Open the fixture from the start screen and open one POU's tab. */
async function openPou(pouName: string): Promise<void> {
  await page.getByText('external-file-sync', { exact: true }).first().click({ timeout: 30000 })
  await page.getByText(pouName, { exact: true }).first().click({ timeout: 30000 })
}

test.beforeEach(async ({}, testInfo) => {
  const slug = testInfo.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  FIXTURE = join(ROOT, slug, 'project')
  USER_DATA = join(ROOT, slug, 'userdata')
  ST_FILE = join(FIXTURE, 'pous', 'programs', 'main.st')
  IL_FILE = join(FIXTURE, 'pous', 'programs', 'side.il')

  writeFixture()
  writeRecentProjects()

  app = await electron.launch({
    args: [join(__dirname, '..', 'release', 'app', 'dist', 'main', 'main.js'), `--user-data-dir=${USER_DATA}`],
    // NOT development: `resolveHtmlPath` would point the window at the webpack dev
    // server on localhost:1212, which is not running against a production build.
    env: { ...process.env, NODE_ENV: 'production' },
  })
  page = await mainWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterEach(async () => {
  await app?.close()
})

test('ST: consecutive external edits all reach the editor', async () => {
  test.setTimeout(120000)
  await openPou('main')
  expect(await waitForText('marker := 1;'), 'editor should show the on-disk body on open').toContain('marker := 1;')

  writeFileSync(ST_FILE, stBody(2), 'utf-8')
  expect(await waitForText('marker := 2;'), 'first external edit must reach the editor').toContain('marker := 2;')

  // The one that regressed: without the guard the first reload flags the POU
  // unsaved, and `handleExternalChange` then refuses to reload it ever again.
  writeFileSync(ST_FILE, stBody(3), 'utf-8')
  expect(await waitForText('marker := 3;'), 'second external edit must reach the editor').toContain('marker := 3;')

  writeFileSync(ST_FILE, stBody(4), 'utf-8')
  expect(await waitForText('marker := 4;'), 'third external edit must reach the editor').toContain('marker := 4;')
})

test('ST: a typed edit does mark the POU dirty, which suspends the disk sync', async () => {
  test.setTimeout(120000)
  await openPou('main')
  await waitForText('marker := 1;')

  await visibleBody().click()
  await page.keyboard.type('(* local edit *)')
  // Observe the keystrokes landing rather than sleeping: on a slow renderer the
  // disk write below could otherwise be processed first.
  await expect(visibleBody()).toContainText('(* local edit *)')

  writeFileSync(ST_FILE, stBody(9), 'utf-8')
  const after = await waitForText('marker := 9;', 6000)

  // Guard against a vacuous pass: a blank editor would satisfy the negative
  // assertion on its own.
  expect(after, 'editor should still show the typed text').toContain('(* local edit *)')
  expect(after, 'editor should still show the body it had').toContain('marker := 1;')
  expect(after, 'a dirty POU must not be overwritten from disk').not.toContain('marker := 9;')
})

test('ST: reopening a tab picks up the on-disk body and leaves it saved', async () => {
  test.setTimeout(120000)
  await openPou('main')
  await waitForText('marker := 1;')

  // The POU is untouched, so closing raises no save dialog.
  const tab = page.locator('div.group', { hasText: 'main' }).first()
  await tab.hover()
  await tab.locator('svg').last().click()
  await expect(visibleBody()).toHaveCount(0)

  writeFileSync(ST_FILE, stBody(5), 'utf-8')
  await page.getByText('main', { exact: true }).first().click({ timeout: 30000 })
  expect(await waitForText('marker := 5;'), 'reopened tab must show the on-disk body').toContain('marker := 5;')

  // Still saved, so a further external edit must land. This is what the
  // mount-time guard protects.
  writeFileSync(ST_FILE, stBody(6), 'utf-8')
  expect(await waitForText('marker := 6;'), 'reopened tab must stay saved and keep syncing').toContain('marker := 6;')
})

test('IL: unaffected, external edits land and keep landing', async () => {
  test.setTimeout(120000)
  await openPou('side')
  expect(await waitForText('ADD 1'), 'IL body should load from disk').toContain('ADD 1')

  writeFileSync(IL_FILE, ilBody(2), 'utf-8')
  expect(await waitForText('ADD 2'), 'first external IL edit must land').toContain('ADD 2')

  writeFileSync(IL_FILE, ilBody(3), 'utf-8')
  expect(await waitForText('ADD 3'), 'IL sync must not latch off either').toContain('ADD 3')
})
