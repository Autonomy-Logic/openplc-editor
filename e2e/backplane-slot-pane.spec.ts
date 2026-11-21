import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron, expect, test } from '@playwright/test'

import {
  BACKPLANE_SCREEN,
  FIXTURE_BOARD,
  installModuleSlotsPackage,
} from './fixtures/module-slots-package/build-package'

const ROOT = join(realpathSync(tmpdir()), 'openplc-e2e-backplane-slot-pane')
const FIXTURE = join(ROOT, 'project')
const USER_DATA = join(ROOT, 'userdata')
const PROJECT_NAME = 'backplane-slot-pane'

function writeFixture(): void {
  rmSync(ROOT, { recursive: true, force: true })
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

  const runtime = join(USER_DATA, 'User', 'Runtime')
  mkdirSync(runtime, { recursive: true })
  writeFileSync(join(runtime, 'arduino-core-control.json'), '[]')
  writeFileSync(join(runtime, 'arduino-library-control.json'), '[]')

  installModuleSlotsPackage(join(USER_DATA, 'packages'))
}

async function killElectron(app: ElectronApplication): Promise<void> {
  const electronProcess = app.process()
  if (electronProcess.exitCode !== null) return
  const exited = new Promise((resolve) => electronProcess.once('exit', resolve))
  electronProcess.kill('SIGKILL')
  await exited
}

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [join(__dirname, '..', 'release', 'app', 'dist', 'main', 'main.js'), `--user-data-dir=${USER_DATA}`],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    for (const window of app.windows()) {
      try {
        if (window.url().includes('index.html')) {
          await window.waitForLoadState('domcontentloaded')
          await window.getByText(PROJECT_NAME, { exact: true }).first().waitFor({ timeout: 30000 })
          // The fixture package is unsigned, and the editor drops unsigned packages when a project opens.
          await app.evaluate(({ ipcMain }) => {
            ipcMain.removeHandler('packages:verify-signatures')
            ipcMain.handle('packages:verify-signatures', () => [])
          })
          return { app, page: window }
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

const SLOT_PANE_METRICS = `(() => {
  const picture = document.querySelector('img[alt^="E2E-"]')
  const pane = picture ? picture.closest('.overflow-y-auto') : null
  const heading = Array.from(document.querySelectorAll('h4, h3, div, span')).find(
    (element) => element.textContent?.trim() === 'I/O Mapping',
  )
  if (!pane) return null
  const paneBox = pane.getBoundingClientRect()
  const pictureBox = picture.getBoundingClientRect()
  return {
    scrollTop: pane.scrollTop,
    scrollable: pane.scrollHeight > pane.clientHeight,
    pictureWithinPane: pictureBox.bottom <= paneBox.bottom,
    headingWithinPane: heading ? heading.getBoundingClientRect().bottom <= paneBox.bottom : false,
  }
})()`

const scrollPaneToEnd = `(() => {
  const pane = Array.from(document.querySelectorAll('.overflow-y-auto')).find(
    (element) => element.scrollHeight > element.clientHeight + 50,
  )
  if (!pane) return 0
  pane.scrollTop = pane.scrollHeight
  return pane.scrollTop
})()`

type SlotPaneMetrics = {
  scrollTop: number
  scrollable: boolean
  pictureWithinPane: boolean
  headingWithinPane: boolean
}

const readMetrics = async (page: Page): Promise<SlotPaneMetrics> => {
  const metrics = await page.evaluate(SLOT_PANE_METRICS)
  if (!metrics) throw new Error('the slot detail pane is not on screen')
  return metrics as SlotPaneMetrics
}

let app: ElectronApplication
let page: Page

test.describe('Backplane Configuration slot pane', () => {
  test.setTimeout(180000)

  test.beforeEach(async () => {
    writeFixture()
    const launched = await launch()
    app = launched.app
    page = launched.page
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.getByText(PROJECT_NAME, { exact: true }).first().click({ timeout: 30000 })
    await page
      .getByText(new RegExp(`^(\\* )?${BACKPLANE_SCREEN}$`))
      .filter({ visible: true })
      .first()
      .click({ timeout: 30000 })
    await expect(page.getByRole('button', { name: '+ Add module' })).toBeVisible({ timeout: 30000 })
  })

  test.afterEach(async () => {
    await killElectron(app)
  })

  test('opens a module at the top of the pane, with the picture and the I/O Mapping heading inside it', async () => {
    await page.getByRole('button', { name: '+ Add module' }).click()
    await expect(page.getByText('Slot 1', { exact: true }).first()).toBeVisible()

    const metrics = await readMetrics(page)

    expect(metrics.scrollTop).toBe(0)
    expect(metrics.pictureWithinPane).toBe(true)
    expect(metrics.headingWithinPane).toBe(true)
  })

  test('returns to the top when another module is added and when the slot changes', async () => {
    const addModule = page.getByRole('button', { name: '+ Add module' })
    await addModule.click()
    await expect(page.getByText('Slot 1', { exact: true }).first()).toBeVisible()
    expect(await page.evaluate(scrollPaneToEnd)).toBeGreaterThan(0)

    await addModule.click()
    await expect(page.getByText('Slot 2', { exact: true }).first()).toBeVisible()
    expect((await readMetrics(page)).scrollTop).toBe(0)

    expect(await page.evaluate(scrollPaneToEnd)).toBeGreaterThan(0)
    await page.getByText('Slot 1', { exact: true }).first().click()

    expect((await readMetrics(page)).scrollTop).toBe(0)
  })
})
