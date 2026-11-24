import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { _electron as electron, test as base, type ElectronApplication, expect, type Page } from '@playwright/test'

import { shutdown } from './electron-editor'

const RELEASE_APP = join(__dirname, '..', '..', 'release', 'app')
const MAIN = join(RELEASE_APP, 'dist', 'main', 'main.js')

/**
 * The executable of a test-only packaged build (`npm run package:test`) named by `E2E_PACKAGED_APP`, resolved from the
 * repository root, or `''` when unset. Playwright cannot drive a fused `npm run package` build.
 */
export const PACKAGED_APP = process.env.E2E_PACKAGED_APP
  ? resolve(__dirname, '..', '..', process.env.E2E_PACKAGED_APP)
  : ''

export interface EditorSession {
  app: ElectronApplication
  page: Page
}

/** A new folder under the real temporary directory (`/var` resolved on macOS), named after `label`. */
export function freshDirectory(label: string): string {
  return mkdtempSync(join(realpathSync(tmpdir()), `openplc-e2e-${label}-`))
}

/** Writes a new, empty editor profile (no recent projects, no libraries) and returns its folder. */
export function freshProfile(label: string): string {
  const userData = join(freshDirectory(label), 'userdata')
  const history = join(userData, 'User', 'History')
  const runtime = join(userData, 'User', 'Runtime')
  mkdirSync(history, { recursive: true })
  mkdirSync(runtime, { recursive: true })
  mkdirSync(join(userData, 'arduino', 'data'), { recursive: true })
  writeFileSync(join(history, 'projects.json'), '[]')
  writeFileSync(join(history, 'libraries.json'), '[]')
  for (const control of ['arduino-core-control.json', 'arduino-library-control.json']) {
    writeFileSync(join(runtime, control), '[]')
  }
  return userData
}

/**
 * Copies the built preload to `release/app/configs/dll/`, where an unpackaged `main.js` looks for it (see "Electron
 * e2e" in CLAUDE.md). Written to a temporary name and renamed, so a worker launching meanwhile never reads half a file.
 */
export function copyPreload(): void {
  const target = join(RELEASE_APP, 'configs', 'dll', 'preload.js')
  const partial = `${target}.${process.pid}`
  mkdirSync(join(RELEASE_APP, 'configs', 'dll'), { recursive: true })
  copyFileSync(join(RELEASE_APP, 'dist', 'main', 'preload.js'), partial)
  renameSync(partial, target)
}

/** True once the main window is visible, which the editor does only after the startup checks passed. */
export const mainWindowShown = (app: ElectronApplication): Promise<boolean> =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().includes('index.html') && w.isVisible()),
  )

/**
 * Waits until the editor's main window is shown and returns it. Fails at once, quoting the reason, when the startup
 * error splash appears or the app exits first.
 * @throws {Error} `The editor could not start: <reason>`, `The editor exited during startup (<code>).`, or a timeout.
 */
export async function waitForStartup(app: ElectronApplication, timeout = 120000): Promise<Page> {
  const proc = app.process()
  const deadline = Date.now() + timeout
  for (;;) {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      throw new Error(`The editor exited during startup (${proc.exitCode ?? proc.signalCode}).`)
    }
    const splash = app.windows().find((w) => w.url().includes('error='))
    if (splash) {
      const shown = await splash
        .locator('body')
        .innerText()
        .catch(() => '')
      throw new Error(`The editor could not start: ${shown || new URL(splash.url()).searchParams.get('error')}`)
    }
    const main = app.windows().find((w) => w.url().includes('index.html'))
    if (main && (await mainWindowShown(app).catch(() => false))) {
      await main.waitForLoadState('domcontentloaded')
      return main
    }
    if (Date.now() > deadline) throw new Error(`The editor's main window was not shown within ${timeout} ms.`)
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

/**
 * Launches the editor on `userData` (a new profile by default) and waits until its main window is shown, sized past
 * the mobile breakpoint. Runs `PACKAGED_APP` when set, else the built `main.js`. Closes the app when startup fails,
 * then rethrows.
 */
export async function launchEditor(label: string, userData: string = freshProfile(label)): Promise<EditorSession> {
  if (PACKAGED_APP === '') copyPreload()
  const app = await electron.launch({
    ...(PACKAGED_APP === ''
      ? { args: [MAIN, `--user-data-dir=${userData}`] }
      : { executablePath: PACKAGED_APP, args: [`--user-data-dir=${userData}`] }),
    env: { ...process.env, NODE_ENV: 'production' },
  })
  try {
    const page = await waitForStartup(app)
    if ((await app.evaluate(({ app: electronApp }) => electronApp.isPackaged)) !== (PACKAGED_APP !== '')) {
      throw new Error(`The editor launched is not the one E2E_PACKAGED_APP asks for (${PACKAGED_APP || 'main.js'}).`)
    }
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().includes('index.html'))
      win?.setSize(1500, 950)
    })
    return { app, page }
  } catch (error) {
    await shutdown(app)
    throw error
  }
}

/** One editor per Playwright worker, shared by the worker's tests; each test opens its own new project. */
export const test = base.extend<object, { editor: EditorSession }>({
  editor: [
    async ({}, use) => {
      const session = await launchEditor('worker')
      await use(session)
      await shutdown(session.app)
    },
    { scope: 'worker', timeout: 180000 },
  ],
})

export interface OpenedProject {
  /** The project folder. */
  path: string
  /** The project's name, unique to this test. */
  name: string
}

/**
 * Copies `fixture` to a new folder as a project named `<name>-<suffix>`, unique to the test, and opens it in the
 * running editor the way the native Open Recent menu does. Resolves once the editor shows the project's name.
 */
export async function openNewProject(session: EditorSession, fixture: string, name: string): Promise<OpenedProject> {
  const folder = freshDirectory(name)
  const path = join(folder, 'project')
  cpSync(fixture, path, { recursive: true })
  const unique = `${name}-${folder.slice(-6)}`
  const projectFile = join(path, 'project.json')
  const project: unknown = JSON.parse(readFileSync(projectFile, 'utf8'))
  const meta: unknown = typeof project === 'object' && project !== null ? Reflect.get(project, 'meta') : null
  if (typeof meta !== 'object' || meta === null) throw new Error(`${projectFile} has no meta`)
  Reflect.set(meta, 'name', unique)
  writeFileSync(projectFile, JSON.stringify(project, null, 2))

  const shown = session.page.getByText(unique, { exact: true }).first()
  await expect
    .poll(
      async () => {
        await session.app.evaluate(({ BrowserWindow }, projectPath) => {
          const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'))
          win?.webContents.send('project:open-recent-accelerator', projectPath)
        }, path)
        return shown.waitFor({ timeout: 10000 }).then(
          () => true,
          () => false,
        )
      },
      { timeout: 60000, intervals: [0], message: `the editor never opened ${path}` },
    )
    .toBe(true)
  return { path, name: unique }
}
