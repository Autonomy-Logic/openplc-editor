/**
 * Import and export of a Modbus remote device's IO groups (Remote Devices > IO Tag Mapping).
 *
 * Exports to CSV and JSON, rejects bad files without touching the device, appends and replaces
 * groups through the preview, gives imported groups their IEC addresses, keeps the form's name
 * limit, and builds the project with the imported groups in the Modbus master configuration.
 *
 * Needs a production build plus the preload copy; see "Electron e2e" in CLAUDE.md.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron, expect, test } from '@playwright/test'

import { buildFromMenu, findFile, quitApp } from './helpers/ethercat-project'

const ROOT = join(tmpdir(), 'openplc-e2e-modbus-io-group-transfer')
const FIXTURE = join(ROOT, 'project')
const USER_DATA = join(ROOT, 'userdata')
const DOWNLOADS = join(ROOT, 'downloads')
const REMOTE_FILE = join(FIXTURE, 'devices', 'remote', 'REMOTE.json')
const PROJECT_NAME = 'modbus-io-group-transfer'
const LONG_NAME = `Long_${'x'.repeat(59)}`

type StoredPoint = { id: string; iecLocation: string }
type MasterDevice = {
  name: string
  config: {
    io_points: Array<{
      fc: number
      offset: string
      iec_location: string
      len: number
      cycle_time_ms: number
      error_handling: string
    }>
  }
}
type StoredGroup = {
  id: string
  name: string
  functionCode: string
  cycleTime: number
  offset: string
  length: number
  errorHandling: string
  ioPoints: StoredPoint[]
}

function writeFixture(): void {
  rmSync(ROOT, { recursive: true, force: true })
  mkdirSync(join(FIXTURE, 'pous', 'programs'), { recursive: true })
  mkdirSync(join(FIXTURE, 'devices', 'remote'), { recursive: true })
  mkdirSync(DOWNLOADS, { recursive: true })
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
      deviceBoard: 'OpenPLC Runtime v4',
      communicationPort: '',
      runtimeIpAddress: '192.168.1.50',
      selectedPlatformOptions: {},
    }),
  )
  writeFileSync(join(FIXTURE, 'devices', 'pin-mapping.json'), '{}')
  writeFileSync(
    join(FIXTURE, 'pous', 'programs', 'main.st'),
    'PROGRAM main\n  VAR\n    a : BOOL;\n  END_VAR\n\na := a;\n\nEND_PROGRAM\n',
  )
  writeFileSync(
    REMOTE_FILE,
    JSON.stringify({
      name: 'REMOTE',
      protocol: 'modbus-tcp',
      modbusTcpConfig: {
        transport: 'tcp',
        host: '192.168.1.60',
        port: 502,
        slaveId: 1,
        timeout: 1000,
        ioGroups: [
          {
            id: 'existing',
            name: 'EXISTING',
            functionCode: '3',
            cycleTime: 100,
            offset: '0',
            length: 2,
            errorHandling: 'keep-last-value',
            ioPoints: [
              { id: 'EXISTING_0', name: 'EXISTING_0', type: 'register', iecLocation: '%IW0', alias: '' },
              { id: 'EXISTING_1', name: 'EXISTING_1', type: 'register', iecLocation: '%IW1', alias: '' },
            ],
          },
        ],
      },
    }),
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
}

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [join(__dirname, '..', 'release', 'app', 'dist', 'main', 'main.js'), `--user-data-dir=${USER_DATA}`],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  // The app opens a splash window first; pick the real one by URL.
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      try {
        if (w.url().includes('index.html')) {
          await w.waitForLoadState('domcontentloaded')
          // Below ~1024px wide the app shows its "not supported on mobile" screen.
          await app.evaluate(({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().includes('index.html'))
            win?.setSize(1500, 950)
          })
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

const storedGroups = (): StoredGroup[] => {
  const parsed: { modbusTcpConfig: { ioGroups: StoredGroup[] } } = JSON.parse(readFileSync(REMOTE_FILE, 'utf-8'))
  return parsed.modbusTcpConfig.ioGroups
}
const storedNames = () => storedGroups().map((g) => g.name)

/** Saves and waits until the device file on disk holds exactly @p names. */
async function saveAndExpectNames(app: ElectronApplication, names: string[]) {
  await save(app)
  await expect.poll(storedNames, { timeout: 15000 }).toEqual(names)
}

const downloaded = (name: string) => join(DOWNLOADS, name)

