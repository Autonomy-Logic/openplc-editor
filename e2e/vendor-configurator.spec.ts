/**
 * The embedded I/O Configurator on a vendor board: the fake Device Editor runs in the sandboxed
 * iframe served over `vpp-doc://`, a module added there lists its channels with IEC addresses on
 * the read-only I/O Mapping screen, even when that tab is opened before the change settles, an
 * alias set there survives a save and a relaunch, and nothing the guest tries reaches the host.
 *
 * The fixture package is unsigned, so each launch replaces the `packages:verify-signatures`
 * handler with one that removes nothing; the production check is unchanged. Its manifest carries
 * a catalogue for the fake's module types, so rows come from the manifest channel names.
 *
 * Needs a production build and the preload copy; see "Electron e2e" in CLAUDE.md.
 */
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ElectronApplication, FrameLocator, Page } from '@playwright/test'
import { _electron as electron, expect, test } from '@playwright/test'

import {
  bundleGuestScripts,
  CONFIGURATOR_SCREEN,
  FIXTURE_BOARD,
  installFixturePackage,
  MAPPING_SCREEN,
} from './fixtures/vendor-configurator/build-package'
import type { SandboxProbeResult } from './fixtures/vendor-configurator/guest-device-editor'

// Real path: Electron resolves userData through the macOS /var symlink, and package paths must sit under it.
const ROOT = join(realpathSync(tmpdir()), 'openplc-e2e-vendor-configurator')
const BUNDLE = join(ROOT, 'bundle')
const PROJECT_NAME = 'vendor-configurator'

type Paths = { fixture: string; userData: string }

function pathsFor(slug: string): Paths {
  return { fixture: join(ROOT, slug, 'project'), userData: join(ROOT, slug, 'userdata') }
}

function writeFixture({ fixture, userData }: Paths): void {
  rmSync(join(fixture, '..'), { recursive: true, force: true })
  mkdirSync(join(fixture, 'pous', 'programs'), { recursive: true })
  mkdirSync(join(fixture, 'devices'), { recursive: true })
  writeFileSync(
    join(fixture, 'project.json'),
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
    join(fixture, 'devices', 'configuration.json'),
    JSON.stringify({
      deviceBoard: FIXTURE_BOARD,
      communicationPort: '',
      runtimeIpAddress: '192.168.1.50',
      selectedPlatformOptions: {},
    }),
  )
  writeFileSync(join(fixture, 'devices', 'pin-mapping.json'), '{}')
  writeFileSync(
    join(fixture, 'pous', 'programs', 'main.st'),
    'PROGRAM main\n  VAR\n    a : BOOL;\n  END_VAR\n\na := a;\n\nEND_PROGRAM\n',
  )

  const history = join(userData, 'User', 'History')
  mkdirSync(history, { recursive: true })
  writeFileSync(
    join(history, 'projects.json'),
    JSON.stringify([
      {
        name: PROJECT_NAME,
        path: fixture,
        projectFilePath: join(fixture, 'project.json'),
        createdAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
      },
    ]),
  )
  writeFileSync(join(history, 'libraries.json'), '[]')

  // A fresh profile has no Arduino control files, and without them the board list never loads.
  const runtime = join(userData, 'User', 'Runtime')
  mkdirSync(runtime, { recursive: true })
  writeFileSync(join(runtime, 'arduino-core-control.json'), '[]')
  writeFileSync(join(runtime, 'arduino-library-control.json'), '[]')

  installFixturePackage(join(userData, 'packages'), BUNDLE)
}

async function launch({ userData }: Paths): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [join(__dirname, '..', 'release', 'app', 'dist', 'main', 'main.js'), `--user-data-dir=${userData}`],
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

/** A tree or tab label, with the `* ` an unsaved screen gets; hidden tabs also hold the names as section titles. */
const screenLabel = (page: Page, screen: string, unsaved?: boolean) => {
  const name = screen.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const prefix = unsaved === undefined ? '(\\* )?' : unsaved ? '\\* ' : ''
  return page
    .getByText(new RegExp(`^${prefix}${name}$`))
    .filter({ visible: true })
    .first()
}

const openScreen = (page: Page, screen: string) => screenLabel(page, screen).click({ timeout: 30000 })

/** Matched by its label, not its whole text; the close icon shows on hover and is the tab's last icon. */
async function closeTabWithoutSaving(page: Page, screen: string): Promise<void> {
  const label = page.getByText(new RegExp(`^(\\* )?${screen.replace(/[/]/g, '\\/')}$`))
  const tab = page.getByRole('tab').filter({ has: label })
  await tab.hover()
  await tab.locator('svg').last().click()
  await page.getByRole('button', { name: "Don't Save" }).click()
  await expect(tab).toHaveCount(0)
}

