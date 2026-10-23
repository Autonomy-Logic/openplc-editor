/**
 * Pressing Debugger while not connected to the target.
 *
 * The offer names the target and its configured address, one "Yes" carries on
 * into a live debug session, and a runtime that cannot be reached says so.
 *
 * Hardware-dependent, so every case is opt-in through the environment:
 *   E2E_RUNTIME_IP        an OpenPLC Runtime v4 with user admin/admin (its program is replaced)
 *   E2E_ESP32_PROJECT     a project whose firmware is already on the board
 *   E2E_ESP32_PORT        the board's serial port
 *   E2E_ESP32_BOARD       optional: the board to set in the copy, when the project names another
 * The ESP32 case uses the vendor packages and Arduino cores of the local editor
 * profile. Running needs a production build plus the preload copy; see
 * "Electron e2e" in CLAUDE.md.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron, expect, test } from '@playwright/test'

const PROFILE = join(homedir(), 'Library', 'Application Support', 'open-plc-editor')
const ROOT = join(realpathSync(tmpdir()), 'openplc-e2e-debugger-connect-offer')
const RUNTIME_IP = process.env.E2E_RUNTIME_IP ?? ''
const ESP32_PROJECT = process.env.E2E_ESP32_PROJECT ?? ''
const ESP32_PORT = process.env.E2E_ESP32_PORT ?? ''
const ESP32_BOARD = process.env.E2E_ESP32_BOARD ?? ''

type Paths = { fixture: string; userData: string }

function pathsFor(slug: string): Paths {
  return { fixture: join(ROOT, slug, 'project'), userData: join(ROOT, slug, 'userdata') }
}

/** A profile that lists the fixture, with what a fresh profile needs for the board list to load. */
function writeProfile({ fixture, userData }: Paths, withLocalPackages: boolean): void {
  const user = join(userData, 'User')
  mkdirSync(join(user, 'History'), { recursive: true })
  mkdirSync(join(user, 'Runtime'), { recursive: true })
  writeFileSync(
    join(user, 'History', 'projects.json'),
    JSON.stringify([
      {
        name: 'debugger-offer',
        path: fixture,
        projectFilePath: join(fixture, 'project.json'),
        createdAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
      },
    ]),
  )
  writeFileSync(join(user, 'History', 'libraries.json'), '[]')
  if (!withLocalPackages) {
    writeFileSync(join(user, 'Runtime', 'arduino-core-control.json'), '[]')
    writeFileSync(join(user, 'Runtime', 'arduino-library-control.json'), '[]')
    return
  }
  cpSync(join(PROFILE, 'User', 'arduino-cli.yaml'), join(user, 'arduino-cli.yaml'))
  for (const file of ['arduino-core-control.json', 'arduino-library-control.json']) {
    cpSync(join(PROFILE, 'User', 'Runtime', file), join(user, 'Runtime', file))
  }
  // A copy, never a symlink: the startup signature check rewrites the registry it finds.
  const packages = join(userData, 'packages')
  cpSync(join(PROFILE, 'packages'), packages, { recursive: true })
  const registry = join(packages, 'registry.json')
  writeFileSync(registry, readFileSync(registry, 'utf-8').split(join(PROFILE, 'packages')).join(packages))
}

