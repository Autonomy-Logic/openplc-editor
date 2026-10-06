/**
 * Modbus master IO groups offer Error Handling on read function codes only, and a
 * legacy write group saved with set-to-zero is stored as keep-last-value on edit.
 *
 * Needs a production build plus the preload copy; see "Electron e2e" in CLAUDE.md.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron, expect, test } from '@playwright/test'

const ROOT = join(tmpdir(), 'openplc-e2e-modbus-error-handling')
const FIXTURE = join(ROOT, 'project')
const USER_DATA = join(ROOT, 'userdata')
const REMOTE_FILE = join(FIXTURE, 'devices', 'remote', 'REMOTE.json')

const point = (id: string, iecLocation: string) => ({ id, name: id, type: 'register', iecLocation })

function writeFixture(): void {
  rmSync(ROOT, { recursive: true, force: true })
  mkdirSync(join(FIXTURE, 'pous', 'programs'), { recursive: true })
  mkdirSync(join(FIXTURE, 'devices', 'remote'), { recursive: true })
  writeFileSync(
    join(FIXTURE, 'project.json'),
    JSON.stringify({
      meta: { name: 'modbus-error-handling', type: 'plc-project' },
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
            id: 'read-group',
            name: 'READS',
            functionCode: '3',
            cycleTime: 100,
            offset: '0',
            length: 1,
            errorHandling: 'set-to-zero',
            ioPoints: [point('r0', '%IW0')],
          },
          {
            id: 'write-group',
            name: 'WRITES',
            functionCode: '16',
            cycleTime: 100,
            offset: '0',
            length: 1,
            errorHandling: 'set-to-zero',
            ioPoints: [point('w0', '%QW0')],
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
        name: 'modbus-error-handling',
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

type StoredGroup = { id: string; errorHandling: string }

const storedGroups = (): StoredGroup[] => {
  const parsed: { modbusTcpConfig: { ioGroups: StoredGroup[] } } = JSON.parse(readFileSync(REMOTE_FILE, 'utf-8'))
  return parsed.modbusTcpConfig.ioGroups
}

const errorHandlingOf = (id: string): string | undefined => storedGroups().find((g) => g.id === id)?.errorHandling

test('Error Handling is offered on read IO groups only', async () => {
  test.setTimeout(180000)
  writeFixture()
  const { app, page } = await launch()
  try {
    await page.getByText('modbus-error-handling', { exact: true }).first().click({ timeout: 30000 })
    await page.getByText('REMOTE', { exact: true }).first().click({ timeout: 30000 })

    const modal = page.getByRole('dialog')
    const errorHandling = modal.getByText('Error Handling', { exact: true })

    await page.getByLabel('Edit READS').click({ timeout: 15000 })
    await expect(modal.getByText('Edit IO Group')).toBeVisible()
    await expect(errorHandling).toBeVisible()
    await modal.getByRole('button', { name: 'Cancel' }).click()

    // A group saved before the fix with set-to-zero on a write function code.
    await page.getByLabel('Edit WRITES').click({ timeout: 15000 })
    await expect(modal.getByText('Edit IO Group')).toBeVisible()
    await expect(errorHandling).toHaveCount(0)
    await modal.getByRole('button', { name: 'Save' }).click()
    await save(app)
    await expect.poll(() => errorHandlingOf('write-group'), { timeout: 15000 }).toBe('keep-last-value')
    expect(errorHandlingOf('read-group')).toBe('set-to-zero')

    await page.getByLabel('Add IO Group').click({ timeout: 15000 })
    await expect(modal.getByText('New IO Group')).toBeVisible()
    await expect(errorHandling).toBeVisible()
    await modal.getByRole('combobox').first().click()
    await page.getByRole('option', { name: 'Write Single Coil (FC 5)' }).click()
    await expect(errorHandling).toHaveCount(0)
    await modal.getByRole('combobox').first().click()
    await page.getByRole('option', { name: 'Read Input Registers (FC 4)' }).click()
    await expect(errorHandling).toBeVisible()
  } finally {
    await app.close()
  }
})
