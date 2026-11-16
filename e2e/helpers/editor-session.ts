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
import { join } from 'node:path'

import { test as base, type ElectronApplication, expect, type Page } from '@playwright/test'

import { launch, shutdown } from './electron-editor'

const RELEASE_APP = join(__dirname, '..', '..', 'release', 'app')

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

/** Launches the built editor on a new profile and waits until its main window is shown. */
export async function launchEditor(label: string): Promise<EditorSession> {
  copyPreload()
  const session = await launch(freshProfile(label))
  await expect.poll(() => mainWindowShown(session.app), { timeout: 120000 }).toBe(true)
  return session
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