async function openConfigurator(page: Page): Promise<FrameLocator> {
  await page.getByText(PROJECT_NAME, { exact: true }).first().click({ timeout: 30000 })
  await openScreen(page, CONFIGURATOR_SCREEN)
  const iframe = page.locator('iframe[title="I/O Configurator"]')
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-forms')
  await expect(iframe).toHaveAttribute('src', /^vpp-doc:\/\/com\.e2e\.fake-configurator\/configurator\/index\.html$/)
  const frame = page.frameLocator('iframe[title="I/O Configurator"]')
  await expect(frame.getByRole('button', { name: 'Add FAKE-4DI' })).toBeVisible({ timeout: 30000 })
  await expect(page.getByText('Loading the I/O Configurator…')).toHaveCount(0, { timeout: 30000 })
  return frame
}

const SANDBOX_PROBES = [
  'parent-document',
  'top-location',
  'local-storage',
  'parent-bridge',
  'own-bridge',
  'popup',
  'remote-fetch',
]

/** Records and cancels every request to the probe host, from any frame; nothing may reach it. */
async function recordProbeHostRequests(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ session }) => {
    const seen: string[] = []
    Reflect.set(globalThis, '__probeHostRequests', seen)
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['*://example.com/*'] }, (details, callback) => {
      seen.push(`${details.resourceType} ${details.url}`)
      callback({ cancel: true })
    })
  })
  // Control: a request the recorder must see, so an empty list later means nothing was sent.
  await app.evaluate(({ session }) =>
    session.defaultSession.fetch('https://example.com/recorder-control').catch(() => null),
  )
  expect(await probeHostRequests(app), 'control: the recorder sees requests').toEqual([
    expect.stringContaining('https://example.com/recorder-control'),
  ])
  await app.evaluate(() => {
    const seen: unknown = Reflect.get(globalThis, '__probeHostRequests')
    if (Array.isArray(seen)) seen.length = 0
  })
}

const probeHostRequests = (app: ElectronApplication): Promise<unknown> =>
  app.evaluate(() => Reflect.get(globalThis, '__probeHostRequests'))

const readConfiguration = (paths: Paths): string =>
  readFileSync(join(paths.fixture, 'devices', 'configuration.json'), 'utf-8')

// The tests share one bundle directory, which `beforeAll` rebuilds.
test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  test.setTimeout(120000)
  rmSync(BUNDLE, { recursive: true, force: true })
  await bundleGuestScripts(BUNDLE)
})