async function exportAs(page: Page, format: 'csv' | 'json'): Promise<string> {
  const path = downloaded(`REMOTE-io-groups.${format}`)
  rmSync(path, { force: true })
  await page.getByTestId('io-group-export-button').click()
  await page.getByTestId(`io-group-export-${format}`).click()
  await expect.poll(() => existsSync(path) && readFileSync(path, 'utf-8').length > 0, { timeout: 15000 }).toBe(true)
  return readFileSync(path, 'utf-8')
}

async function chooseFile(page: Page, name: string, content: string | Buffer) {
  const buffer = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content
  await page.getByTestId('io-group-import-input').setInputFiles({ name, mimeType: 'text/plain', buffer })
}

const modal = (page: Page) => page.getByTestId('io-group-import-modal')
const confirm = (page: Page) => page.getByTestId('io-group-import-confirm')

async function cancelPreview(page: Page) {
  await modal(page).getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(modal(page)).toHaveCount(0)
}

let app: ElectronApplication
let page: Page

test.describe.configure({ mode: 'serial', timeout: 120000 })

test.beforeAll(async () => {
  test.setTimeout(180000)
  writeFixture()
  ;({ app, page } = await launch())
  // Exports go through a browser download; save them without the native dialog.
  await app.evaluate(({ session }, dir) => {
    session.defaultSession.on('will-download', (_event, item) => item.setSavePath(`${dir}/${item.getFilename()}`))
  }, DOWNLOADS)
  await page.getByText(PROJECT_NAME, { exact: true }).first().click({ timeout: 60000 })
  await page.getByText('REMOTE', { exact: true }).first().click({ timeout: 30000 })
  await expect(page.getByTestId('io-group-name-existing')).toBeVisible({ timeout: 30000 })
})

test.afterAll(async () => {
  if (app) await quitApp(app, page)
})

test('exports the device groups as CSV and as JSON', async () => {
  const csv = await exportAs(page, 'csv')
  expect(csv.replace(/^﻿/, '').split('\r\n')).toEqual([
    'name,functionCode,cycleTime,offset,length,errorHandling',
    'EXISTING,3,100,0,2,keep-last-value',
    '',
  ])

  const json: { format: string; version: number; ioGroups: Array<Record<string, unknown>> } = JSON.parse(
    await exportAs(page, 'json'),
  )
  expect(json.format).toBe('openplc-modbus-io-groups')
  expect(json.version).toBe(1)
  expect(json.ioGroups).toEqual([
    { name: 'EXISTING', functionCode: 3, cycleTime: 100, offset: 0, length: 2, errorHandling: 'keep-last-value' },
  ])
})

test('refuses a file over 2 MB before opening it', async () => {
  await chooseFile(page, 'huge.csv', Buffer.alloc(2 * 1024 * 1024 + 1, 'a'))
  await expect(page.getByText('File too large', { exact: true })).toBeVisible()
  await expect(modal(page)).toHaveCount(0)
})

test('rejects JSON without the format id', async () => {
  await chooseFile(page, 'bare.json', JSON.stringify([{ name: 'A', functionCode: 3 }]))
  await expect(page.getByTestId('io-group-import-errors')).toContainText('Not an IO group export.')
  await expect(confirm(page)).toBeDisabled()
  await cancelPreview(page)
})

test('a file with one invalid row imports nothing and names the row', async () => {
  await chooseFile(page, 'bad.csv', 'name,functionCode,length\nOK_GROUP,3,2\nBAD_GROUP,7,2\n')
  const errors = page.getByTestId('io-group-import-errors')
  await expect(errors).toContainText('Row 3 · functionCode: Unsupported function code "7".')
  await expect(confirm(page)).toBeDisabled()
  await cancelPreview(page)
  await saveAndExpectNames(app, ['EXISTING'])
})

test('an append conflict names its row, and Replace clears it', async () => {
  await chooseFile(page, 'conflict.csv', 'name,functionCode\nNEW_ONE,3\nexisting,3\n')
  await expect(page.getByTestId('io-group-import-errors')).toContainText(
    'Row 3 · name: "existing" already exists on this device.',
  )
  await expect(confirm(page)).toBeDisabled()
  await page.getByTestId('io-group-import-mode-replace').check()
  await expect(page.getByTestId('io-group-import-errors')).toHaveCount(0)
  await expect(confirm(page)).toBeEnabled()
  await cancelPreview(page)
  await saveAndExpectNames(app, ['EXISTING'])
})

