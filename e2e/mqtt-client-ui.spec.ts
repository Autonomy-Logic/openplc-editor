// Needs the production build and the preload copied where a non-packaged app looks for it.
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron, expect, test } from '@playwright/test'

const ROOT = join(tmpdir(), 'openplc-e2e-mqtt-client')
const FIXTURE = join(ROOT, 'project')
const USER_DATA = join(ROOT, 'userdata')
const PASSWORD_MARKER = 'MARKER-PW-e3-desktop-a83c'
const USERNAME_MARKER = 'MARKER-USER-e3-desktop-61fd'
const VAULT_FILE = join(USER_DATA, 'mqtt-credentials', 'credentials.json')
const PROTECTED_HINT = 'Stored encrypted on this computer, outside the project.'
const SESSION_HINT = 'Kept only in memory for this session. Enter it again after closing the editor.'

const MAIN_ST = `PROGRAM Main
  VAR
    Counter : DINT;
    Total : LINT;
    Tank : TankT;
    Levels : ARRAY [-2..1] OF INT;
    Mode : ModeE;
  END_VAR

Counter := Counter + 1;

END_PROGRAM
`

function writeFixture(): void {
  rmSync(ROOT, { recursive: true, force: true })
  mkdirSync(join(FIXTURE, 'devices', 'servers'), { recursive: true })
  mkdirSync(join(FIXTURE, 'pous', 'programs'), { recursive: true })
  writeFileSync(
    join(FIXTURE, 'project.json'),
    JSON.stringify({
      meta: { name: 'mqtt-ui', type: 'plc-project' },
      data: {
        dataTypes: [
          {
            name: 'TankT',
            derivation: 'structure',
            variable: [
              { name: 'Level', type: { definition: 'base-type', value: 'REAL' } },
              { name: 'Stamp', type: { definition: 'base-type', value: 'DT' } },
            ],
          },
          { name: 'ModeE', derivation: 'enumerated', values: [{ description: 'AUTO' }] },
        ],
        pous: [],
        configuration: {
          resource: {
            tasks: [{ name: 'task0', triggering: 'Cyclic', interval: 'T#10ms', priority: 1 }],
            instances: [{ name: 'Line1', program: 'Main', task: 'task0' }],
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
      runtimeIpAddress: '192.168.1.50',
      selectedPlatformOptions: {},
    }),
  )
  writeFileSync(join(FIXTURE, 'devices', 'pin-mapping.json'), '{}')
  writeFileSync(
    join(FIXTURE, 'devices', 'servers', 'Existing.json'),
    JSON.stringify({
      name: 'Existing',
      protocol: 'mqtt',
      mqttConfig: {
        formatVersion: 1,
        enabled: true,
        mode: 'generic',
        connection: {
          host: 'broker.plant.local',
          port: 8883,
          clientId: 'existing',
          tls: { enabled: true, trust: { source: 'system' } },
        },
        authMethod: 'anonymous',
        generic: { publishMode: 'on_change', sampleIntervalMs: 100, publishIntervalMs: 1000, qos: 0, retain: false },
        sparkplug: { groupId: 'openplc', edgeNodeId: 'existing', sampleIntervalMs: 100 },
        selections: [
          {
            source: {
              tokens: [
                { role: 'instance', name: 'Line1' },
                { role: 'program', name: 'Main' },
                { role: 'variable', name: 'Renamed' },
              ],
            },
          },
        ],
      },
    }),
  )
  writeFileSync(join(FIXTURE, 'pous', 'programs', 'Main.st'), MAIN_ST)

  const history = join(USER_DATA, 'User', 'History')
  mkdirSync(history, { recursive: true })
  writeFileSync(
    join(history, 'projects.json'),
    JSON.stringify([
      {
        name: 'mqtt-ui',
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

/** Ctrl+S is a native menu accelerator, which Playwright's keyboard never reaches. */
const save = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'))
    win?.webContents.send('project:save-accelerator')
  })

/** Unsaved changes hold the window open on close; a failed run must not hang the worker on that prompt. */
const shutdown = async (app: ElectronApplication) => {
  const closed = app.close().then(() => true)
  const timedOut = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 10000))
  if (!(await Promise.race([closed, timedOut]))) app.process().kill('SIGKILL')
}

const editor = (page: Page) => page.getByLabel('MQTT client editor')
const openTab = (page: Page, name: string) =>
  editor(page)
    .getByRole('tab', { name: new RegExp(`^${name}`) })
    .click()
const expand = (page: Page, path: string) => page.getByRole('button', { name: `Expand ${path}`, exact: true }).click()

const commit = async (page: Page, label: string, value: string) => {
  const field = editor(page).getByLabel(label, { exact: true })
  await field.fill(value)
  await field.press('Enter')
}

const openServerFromTree = async (page: Page, name: string) => {
  const entry = page
    .locator('li')
    .filter({ hasText: new RegExp(`^\\*?\\s*${name}$`) })
    .first()
  if (!(await entry.isVisible())) await page.getByText('Servers', { exact: true }).first().click()
  await entry.click()
  await expect(page.getByRole('heading', { name: `MQTT client: ${name}` })).toBeVisible()
}

const vaultEntries = (): Array<{ scope: { serverName: string }; binding: { host: string }; method: string }> => {
  const document: { entries: Array<{ scope: { serverName: string }; binding: { host: string }; method: string }> } =
    JSON.parse(readFileSync(VAULT_FILE, 'utf-8'))
  return document.entries
}

const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    const stat = lstatSync(full)
    if (stat.isSymbolicLink()) return []
    return stat.isDirectory() ? filesUnder(full) : [full]
  })

test.describe.configure({ mode: 'serial' })

test('creates, edits, saves and reopens an MQTT client, keeping its credential out of the project', async () => {
  test.setTimeout(180000)
  writeFixture()
  let protectedStore = false

  const first = await launch()
  const { page } = first
  try {
    await page.getByText('mqtt-ui', { exact: true }).first().click({ timeout: 30000 })
    await expect(page.getByText('Main', { exact: true }).first()).toBeVisible({ timeout: 30000 })

    await page.locator('#create-plc-element-trigger').click()
    await page.locator('#create-server-trigger').hover()
    const card = page.locator('#create-server-content')
    await card.locator('#server-name').fill('Telemetry')
    await card.getByLabel('server-protocol').click()
    await page.getByRole('option', { name: 'MQTT client' }).click()
    await expect(card.locator('#server-protocol-description')).toContainText('external MQTT broker')
    await card.getByRole('button', { name: 'Create' }).click()
    await expect(page.getByRole('heading', { name: 'MQTT client: Telemetry' })).toBeVisible()
    await expect(editor(page).getByLabel('Broker port', { exact: true })).toHaveValue('8883')

    await commit(page, 'Broker host', 'broker.plant.local')
    await expect(editor(page).getByLabel('Connection issues')).toHaveCount(0)

    await editor(page).locator('label[for="mqtt-enabled"]').click()
    await expect(editor(page).getByRole('alert')).toContainText('"Existing" is already enabled')
    await expect(editor(page).getByRole('checkbox', { name: 'Enable MQTT integration' })).not.toBeChecked()

    await openTab(page, 'Variables')
    await expand(page, 'Line1.Main')
    await page.getByRole('checkbox', { name: 'Select Line1.Main.Counter' }).check()
    await page.getByRole('checkbox', { name: 'Select Line1.Main.Total' }).check()
    await expand(page, 'Line1.Main.Tank')
    await page.getByRole('checkbox', { name: 'Select Line1.Main.Tank.Stamp' }).check()
    await expand(page, 'Line1.Main.Levels')
    await page.getByRole('checkbox', { name: 'Select Line1.Main.Levels[-2]' }).check()
    await expect(page.getByTestId('mqtt-selected-count')).toHaveText('4')
    const rows = page.getByTestId('mqtt-selection-row')
    await expect(rows.nth(1)).toContainText('Decimal string')
    await expect(rows.nth(3).locator('td').first()).toHaveText('Line1.Main.Levels[-2]')
    const modeRow = page.locator('li[data-node-kind="unsupported"]').filter({ hasText: 'Mode' })
    await expect(modeRow).toContainText('Enumerations cannot be published.')

    await openTab(page, 'Publication')
    await editor(page).getByLabel('Mode', { exact: true }).selectOption('sparkplug_b')
    await expect(editor(page).getByLabel('QoS', { exact: true })).toHaveCount(0)
    await commit(page, 'Group ID', 'plant')

    await openTab(page, 'Security')
    await editor(page).getByLabel('Authentication', { exact: true }).selectOption('username_password')
    await expect(page.getByTestId('mqtt-credential-state')).toHaveAttribute('data-state', 'missing')
    await page.getByRole('button', { name: 'Enter credential' }).click()
    await editor(page).getByLabel('Username', { exact: true }).fill(USERNAME_MARKER)
    await editor(page).getByLabel('Password', { exact: true }).fill(PASSWORD_MARKER)
    await page.getByRole('button', { name: 'Save credential' }).click()
    await expect(page.getByTestId('mqtt-credential-state')).toHaveAttribute('data-state', 'local')
    await expect(editor(page).getByLabel('Password', { exact: true })).toHaveCount(0)
    expect(await page.content()).not.toContain(PASSWORD_MARKER)
    const hint = editor(page).getByText(new RegExp(`^(${PROTECTED_HINT}|${SESSION_HINT})$`))
    await expect(hint).toBeVisible()
    protectedStore = (await hint.textContent()) === PROTECTED_HINT
    // Keychain and DPAPI always back safeStorage; only Linux may lack a keyring and fall back to memory.
    if (process.platform !== 'linux') expect(protectedStore).toBe(true)

    await openTab(page, 'Status')
    // The desktop reads the runtime state; without a runtime session it is offline, not unsupported.
    await expect(page.getByTestId('mqtt-runtime-view')).toHaveAttribute('data-kind', 'offline')

    await save(first.app)
    await expect
      .poll(() => {
        try {
          return JSON.parse(readFileSync(join(FIXTURE, 'devices', 'servers', 'Telemetry.json'), 'utf-8')).mqttConfig
            ?.mode
        } catch {
          return null
        }
      })
      .toBe('sparkplug_b')
  } finally {
    await shutdown(first.app)
  }

  const telemetry = JSON.parse(readFileSync(join(FIXTURE, 'devices', 'servers', 'Telemetry.json'), 'utf-8'))
  expect(telemetry.mqttConfig).toMatchObject({
    enabled: false,
    authMethod: 'username_password',
    connection: { host: 'broker.plant.local', port: 8883, clientId: 'Telemetry' },
    sparkplug: { groupId: 'plant', edgeNodeId: 'Telemetry' },
  })
  expect(telemetry.mqttConfig.selections).toHaveLength(4)
  const scanForMarkers = () => {
    for (const file of [...filesUnder(FIXTURE), ...filesUnder(USER_DATA)]) {
      const content = readFileSync(file)
      for (const marker of [PASSWORD_MARKER, USERNAME_MARKER]) {
        expect(content.includes(marker), file).toBe(false)
        expect(content.includes(Buffer.from(marker).toString('base64')), file).toBe(false)
      }
    }
  }
  scanForMarkers()
  expect(filesUnder(FIXTURE).some((file) => file.includes('mqtt-credentials'))).toBe(false)
  if (protectedStore) {
    expect(vaultEntries()).toEqual([
      expect.objectContaining({
        scope: expect.objectContaining({ serverName: 'Telemetry' }),
        binding: expect.objectContaining({ host: 'broker.plant.local' }),
        method: 'username_password',
      }),
    ])
  }

  const second = await launch()
  try {
    const page2 = second.page
    await page2.getByText('mqtt-ui', { exact: true }).first().click({ timeout: 30000 })
    await expect(page2.getByText('Main', { exact: true }).first()).toBeVisible({ timeout: 30000 })
    await openServerFromTree(page2, 'Telemetry')
    await expect(editor(page2).getByLabel('Broker host', { exact: true })).toHaveValue('broker.plant.local')
    await openTab(page2, 'Variables')
    await expect(page2.getByTestId('mqtt-selected-count')).toHaveText('4')
    await expect(page2.getByTestId('mqtt-birth-size')).toBeVisible()
    await openTab(page2, 'Security')
    if (protectedStore) {
      await expect(page2.getByTestId('mqtt-credential-state')).toHaveAttribute('data-state', 'local')
      expect(await page2.content()).not.toContain(PASSWORD_MARKER)
      await page2.getByRole('button', { name: 'Remove credential' }).click()
    }
    await expect(page2.getByTestId('mqtt-credential-state')).toHaveAttribute('data-state', 'missing')

    await openServerFromTree(page2, 'Existing')
    await openTab(page2, 'Variables')
    const broken = page2.getByTestId('mqtt-selection-row')
    await expect(broken).toHaveAttribute('data-invalid', 'true')
    await expect(broken).toContainText('The variable or field no longer exists.')
  } finally {
    await shutdown(second.app)
  }
  if (protectedStore) expect(vaultEntries()).toEqual([])
  scanForMarkers()
})
