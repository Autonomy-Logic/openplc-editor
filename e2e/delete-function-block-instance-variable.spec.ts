import { copyFileSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { _electron as electron, expect, test } from '@playwright/test'

const PROJECT_NAME = 'fb-instance-e2e'
const OPCUA_SERVER_NAME = 'opcua_e2e'
const STANDARD_FB_LIBRARY = 'iec-standard-fb'

const opcuaServer = {
  name: OPCUA_SERVER_NAME,
  protocol: 'opcua',
  opcuaServerConfig: {
    server: {
      enabled: false,
      name: 'OpenPLC OPC UA Server',
      applicationUri: 'urn:openplc:opcua:server',
      productUri: 'urn:openplc:runtime',
      bindAddress: '0.0.0.0',
      port: 4840,
      endpointPath: '/openplc/opcua',
    },
    securityProfiles: [
      {
        id: 'default-insecure',
        name: 'insecure',
        enabled: true,
        securityPolicy: 'None',
        securityMode: 'None',
        authMethods: ['Anonymous'],
        anonymousRole: 'viewer',
      },
    ],
    security: {
      serverCertificateStrategy: 'auto_self_signed',
      serverCertificateCustom: null,
      serverPrivateKeyCustom: null,
      trustedClientCertificates: [],
    },
    users: [],
    cycleTimeMs: 100,
    addressSpace: { namespaceUri: 'urn:openplc:opcua:namespace', nodes: [] },
  },
}

/**
 * Writes an FBD program, a Ladder program and an OPC-UA server to disk, plus a profile that lists the project and
 * installs the standard function block library, which an unpackaged launch does not find among the bundled ones.
 */
function writeFixture(root: string): { userData: string } {
  const project = join(root, 'project')
  const userData = join(root, 'userdata')
  rmSync(root, { recursive: true, force: true })
  mkdirSync(join(project, 'pous', 'programs'), { recursive: true })
  mkdirSync(join(project, 'devices', 'servers'), { recursive: true })
  mkdirSync(join(project, 'devices', 'remote'), { recursive: true })

  writeFileSync(
    join(project, 'project.json'),
    JSON.stringify({
      meta: { name: PROJECT_NAME, type: 'plc-project' },
      data: {
        dataTypes: [],
        pous: [],
        configuration: {
          resource: {
            tasks: [{ name: 'task0', triggering: 'Cyclic', interval: 'T#20ms', priority: 1 }],
            instances: [
              { name: 'instance0', program: 'main_fbd', task: 'task0' },
              { name: 'instance1', program: 'main_ld', task: 'task0' },
            ],
            globalVariables: [],
          },
        },
        libraries: [],
        debugVariables: { global: [], pous: {} },
      },
    }),
  )
  writeFileSync(
    join(project, 'devices', 'configuration.json'),
    JSON.stringify({
      deviceBoard: 'OpenPLC Simulator',
      communicationPort: '',
      runtimeIpAddress: '',
      selectedPlatformOptions: {},
    }),
  )
  writeFileSync(join(project, 'devices', 'pin-mapping.json'), '{}')
  writeFileSync(join(project, 'devices', 'servers', `${OPCUA_SERVER_NAME}.json`), JSON.stringify(opcuaServer))
  for (const file of ['main_fbd.fbd', 'main_ld.ld']) {
    copyFileSync(join(__dirname, 'fixtures', 'function-block-instance', file), join(project, 'pous', 'programs', file))
  }

  const history = join(userData, 'User', 'History')
  mkdirSync(history, { recursive: true })
  writeFileSync(
    join(history, 'projects.json'),
    JSON.stringify([
      {
        name: PROJECT_NAME,
        path: project,
        projectFilePath: join(project, 'project.json'),
        createdAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
      },
    ]),
  )
  writeFileSync(join(history, 'libraries.json'), '[]')

  const runtime = join(userData, 'User', 'Runtime')
  mkdirSync(runtime, { recursive: true })
  writeFileSync(join(runtime, 'arduino-core-control.json'), '[]')
  writeFileSync(join(runtime, 'arduino-library-control.json'), '[]')

  const libraryDir = join(userData, 'libraries', STANDARD_FB_LIBRARY)
  const stlibPath = join(libraryDir, `${STANDARD_FB_LIBRARY}.stlib`)
  mkdirSync(libraryDir, { recursive: true })
  copyFileSync(join(__dirname, '..', 'node_modules', 'strucpp', 'libs', `${STANDARD_FB_LIBRARY}.stlib`), stlibPath)
  writeFileSync(
    join(userData, 'libraries', 'registry.json'),
    JSON.stringify({
      formatVersion: '1.0',
      libraries: {
        [STANDARD_FB_LIBRARY]: { version: '1.0.0', installedAt: new Date().toISOString(), stlibPath, origin: 'stlib' },
      },
    }),
  )
  return { userData }
}

async function killElectron(app: ElectronApplication): Promise<void> {
  const electronProcess = app.process()
  if (electronProcess.exitCode !== null) return
  const exited = new Promise((resolve) => electronProcess.once('exit', resolve))
  electronProcess.kill('SIGKILL')
  await exited
}

async function launch(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [join(__dirname, '..', 'release', 'app', 'dist', 'main', 'main.js'), `--user-data-dir=${userData}`],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      try {
        if (w.url().includes('index.html')) {
          await w.waitForLoadState('domcontentloaded')
          await app.evaluate(({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().includes('index.html'))
            win?.setSize(1800, 1100)
          })
          return { app, page: w }
        }
      } catch {
        continue
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  await killElectron(app)
  throw new Error('the editor window never appeared')
}

const node = (page: Page, id: string): Locator => page.getByTestId(`rf__node-${id}`)

const variablesTable = (page: Page): Locator => page.getByRole('table', { name: 'Variables table' })

const variableRow = (page: Page, name: string): Locator => variablesTable(page).getByText(name, { exact: true })

const editorTab = (page: Page, name: string): Locator => page.getByRole('tab', { name: new RegExp(`${name}$`) })

const addressSpace = (page: Page): Locator => page.getByRole('tabpanel', { name: 'Address Space' })

const availableVariable = (page: Page, name: string): Locator => addressSpace(page).getByText(name, { exact: true })

const availableCount = (page: Page, count: number): Locator =>
  addressSpace(page).getByText(`${count} available`, { exact: true })

const openPou = async (page: Page, name: string, anchorNodeId: string): Promise<void> => {
  await page.getByText(name, { exact: true }).first().click()
  await expect(node(page, anchorNodeId)).toBeVisible({ timeout: 20000 })
}

const deleteWithKeyboard = async (page: Page, nodeId: string): Promise<void> => {
  await node(page, nodeId).click()
  await expect(node(page, nodeId)).toHaveClass(/\bselected\b/)
  await page.keyboard.press('Delete')
  await expect(node(page, nodeId)).toHaveCount(0)
}

/** Clicks Edit > Undo in the application menu, the item its Ctrl+Z accelerator fires on Linux and Windows. */
const undoFromMenu = async (): Promise<void> => {
  const clicked = await app.evaluate(({ Menu }) => {
    const items = Menu.getApplicationMenu()?.items.flatMap((item) => item.submenu?.items ?? []) ?? []
    const undo = items.find((item) => item.accelerator === 'Ctrl+Z' || item.accelerator === 'Cmd+Z')
    if (!undo?.enabled) return false
    undo.click()
    return true
  })
  expect(clicked, 'Edit > Undo is missing or disabled in the application menu').toBe(true)
}

const openAddressSpace = async (page: Page): Promise<void> => {
  await page.getByText(OPCUA_SERVER_NAME, { exact: true }).first().click()
  await page.getByRole('tab', { name: 'Address Space', exact: true }).click()
  await expect(addressSpace(page).getByRole('heading', { name: 'Available PLC Variables' })).toBeVisible()
}

let app: ElectronApplication
let page: Page

test.describe('deleting a function block removes its unreferenced instance variable', () => {
  test.beforeEach(async ({}, testInfo) => {
    const root = join(realpathSync(tmpdir()), `openplc-e2e-fb-instance-${testInfo.testId}-${testInfo.repeatEachIndex}`)
    const { userData } = writeFixture(root)
    ;({ app, page } = await launch(userData))
    await page.getByText(PROJECT_NAME, { exact: true }).first().click({ timeout: 30000 })
    await openPou(page, 'main_fbd', 'BLOCK_e2e-fbd-ton-unreferenced')
  })

  test.afterEach(async () => {
    await killElectron(app)
  })

  test('FBD: deleting an unreferenced TON drops its instance from the variables and the OPC-UA list', async () => {
    await openAddressSpace(page)
    await expect(availableCount(page, 13)).toBeVisible()
    await expect(availableVariable(page, 'TON5')).toBeVisible()

    await editorTab(page, 'main_fbd').click()
    await expect(variableRow(page, 'TON5')).toBeAttached()
    await deleteWithKeyboard(page, 'BLOCK_e2e-fbd-ton-unreferenced')

    await expect(variableRow(page, 'TON5')).toHaveCount(0)
    await expect(variableRow(page, 'TON6')).toBeAttached()
    await expect(variableRow(page, 'TON7')).toBeAttached()

    await openAddressSpace(page)
    await expect(availableCount(page, 12)).toBeVisible()
    await expect(availableVariable(page, 'TON5')).toHaveCount(0)
    await expect(availableVariable(page, 'TON6')).toBeVisible()
  })

  test('FBD: a TON whose output another node reads keeps its instance', async () => {
    await expect(node(page, 'INPUT-VARIABLE-e2e-fbd-ton6-q')).toBeVisible()

    await deleteWithKeyboard(page, 'BLOCK_e2e-fbd-ton-member')

    await expect(variableRow(page, 'TON6')).toBeAttached()
  })

  test('FBD: deleting one of two blocks sharing an instance keeps it', async () => {
    await deleteWithKeyboard(page, 'BLOCK_e2e-fbd-ton-shared-a')

    await expect(node(page, 'BLOCK_e2e-fbd-ton-shared-b')).toBeVisible()
    await expect(variableRow(page, 'TON7')).toBeAttached()
  })

  test('FBD: one undo restores both the TON and its instance', async () => {
    await deleteWithKeyboard(page, 'BLOCK_e2e-fbd-ton-unreferenced')
    await expect(variableRow(page, 'TON5')).toHaveCount(0)

    await undoFromMenu()

    await expect(node(page, 'BLOCK_e2e-fbd-ton-unreferenced')).toBeVisible()
    await expect(variableRow(page, 'TON5')).toBeAttached()
  })

  test('Ladder: deleting an unreferenced TON drops its instance from the variables and the OPC-UA list', async () => {
    await openPou(page, 'main_ld', 'BLOCK_e2e-ld-ton0')
    await expect(variableRow(page, 'TON0')).toBeAttached()

    await deleteWithKeyboard(page, 'BLOCK_e2e-ld-ton0')

    await expect(variableRow(page, 'TON0')).toHaveCount(0)
    await expect(variableRow(page, 'TOF0')).toBeAttached()
    await expect(variableRow(page, 'CTU0')).toBeAttached()

    await openAddressSpace(page)
    await expect(availableCount(page, 12)).toBeVisible()
    await expect(availableVariable(page, 'TON0')).toHaveCount(0)
    await expect(availableVariable(page, 'TOF0')).toBeVisible()
  })

  test('Ladder: a TOF whose output a contact reads keeps its instance', async () => {
    await openPou(page, 'main_ld', 'BLOCK_e2e-ld-tof0')
    await expect(node(page, 'CONTACT_e2e-ld-tof0-q')).toBeVisible()

    await deleteWithKeyboard(page, 'BLOCK_e2e-ld-tof0')

    await expect(variableRow(page, 'TOF0')).toBeAttached()
  })

  test('Ladder: one undo restores both the TON and its instance', async () => {
    await openPou(page, 'main_ld', 'BLOCK_e2e-ld-ton0')
    await deleteWithKeyboard(page, 'BLOCK_e2e-ld-ton0')
    await expect(variableRow(page, 'TON0')).toHaveCount(0)

    await undoFromMenu()

    await expect(node(page, 'BLOCK_e2e-ld-ton0')).toBeVisible()
    await expect(variableRow(page, 'TON0')).toBeAttached()
  })

  test('Ladder toolbox: Delete selected elements drops the instance and one undo restores both', async () => {
    await openPou(page, 'main_ld', 'BLOCK_e2e-ld-ctu0')
    await node(page, 'BLOCK_e2e-ld-ctu0').click()
    await expect(node(page, 'BLOCK_e2e-ld-ctu0')).toHaveClass(/\bselected\b/)

    await page.getByRole('button', { name: 'Delete element button' }).click()

    await expect(node(page, 'BLOCK_e2e-ld-ctu0')).toHaveCount(0)
    await expect(variableRow(page, 'CTU0')).toHaveCount(0)
    await expect(variableRow(page, 'TON0')).toBeAttached()

    await undoFromMenu()

    await expect(node(page, 'BLOCK_e2e-ld-ctu0')).toBeVisible()
    await expect(variableRow(page, 'CTU0')).toBeAttached()
  })
})