test('appends groups after the existing ones, with warnings and fresh IEC addresses', async () => {
  await chooseFile(
    page,
    'append.csv',
    [
      'name,functionCode,cycleTime,offset,length,errorHandling',
      'TEMPS,3,200,0x10,3,set-to-zero',
      'COILS,15,100,0,4,set-to-zero',
      `${LONG_NAME},4,100,0,1,`,
    ].join('\r\n'),
  )
  await expect(page.getByTestId('io-group-import-summary')).toContainText('3 IO groups found')
  await expect(page.getByTestId('io-group-import-warnings')).toContainText(
    'Row 3 · errorHandling: Error handling only applies to read function codes; ignored for FC 15.',
  )
  await expect(page.getByTestId('io-group-import-mode-append')).toBeChecked()
  await confirm(page).click()
  await expect(modal(page)).toHaveCount(0)

  await saveAndExpectNames(app, ['EXISTING', 'TEMPS', 'COILS', LONG_NAME])
  const [existing, temps, coils, long] = storedGroups()
  expect(existing.ioPoints.map((p) => p.iecLocation)).toEqual(['%IW0', '%IW1'])
  expect(temps).toMatchObject({
    functionCode: '3',
    cycleTime: 200,
    offset: '16',
    length: 3,
    errorHandling: 'set-to-zero',
  })
  expect(temps.ioPoints.map((p) => p.iecLocation)).toEqual(['%IW2', '%IW3', '%IW4'])
  expect(coils).toMatchObject({ functionCode: '15', errorHandling: 'keep-last-value' })
  expect(coils.ioPoints.map((p) => p.iecLocation)).toEqual(['%QX0.0', '%QX0.1', '%QX0.2', '%QX0.3'])
  expect(long.ioPoints.map((p) => p.iecLocation)).toEqual(['%IW5'])
})

test('a long group name is cut in the table and shown in full on hover', async () => {
  const long = storedGroups().find((g) => g.name === LONG_NAME)
  if (!long) throw new Error('long group missing')
  const cell = page.getByTestId(`io-group-name-${long.id}`)
  await expect(cell).toHaveText(LONG_NAME)
  expect(await cell.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  // Slide across the cell like a pointer would; the tooltip opens on movement over it.
  const box = await cell.boundingBox()
  if (!box) throw new Error('long name cell has no box')
  await page.mouse.move(box.x - 20, box.y + box.height / 2)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 })
  await expect(page.getByTestId('truncated-text-tooltip').first()).toContainText(LONG_NAME)
  // Radix repeats the content in a hidden role="tooltip" node for screen readers.
  await expect(page.getByRole('tooltip')).toHaveText(LONG_NAME)
})

test('replacing with an exported file reproduces the same groups', async () => {
  const before = storedGroups()
  const exported = await exportAs(page, 'json')
  await chooseFile(page, 'REMOTE-io-groups.json', exported)
  await expect(page.getByTestId('io-group-import-summary')).toContainText('4 IO groups found')
  await page.getByTestId('io-group-import-mode-replace').check()
  await confirm(page).click()
  await expect(modal(page)).toHaveCount(0)

  await saveAndExpectNames(
    app,
    before.map((g) => g.name),
  )
  const fields = (g: StoredGroup) => ({
    name: g.name,
    functionCode: g.functionCode,
    cycleTime: g.cycleTime,
    offset: g.offset,
    length: g.length,
    errorHandling: g.errorHandling,
    addresses: g.ioPoints.map((p) => p.iecLocation),
  })
  expect(storedGroups().map(fields)).toEqual(before.map(fields))
})

test('the New IO Group form keeps names to 64 characters', async () => {
  await page.getByLabel('Add IO Group').click()
  const name = page.getByTestId('io-group-name-input')
  await name.fill('n'.repeat(70))
  await expect(name).toHaveValue('n'.repeat(64))
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
})

test('the project builds with the imported groups in the Modbus master configuration', async () => {
  test.setTimeout(300000)
  const groups = storedGroups()
  await buildFromMenu(page, 'Build only')

  const build = join(FIXTURE, 'build')
  await expect.poll(() => findFile(build, 'program.st') !== undefined, { timeout: 240000 }).toBe(true)
  // Read the file only once it is complete JSON.
  const readMaster = (): MasterDevice[] | null => {
    const path = findFile(build, 'modbus_master.json')
    if (!path) return null
    try {
      const parsed: MasterDevice[] = JSON.parse(readFileSync(path, 'utf-8'))
      return parsed
    } catch {
      return null
    }
  }
  await expect.poll(() => readMaster() !== null, { timeout: 60000 }).toBe(true)
  const [device] = readMaster() ?? []
  expect(device.name).toBe('REMOTE')
  expect(device.config.io_points).toEqual(
    groups.map((g) => ({
      fc: Number(g.functionCode),
      offset: `0x${Number(g.offset).toString(16).padStart(4, '0').toUpperCase()}`,
      iec_location: g.ioPoints[0].iecLocation,
      len: g.length,
      cycle_time_ms: g.cycleTime,
      error_handling: g.errorHandling,
    })),
  )
})