test('a module added in the configurator is mapped, and its alias survives a relaunch', async () => {
  test.setTimeout(240000)
  const paths = pathsFor('configure')
  writeFixture(paths)

  {
    const { app, page } = await launch(paths)
    try {
      const frame = await openConfigurator(page)
      const iframe = page.locator('iframe[title="I/O Configurator"]')
      await iframe.evaluate((element) => Reflect.set(element, '__e2eFrame', 'first'))
      await frame.getByRole('button', { name: 'Add FAKE-4DI' }).click()
      // Leaves the configurator before its change settles; the hidden tab must still deliver it.
      await openScreen(page, MAPPING_SCREEN)

      const slot = page.getByRole('region', { name: 'Slot 1 FAKE-4DI_1' })
      await expect(slot).toBeVisible({ timeout: 15000 })
      for (const screen of [CONFIGURATOR_SCREEN, MAPPING_SCREEN]) {
        await expect(screenLabel(page, screen, true), `${screen} is unsaved too`).toBeVisible()
      }
      for (const bit of [0, 1, 2, 3]) {
        await expect(slot.getByRole('row', { name: new RegExp(`DI\\.${bit}\\b.*%IX\\d+\\.\\d`) })).toBeVisible()
      }
      await expect(slot.getByRole('row', { name: /status.*%IB\d+/ })).toBeVisible()

      const alias = page.getByLabel('Alias of DI.0 in slot 1')
      await alias.fill('pump_run')
      await alias.press('Tab')
      await expect(alias).toHaveValue('pump_run')

      await openScreen(page, CONFIGURATOR_SCREEN)
      await expect(iframe, 'the configurator was not booted again').toBeVisible()
      expect(await iframe.evaluate((element) => Reflect.get(element, '__e2eFrame'))).toBe('first')
      await expect(frame.getByTestId('fake-modules')).toContainText('FAKE-4DI_1 (FAKE-4DI)')

      await save(app)
      await expect.poll(() => readConfiguration(paths), { timeout: 15000 }).toContain('pump_run')
      for (const screen of [CONFIGURATOR_SCREEN, MAPPING_SCREEN]) {
        await expect(screenLabel(page, screen, true), `${screen} is saved too`).toHaveCount(0)
      }

      // A change discarded from the I/O Mapping tab must leave the configurator too.
      await frame.getByRole('button', { name: 'Add FAKE-4DI' }).click()
      await openScreen(page, MAPPING_SCREEN)
      await expect(page.getByRole('region', { name: 'Slot 2 FAKE-4DI_2' })).toBeVisible({ timeout: 15000 })
      await closeTabWithoutSaving(page, MAPPING_SCREEN)
      await openScreen(page, CONFIGURATOR_SCREEN)
      await expect(frame.getByTestId('fake-modules')).toContainText('FAKE-4DI_1 (FAKE-4DI)', { timeout: 30000 })
      await expect(frame.getByTestId('fake-modules')).not.toContainText('FAKE-4DI_2')
      expect(await iframe.evaluate((element) => Reflect.get(element, '__e2eFrame')), 'a fresh guest').toBeUndefined()
      await expect(screenLabel(page, CONFIGURATOR_SCREEN, true)).toHaveCount(0)
    } finally {
      await shutdown(app)
    }
  }

  const stored: unknown = JSON.parse(readConfiguration(paths))
  expect(stored).toMatchObject({
    vendorScreenData: {
      configurator: { bundleVersion: '3.5.22', controller: 'UC20-M3000' },
      'device-setup': { modules: [{ guid: 'fake-0001', instanceName: 'FAKE-4DI_1', typeId: 'FAKE-4DI', slot: 1 }] },
      'module-configuration': { slots: ['fake-4di'] },
      'io-mapping': {
        entries: expect.arrayContaining([
          expect.objectContaining({
            slot: 1,
            channelName: 'DI.0',
            iecAddress: expect.stringMatching(/^%IX\d+\.\d$/),
            alias: 'pump_run',
          }),
          expect.objectContaining({ slot: 1, channelName: 'status', iecAddress: expect.stringMatching(/^%IB\d+$/) }),
        ]),
      },
    },
  })
  const entries = (stored as { vendorScreenData: { 'io-mapping': { entries: Array<Record<string, unknown>> } } })
    .vendorScreenData['io-mapping'].entries
  expect(entries).toHaveLength(5)
  for (const entry of entries) expect(entry).not.toHaveProperty('datapointId')

  {
    const { app, page } = await launch(paths)
    try {
      const frame = await openConfigurator(page)
      await expect(frame.getByTestId('fake-modules')).toContainText('FAKE-4DI_1 (FAKE-4DI)')
      await openScreen(page, MAPPING_SCREEN)
      await expect(page.getByLabel('Alias of DI.0 in slot 1')).toHaveValue('pump_run', { timeout: 15000 })
      // The configurator's load-failure message; Monaco's empty live regions are role=alert too.
      await expect(page.locator('p[role="alert"]')).toHaveCount(0)
    } finally {
      await shutdown(app)
    }
  }
})

test('the sandboxed guest reaches nothing of the host', async () => {
  test.setTimeout(120000)
  const paths = pathsFor('sandbox')
  writeFixture(paths)

  const { app, page } = await launch(paths)
  try {
    await recordProbeHostRequests(app)
    const frame = await openConfigurator(page)
    const html = frame.locator('html')
    await expect(html).toHaveAttribute('data-sandbox-probes', /.+/, { timeout: 15000 })
    const raw = await html.getAttribute('data-sandbox-probes')
    const probes: SandboxProbeResult[] = JSON.parse(raw ?? '[]')

    const byName = new Map(probes.map((p) => [p.name, p]))
    expect(byName.get('own-scope'), 'control: the probes ran in the guest').toMatchObject({
      blocked: false,
      detail: 'object',
    })
    for (const name of SANDBOX_PROBES) {
      expect(byName.get(name), `${name} must be blocked: ${byName.get(name)?.detail ?? 'not run'}`).toMatchObject({
        blocked: true,
      })
    }
    await expect(html, 'the guest cannot navigate its frame away').toHaveAttribute('data-navigation-probe', 'stayed', {
      timeout: 15000,
    })
    expect(await probeHostRequests(app), 'no form, child frame or navigation reached the probe host').toEqual([])
    await expect(page.locator('iframe[title="I/O Configurator"]')).toHaveAttribute('src', /^vpp-doc:/)
    expect(app.windows().filter((w) => w.url() === 'about:blank')).toHaveLength(0)
  } finally {
    await shutdown(app)
  }
})