/** A one-program ST project for a Runtime v4 at `ip`. */
function writeRuntimeFixture(paths: Paths, ip: string): void {
  const { fixture } = paths
  rmSync(join(fixture, '..'), { recursive: true, force: true })
  mkdirSync(join(fixture, 'pous', 'programs'), { recursive: true })
  mkdirSync(join(fixture, 'pous', 'function-blocks'), { recursive: true })
  mkdirSync(join(fixture, 'devices', 'servers'), { recursive: true })
  mkdirSync(join(fixture, 'devices', 'remote'), { recursive: true })
  writeFileSync(
    join(fixture, 'project.json'),
    JSON.stringify({
      meta: { name: 'debugger-offer', type: 'plc-project' },
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
    join(fixture, 'devices', 'configuration.json'),
    JSON.stringify({
      deviceBoard: 'OpenPLC Runtime v4',
      communicationPort: '',
      runtimeIpAddress: ip,
      selectedPlatformOptions: {},
    }),
  )
  writeFileSync(join(fixture, 'devices', 'pin-mapping.json'), '{}')
  writeFileSync(
    join(fixture, 'pous', 'programs', 'main.st'),
    'PROGRAM main\n  VAR\n    T1 : TON;\n    Count : INT;\n  END_VAR\n\n' +
      'T1(IN := NOT T1.Q, PT := T#1s);\nIF T1.Q THEN\n  Count := Count + 1;\nEND_IF;\n\nEND_PROGRAM\n',
  )
  writeProfile(paths, false)
}

/** A copy of the flashed project, pointed at the board's serial port. */
function writeEsp32Fixture(paths: Paths): void {
  const { fixture } = paths
  rmSync(join(fixture, '..'), { recursive: true, force: true })
  cpSync(ESP32_PROJECT, fixture, { recursive: true, filter: (src) => !src.startsWith(join(ESP32_PROJECT, 'build')) })
  const configPath = join(fixture, 'devices', 'configuration.json')
  const config: Record<string, unknown> = JSON.parse(readFileSync(configPath, 'utf-8'))
  // The runtime address must not leak into a board's offer.
  writeFileSync(
    configPath,
    JSON.stringify({
      ...config,
      ...(ESP32_BOARD ? { deviceBoard: ESP32_BOARD } : {}),
      communicationPort: ESP32_PORT,
      runtimeIpAddress: 'localhost',
    }),
  )
  writeProfile(paths, true)
}

async function launch({ userData }: Paths): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [join(__dirname, '..', 'release', 'app', 'dist', 'main', 'main.js'), `--user-data-dir=${userData}`],
    // NOT development: `resolveHtmlPath` would point the window at the webpack dev
    // server on localhost:1212, which is not running against a production build.
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

const close = (app: ElectronApplication) => app.process().kill('SIGKILL')

async function openProject(page: Page): Promise<void> {
  await page.getByText('debugger-offer', { exact: true }).first().click({ timeout: 30000 })
  await debuggerButton(page).waitFor({ timeout: 30000 })
}

const debuggerButton = (page: Page) => page.getByRole('button', { name: 'Debugger', exact: true })
const dialog = (page: Page, text: string) => page.getByRole('dialog').filter({ hasText: text })
// Readable only while the Console tab is shown; the debugger panel replaces it.
const consoleText = (page: Page) => page.locator('body').innerText()

async function logIn(page: Page): Promise<void> {
  const login = dialog(page, 'Login to OpenPLC Runtime')
  await login.getByPlaceholder('Enter username').fill('admin')
  await login.getByPlaceholder('Enter password').fill('admin')
  await login.getByRole('button', { name: 'Login' }).click()
}

/** The debugger panel is open; with `liveValue`, an ST editor also shows that polled value. */
const debuggerPanel = (page: Page) => page.getByText('Variables', { exact: true })

async function expectDebuggerLive(page: Page, liveValue?: RegExp): Promise<void> {
  await expect(debuggerPanel(page)).toBeVisible({ timeout: 180000 })
  if (!liveValue) return
  const inline = page.locator('.debug-inline-value:visible').filter({ hasText: liveValue })
  await expect(inline.first()).toBeVisible({ timeout: 30000 })
}

test.describe('Runtime v4 target', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(!RUNTIME_IP, 'set E2E_RUNTIME_IP to a Runtime v4 with user admin/admin')
  const paths = pathsFor('runtime')

  test('uploads the fixture program', async () => {
    test.setTimeout(300000)
    writeRuntimeFixture(paths, RUNTIME_IP)
    const { app, page } = await launch(paths)
    try {
      await openProject(page)
      await debuggerButton(page).click()
      await dialog(page, 'Not Connected').getByRole('button', { name: 'Yes' }).click()
      await logIn(page)
      // The debug start that follows the login stops at the MD5 check: a mismatch, or
      // the error an empty runtime answers with. Decline it and upload explicitly.
      const verdict = page.getByRole('dialog').filter({ hasText: /Program Mismatch|Connection Error/ })
      await expect
        .poll(async () => (await verdict.count()) > 0 || (await debuggerPanel(page).isVisible()), { timeout: 120000 })
        .toBe(true)
      // Already running this program: nothing to upload.
      if ((await verdict.count()) === 0) return
      await verdict.getByRole('button', { name: /^(No|OK)$/ }).click()
      await page.getByRole('button', { name: 'Build options' }).click()
      await page.getByText('Build and upload', { exact: true }).click()
      // A runtime already running a program has to stop it first.
      const stopPlc = page.getByRole('button', { name: 'Stop PLC and Continue' })
      await stopPlc.click({ timeout: 30000 }).catch(() => undefined)
      await expect.poll(() => consoleText(page), { timeout: 240000 }).toContain('Upload complete.')
    } finally {
      close(app)
    }
  })

  test('names the runtime, then one "Yes" and a login start the debugger', async () => {
    test.setTimeout(300000)
    const { app, page } = await launch(paths)
    try {
      await openProject(page)
      await debuggerButton(page).click()

      const offer = dialog(page, 'Not Connected')
      await expect(offer).toContainText(`connect to OpenPLC Runtime v4 at ${RUNTIME_IP} now?`)
      await offer.getByRole('button', { name: 'Yes' }).click()
      await logIn(page)

      // Count only moves off 0 on a running PLC, so a non-zero value proves live polling.
      // \s: Monaco renders the spaces as U+00A0.
      await expectDebuggerLive(page, /=\s[1-9]\d*/)
    } finally {
      close(app)
    }
  })

  test('says so when the runtime cannot be reached', async () => {
    test.setTimeout(120000)
    const unreachable = pathsFor('runtime-unreachable')
    // TEST-NET-1 (RFC 5737): never routed, so the request times out.
    writeRuntimeFixture(unreachable, '192.0.2.1')
    const { app, page } = await launch(unreachable)
    try {
      await openProject(page)
      await debuggerButton(page).click()
      await dialog(page, 'Not Connected').getByRole('button', { name: 'Yes' }).click()

      await expect(dialog(page, 'No Response')).toContainText('Could not reach OpenPLC Runtime v4 at 192.0.2.1', {
        timeout: 60000,
      })
      await dialog(page, 'No Response').getByRole('button', { name: 'OK' }).click()
      // The dialog was the explanation: no "cancelled" line, and no debug session.
      await expect(page.getByText('Debugger session cancelled.')).toHaveCount(0)
      await expect(debuggerPanel(page)).toHaveCount(0)
    } finally {
      close(app)
    }
  })
})

test.describe('ESP32 target', () => {
  test.skip(
    !ESP32_PROJECT || !ESP32_PORT || !existsSync(ESP32_PROJECT) || !existsSync(join(PROFILE, 'packages')),
    'set E2E_ESP32_PROJECT and E2E_ESP32_PORT, with the vendor packages installed in the local profile',
  )

  test('names the board and its port, then one "Yes" starts the debugger', async () => {
    test.setTimeout(300000)
    const paths = pathsFor('esp32')
    writeEsp32Fixture(paths)
    const { app, page } = await launch(paths)
    try {
      await openProject(page)
      await debuggerButton(page).click()

      const offer = dialog(page, 'Not Connected')
      await expect(offer).toContainText(`at ${ESP32_PORT}`)
      await expect(offer).not.toContainText('localhost')
      await offer.getByRole('button', { name: 'Yes' }).click()

      await expectDebuggerLive(page)
    } finally {
      close(app)
    }
  })
})
