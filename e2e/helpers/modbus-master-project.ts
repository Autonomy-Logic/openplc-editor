/**
 * A one-program project for the Modbus master specs, written with its remote devices and servers on disk,
 * plus the launch, save and shutdown steps those specs share. Boards from the unsigned e2e package need the
 * signature stub `launch` installs before the project opens.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

import { installBaremetalPackage } from '../fixtures/baremetal-modbus-master/build-package'
import { SOURCE_USER_DATA } from './arduino-build-project'

export const PROJECT_NAME = 'modbus-master'

export interface ModbusMasterProjectSpec {
  board: string
  remoteDevices?: Record<string, unknown>[]
  servers?: Record<string, unknown>[]
  vendorScreenData?: Record<string, unknown>
}

export interface ModbusMasterProject {
  project: string
  userData: string
}

/** A Modbus remote device file with no IO groups. */
export function remoteDevice(name: string, config: Record<string, unknown>): Record<string, unknown> {
  return { name, protocol: 'modbus-tcp', modbusTcpConfig: { timeout: 1000, slaveId: 1, ioGroups: [], ...config } }
}

/**
 * Writes the project and a fresh profile under the real temp folder (Electron resolves `userData` through
 * symlinks), with empty Arduino control files, without which the board list never loads, and the e2e
 * baremetal package. Borrows this machine's arduino-cli folder when it has one, so startup installs nothing.
 */
export function writeModbusMasterProject(slug: string, spec: ModbusMasterProjectSpec): ModbusMasterProject {
  const root = join(realpathSync(tmpdir()), `openplc-e2e-modbus-master-${slug}`)
  const project = join(root, 'project')
  const userData = join(root, 'userdata')
  rmSync(root, { recursive: true, force: true })
  mkdirSync(join(project, 'pous', 'programs'), { recursive: true })
  mkdirSync(join(project, 'devices', 'remote'), { recursive: true })
  mkdirSync(join(project, 'devices', 'servers'), { recursive: true })
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
    join(project, 'devices', 'configuration.json'),
    JSON.stringify({
      deviceBoard: spec.board,
      communicationPort: '',
      runtimeIpAddress: '192.168.1.50',
      selectedPlatformOptions: {},
      ...(spec.vendorScreenData
        ? { vendorScreenData: spec.vendorScreenData, vendorScreenDataByBoard: { [spec.board]: spec.vendorScreenData } }
        : {}),
    }),
  )
  writeFileSync(join(project, 'devices', 'pin-mapping.json'), '{}')
  writeFileSync(
    join(project, 'pous', 'programs', 'main.st'),
    'PROGRAM main\n  VAR\n    a : BOOL;\n  END_VAR\n\na := a;\n\nEND_PROGRAM\n',
  )
  for (const device of spec.remoteDevices ?? []) {
    writeFileSync(join(project, 'devices', 'remote', `${String(device.name)}.json`), JSON.stringify(device))
  }
  for (const server of spec.servers ?? []) {
    writeFileSync(join(project, 'devices', 'servers', `${String(server.name)}.json`), JSON.stringify(server))
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
  if (existsSync(join(SOURCE_USER_DATA, 'arduino'))) {
    symlinkSync(join(SOURCE_USER_DATA, 'arduino'), join(userData, 'arduino'))
  }

  installBaremetalPackage(join(userData, 'packages'))
  return { project, userData }
}

/**
 * Launches the built app on `userData` in production mode, picks the main window past the splash, stubs the
 * signature check once the project history shows (the bridge has registered its handlers by then) and opens
 * the project.
 */
export async function launchProject(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [join(__dirname, '..', '..', 'release', 'app', 'dist', 'main', 'main.js'), `--user-data-dir=${userData}`],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      try {
        if (w.url().includes('index.html')) {
          await w.waitForLoadState('domcontentloaded')
          await w.getByText(PROJECT_NAME, { exact: true }).first().waitFor({ timeout: 30000 })
          await app.evaluate(({ ipcMain }) => {
            ipcMain.removeHandler('packages:verify-signatures')
            ipcMain.handle('packages:verify-signatures', () => [])
          })
          await w.getByText(PROJECT_NAME, { exact: true }).first().click()
          return { app, page: w }
        }
      } catch {
        continue
      }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  await shutdown(app)
  throw new Error('main window never appeared')
}

/** The quit confirmation holds every quit with a project open, so the process is killed. */
export async function shutdown(app: ElectronApplication): Promise<void> {
  const proc = app.process()
  if (proc.exitCode !== null) return
  const exited = new Promise((resolve) => proc.once('exit', resolve))
  proc.kill('SIGKILL')
  await exited
}

/** Ctrl+S is a native menu accelerator, which Playwright's keyboard never reaches. */
export async function save(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'))
    win?.webContents.send('project:save-accelerator')
  })
}

/** Parsed JSON of a project file, or `undefined` while it does not exist. */
export function readProjectJson(project: string, ...path: string[]): unknown {
  const file = join(project, ...path)
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : undefined
}

/** A tree item of the project explorer, visible and named exactly `name`. */
export const treeItem = (page: Page, name: string) =>
  page.getByText(name, { exact: true }).filter({ visible: true }).first()

/** Opens a project tree item, waiting for the explorer to list it. */
export async function openTreeItem(page: Page, name: string): Promise<void> {
  await treeItem(page, name).click({ timeout: 30000 })
}

/** The console panel's text, where build messages land. */
export const consolePanel = (page: Page) => page.getByRole('tabpanel', { name: 'Console' })
