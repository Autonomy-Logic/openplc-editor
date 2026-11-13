import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { _electron as electron } from '@playwright/test'

const MAIN = join(__dirname, '..', '..', 'release', 'app', 'dist', 'main', 'main.js')

/** Writes a user profile whose recent projects list holds `projectPath` under `projectName`. */
export function writeProfile(userData: string, projectName: string, projectPath: string): void {
  const history = join(userData, 'User', 'History')
  mkdirSync(history, { recursive: true })
  writeFileSync(
    join(history, 'projects.json'),
    JSON.stringify([
      {
        name: projectName,
        path: projectPath,
        projectFilePath: join(projectPath, 'project.json'),
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
}

/** Writes the device files of an OpenPLC Runtime v3 project. */
export function writeRuntimeDevice(projectPath: string): void {
  mkdirSync(join(projectPath, 'devices'), { recursive: true })
  writeFileSync(
    join(projectPath, 'devices', 'configuration.json'),
    JSON.stringify({
      deviceBoard: 'OpenPLC Runtime v3',
      communicationPort: '',
      runtimeIpAddress: '',
      selectedPlatformOptions: {},
    }),
  )
  writeFileSync(join(projectPath, 'devices', 'pin-mapping.json'), '{}')
}

/** Kills the app process and waits for it to exit. */
export async function shutdown(app: ElectronApplication): Promise<void> {
  const proc = app.process()
  if (proc.exitCode !== null) return
  const exited = new Promise((resolve) => proc.once('exit', resolve))
  proc.kill('SIGKILL')
  await exited
}

/** Launches the built app on `userData` and returns its main window, sized past the mobile breakpoint. */
export async function launch(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [MAIN, `--user-data-dir=${userData}`],
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
            win?.setSize(1500, 950)
          })
          return { app, page: w }
        }
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  await shutdown(app)
  throw new Error('main window never appeared')
}

/** Sends the Save Project accelerator; it is a native menu accelerator, which Playwright's keyboard never reaches. */
export const saveProject = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'))
    win?.webContents.send('project:save-accelerator')
  })

/** Collects the renderer's uncaught errors and makes a wait fail as soon as one is thrown. */
export class RendererErrors {
  readonly messages: string[] = []
  private failure: Promise<never>

  constructor(page: Page) {
    this.failure = new Promise<never>((_, reject) => {
      page.on('pageerror', (error) => {
        this.messages.push(error.message)
        reject(error)
      })
    })
    this.failure.catch(() => undefined)
  }

  /** Waits for `locator`, rejecting with the renderer's error if one is thrown first. */
  async waitFor(locator: Locator, timeout = 30000): Promise<void> {
    await Promise.race([locator.waitFor({ timeout }), this.failure])
  }

  /** Runs `check`, rejecting with the renderer's error if one is thrown first. */
  async race<T>(check: Promise<T>): Promise<T> {
    return Promise.race([check, this.failure])
  }
}

/** Clicks the centre of the topmost match, the way a user's click lands. */
export async function clickTop(page: Page, locator: Locator): Promise<void> {
  const box = await locator.last().boundingBox()
  if (!box) throw new Error('nothing to click')
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}
