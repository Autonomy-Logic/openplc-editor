/**
 * A project pinned to an older version of its board's vendor package: opening the board screen
 * shows no pin-drift banner, and a save records the installed package as the new pin.
 *
 * Uses the vendor-configurator fixture package with a placeholder `signature.json`: the pin is read
 * from it, and each launch replaces the `packages:verify-signatures` handler with one that removes
 * nothing, so the placeholder is never checked.
 *
 * Needs a production build and the preload copy; see "Electron e2e" in CLAUDE.md.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron, expect, test } from '@playwright/test'

import {
  bundleGuestScripts,
  FIXTURE_BOARD,
  FIXTURE_PACKAGE_ID,
  installFixturePackage,
} from './fixtures/vendor-configurator/build-package'
import { contentHashOfPayload, type SignaturePayload } from '../src/backend/shared/utils/vpp/package-verification-core'

// Real path: Electron resolves userData through the macOS /var symlink, and package paths must sit under it.
const ROOT = join(realpathSync(tmpdir()), 'openplc-e2e-vpp-pin-drift')
const BUNDLE = join(ROOT, 'bundle')
const FIXTURE = join(ROOT, 'project')
const USER_DATA = join(ROOT, 'userdata')
const PROJECT_NAME = 'vpp-pin-drift'

const OLD_PIN = { packageId: FIXTURE_PACKAGE_ID, version: '0.9.0', contentHash: 'sha256:old' }

const SIGNATURE_PAYLOAD: SignaturePayload = {
  formatVersion: '1.0',
  alg: 'ed25519',
  keyId: 'e2e',
  packageId: FIXTURE_PACKAGE_ID,
  version: '1.0.0',
  signedAt: '2026-01-01T00:00:00Z',
  files: {},
}

const INSTALLED_HASH = contentHashOfPayload(SIGNATURE_PAYLOAD, (bytes) =>
  createHash('sha256').update(bytes).digest('hex'),
)

type DeviceConfiguration = {
  vppPackagePinsByBoard?: Record<string, { packageId: string; version: string; contentHash: string }>
}

function writeFixture(): void {
  rmSync(FIXTURE, { recursive: true, force: true })
  rmSync(USER_DATA, { recursive: true, force: true })
  mkdirSync(join(FIXTURE, 'pous', 'programs'), { recursive: true })
  mkdirSync(join(FIXTURE, 'devices'), { recursive: true })
  writeFileSync(
    join(FIXTURE, 'project.json'),
    JSON.stringify({
      meta: { name: PROJECT_NAME, type: 'plc-project' },
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
      deviceBoard: FIXTURE_BOARD,
      communicationPort: '',
      runtimeIpAddress: '192.168.1.50',
      selectedPlatformOptions: {},
      vppPackagePinsByBoard: { [FIXTURE_BOARD]: OLD_PIN },
    }),
  )
  writeFileSync(join(FIXTURE, 'devices', 'pin-mapping.json'), '{}')
  writeFileSync(
    join(FIXTURE, 'pous', 'programs', 'main.st'),
    'PROGRAM main\n  VAR\n    a : BOOL;\n  END_VAR\n\na := a;\n\nEND_PROGRAM\n',
  )

  const history = join(USER_DATA, 'User', 'History')
  mkdirSync(history, { recursive: true })
  writeFileSync(
    join(history, 'projects.json'),
    JSON.stringify([
      {
        name: PROJECT_NAME,
        path: FIXTURE,
        projectFilePath: join(FIXTURE, 'project.json'),
        createdAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
      },
    ]),
  )
  writeFileSync(join(history, 'libraries.json'), '[]')

  // A fresh profile has no Arduino control files, and without them the board list never loads.
  const runtime = join(USER_DATA, 'User', 'Runtime')
  mkdirSync(runtime, { recursive: true })
  writeFileSync(join(runtime, 'arduino-core-control.json'), '[]')
  writeFileSync(join(runtime, 'arduino-library-control.json'), '[]')

  const packageRoot = installFixturePackage(join(USER_DATA, 'packages'), BUNDLE)
  writeFileSync(join(packageRoot, 'signature.json'), JSON.stringify({ ...SIGNATURE_PAYLOAD, signature: 'e2e' }))
}

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [join(__dirname, '..', 'release', 'app', 'dist', 'main', 'main.js'), `--user-data-dir=${USER_DATA}`],
    // NOT development: `resolveHtmlPath` would point the window at the webpack dev server.
    env: { ...process.env, NODE_ENV: 'production' },
  })
  // The app opens a splash window first; pick the real one by URL.
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      try {
        if (w.url().includes('index.html')) {
          await w.waitForLoadState('domcontentloaded')
          // The project history comes over IPC, so once it shows, the bridge has registered its handlers.
          await w.getByText(PROJECT_NAME, { exact: true }).first().waitFor({ timeout: 30000 })
          await app.evaluate(({ ipcMain }) => {
            ipcMain.removeHandler('packages:verify-signatures')
            ipcMain.handle('packages:verify-signatures', () => [])
          })
          return { app, page: w }
        }
      } catch {
        /* window is closing; skip it */
      }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  await shutdown(app)
  throw new Error('main window never appeared')
}

/** Ctrl+S is a native menu accelerator, which Playwright's keyboard never reaches. */
const save = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'))
    win?.webContents.send('project:save-accelerator')
  })

/** The quit confirmation holds every quit, so `app.close()` would hang; the save is on disk by now. */
async function shutdown(app: ElectronApplication): Promise<void> {
  const proc = app.process()
  if (proc.exitCode !== null) return
  const exited = new Promise((resolve) => proc.once('exit', resolve))
  proc.kill('SIGKILL')
  await exited
}

/** Undefined while a save is still writing the file. */
const recordedPin = () => {
  try {
    const config = JSON.parse(
      readFileSync(join(FIXTURE, 'devices', 'configuration.json'), 'utf-8'),
    ) as DeviceConfiguration
    return config.vppPackagePinsByBoard?.[FIXTURE_BOARD]
  } catch {
    return undefined
  }
}

test.beforeAll(async () => {
  test.setTimeout(120000)
  rmSync(BUNDLE, { recursive: true, force: true })
  await bundleGuestScripts(BUNDLE)
})

test('a board pinned to an older package version re-pins on open, with no drift banner', async () => {
  test.setTimeout(180000)
  writeFixture()

  const { app, page } = await launch()
  try {
    await page.getByText(PROJECT_NAME, { exact: true }).first().click({ timeout: 30000 })
    await page.getByText('Configuration', { exact: true }).first().click({ timeout: 30000 })
    await expect(page.getByRole('combobox', { name: 'Device selection' })).toContainText(FIXTURE_BOARD, {
      timeout: 30000,
    })

    // The re-pin marks the device configuration unsaved; saving writes the installed package.
    await expect
      .poll(
        async () => {
          await save(app)
          return recordedPin()?.version
        },
        { timeout: 30000, intervals: [1000] },
      )
      .toBe('1.0.0')

    const pin = recordedPin()
    expect(pin?.packageId).toBe(FIXTURE_PACKAGE_ID)
    expect(pin?.contentHash).toBe(INSTALLED_HASH)
    await expect(page.getByTestId('vpp-pin-drift')).toHaveCount(0)
  } finally {
    await shutdown(app)
  }
})
