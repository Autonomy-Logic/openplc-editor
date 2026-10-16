/**
 * Shared setup for the EtherCAT specs: a Runtime v4 project with one EtherCAT bus from
 * e2e/fixtures, the app launch, and a quit that answers the app's own prompt.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from '@playwright/test'

export const PROJECT_NAME = 'ethercat-project'

/** A UR20 coupler with modules in slots 1, 2 and 4; slot 1 input drives slot 2 output. */
export const UR20_STATION = {
  bus: join('ethercat-ur20', 'bus_a.json'),
  program:
    'PROGRAM main\n  VAR\n    di1 AT %IX2.0 : BOOL;\n    do1 AT %QX2.0 : BOOL;\n  END_VAR\n\ndo1 := di1;\n\nEND_PROGRAM\n',
}

/** A Beckhoff EK1818 (8 inputs, 4 outputs, no mailbox); input 0 drives output 0. */
export const EK1818_STATION = {
  bus: join('ethercat-ek1818', 'ecat_bus.json'),
  program:
    'PROGRAM main\n  VAR\n    di0 AT %IX0.0 : BOOL;\n    do0 AT %QX0.0 : BOOL;\n  END_VAR\n\ndo0 := di0;\n\nEND_PROGRAM\n',
}

export interface ProjectPaths {
  project: string
  userData: string
}

export function writeEthercatProject(
  root: string,
  runtimeIpAddress: string,
  station: { bus: string; program: string },
): ProjectPaths {
  const project = join(root, 'project')
  const userData = join(root, 'userdata')
  rmSync(root, { recursive: true, force: true })
  mkdirSync(join(project, 'pous', 'programs'), { recursive: true })
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
      deviceBoard: 'OpenPLC Runtime v4',
      communicationPort: '',
      runtimeIpAddress,
      selectedPlatformOptions: {},
    }),
  )
  writeFileSync(join(project, 'devices', 'pin-mapping.json'), '{}')
  writeFileSync(join(project, 'pous', 'programs', 'main.st'), station.program)
  const busFile = join(__dirname, '..', 'fixtures', station.bus)
  copyFileSync(busFile, join(project, 'devices', 'remote', basename(busFile)))

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

  // A fresh profile has no Arduino control files, and without them the board list never loads.
  const runtime = join(userData, 'User', 'Runtime')
  mkdirSync(runtime, { recursive: true })
  writeFileSync(join(runtime, 'arduino-core-control.json'), '[]')
  writeFileSync(join(runtime, 'arduino-library-control.json'), '[]')
  return { project, userData }
}

export async function launch(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [join(__dirname, '..', '..', 'release', 'app', 'dist', 'main', 'main.js'), `--user-data-dir=${userData}`],
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

/** Opens Device > Configuration, connects and logs in to the runtime at the project's address. */
export async function connectRuntime(page: Page, user: string, pass: string): Promise<void> {
  await page.getByText('Configuration', { exact: true }).first().click({ timeout: 30000 })
  await page.getByRole('button', { name: 'Connect', exact: true }).click({ timeout: 30000 })
  await page.getByPlaceholder('Enter username').fill(user, { timeout: 30000 })
  await page.getByPlaceholder('Enter password').fill(pass)
  await page.getByRole('button', { name: 'Login', exact: true }).click()
  await page.getByRole('button', { name: 'Disconnect', exact: true }).waitFor({ timeout: 60000 })
}

/** Quits through the app's own prompt, answering Yes; kills the process if it does not end. */
export async function quitApp(app: ElectronApplication, page: Page): Promise<void> {
  const closed = new Promise<void>((resolve) => app.once('close', () => resolve()))
  await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined)
  await page
    .getByRole('button', { name: 'Yes', exact: true })
    .click({ timeout: 10000 })
    .catch(() => undefined)
  const ended = await Promise.race([
    closed.then(() => true),
    new Promise<boolean>((r) => setTimeout(() => r(false), 15000)),
  ])
  if (!ended) app.process().kill('SIGKILL')
}

/** Opens Build options and picks @p option ("Build only", "Build and upload"). */
export async function buildFromMenu(page: Page, option: string): Promise<void> {
  await page.getByRole('button', { name: 'Build options' }).click({ timeout: 30000 })
  await page.getByText(option, { exact: true }).click({ timeout: 15000 })
  // A running PLC on the target is stopped first; the prompt only appears when it runs.
  await page
    .getByRole('button', { name: 'Stop PLC and Continue', exact: true })
    .click({ timeout: 10000 })
    .catch(() => undefined)
}

/** First file named @p name under @p dir, searched depth-first. */
export function findFile(dir: string, name: string): string | undefined {
  if (!existsSync(dir)) return undefined
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      const found = findFile(path, name)
      if (found !== undefined) return found
    } else if (entry === name) {
      return path
    }
  }
  return undefined
}
