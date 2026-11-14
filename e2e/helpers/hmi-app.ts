/**
 * The built editor with an HMI project, for the HMI e2e specs: the fixture on disk, launching the app on it, and the
 * waits and gestures the designer needs. Every wait also reads the app's own error text and fails at once when the
 * app reports one.
 */
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from '@playwright/test'

/** Where one spec keeps its project, user data and screenshots. */
export interface HmiFixture {
  root: string
  project: string
  userData: string
  shots: string
  name: string
}

/** What the fixture project holds besides the HMI files. */
export interface HmiProject {
  /** ST of the Main program. */
  main: string
  globals?: Array<{ name: string; type: string; initialValue?: string }>
  screens: Record<string, string>
  widgets?: Record<string, string>
  startScreen: string
}

const APP_FAILURES = [/Failed to open project/i, /Something went wrong/i, /could not be loaded/i]

export function hmiFixture(name: string): HmiFixture {
  const root = join(realpathSync(tmpdir()), `openplc-e2e-${name}`)
  return { root, project: join(root, 'project'), userData: join(root, 'userdata'), shots: join(root, 'shots'), name }
}

export function writeHmiFixture(f: HmiFixture, project: HmiProject): void {
  rmSync(f.root, { recursive: true, force: true })
  mkdirSync(join(f.project, 'devices'), { recursive: true })
  mkdirSync(join(f.project, 'pous', 'programs'), { recursive: true })
  mkdirSync(join(f.project, 'hmi', 'widgets'), { recursive: true })
  mkdirSync(f.shots, { recursive: true })
  writeFileSync(
    join(f.project, 'project.json'),
    JSON.stringify({
      meta: { name: f.name, type: 'plc-project' },
      data: {
        dataTypes: [],
        pous: [],
        configuration: {
          resource: {
            tasks: [{ name: 'task0', triggering: 'Cyclic', interval: 'T#20ms', priority: 1 }],
            instances: [{ name: 'instance0', program: 'Main', task: 'task0' }],
            globalVariables: (project.globals ?? []).map((g) => ({
              name: g.name,
              type: { definition: 'base-type', value: g.type },
              location: '',
              documentation: '',
              initialValue: g.initialValue ?? '',
            })),
          },
        },
        libraries: [],
        debugVariables: { global: [], pous: {} },
      },
    }),
  )
  writeFileSync(
    join(f.project, 'devices', 'configuration.json'),
    JSON.stringify({
      deviceBoard: 'OpenPLC Runtime v4',
      communicationPort: '',
      runtimeIpAddress: '',
      selectedPlatformOptions: {},
    }),
  )
  writeFileSync(join(f.project, 'devices', 'pin-mapping.json'), '{}')
  writeFileSync(join(f.project, 'pous', 'programs', 'Main.st'), project.main)
  for (const [name, source] of Object.entries(project.screens))
    writeFileSync(join(f.project, 'hmi', `${name}.st`), source)
  for (const [name, source] of Object.entries(project.widgets ?? {}))
    writeFileSync(join(f.project, 'hmi', 'widgets', `${name}.st`), source)
  writeFileSync(join(f.project, 'hmi', 'settings.json'), JSON.stringify({ startScreen: project.startScreen }))
  const history = join(f.userData, 'User', 'History')
  mkdirSync(history, { recursive: true })
  writeFileSync(
    join(history, 'projects.json'),
    JSON.stringify([
      {
        name: f.name,
        path: f.project,
        projectFilePath: join(f.project, 'project.json'),
        createdAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
      },
    ]),
  )
  writeFileSync(join(history, 'libraries.json'), '[]')
  const runtime = join(f.userData, 'User', 'Runtime')
  mkdirSync(runtime, { recursive: true })
  writeFileSync(join(runtime, 'arduino-core-control.json'), '[]')
  writeFileSync(join(runtime, 'arduino-library-control.json'), '[]')
}

/** Starts the built app on the fixture's user data and returns its main window. */
export async function launchHmiApp(f: HmiFixture): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [join(__dirname, '..', '..', 'release', 'app', 'dist', 'main', 'main.js'), `--user-data-dir=${f.userData}`],
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
        /* window is closing */
      }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('main window never appeared')
}

async function failIfAppReportedFailure(page: Page): Promise<void> {
  const text = await page.locator('body').innerText()
  const failure = APP_FAILURES.find((pattern) => pattern.test(text))
  if (failure)
    throw new Error(
      `the app reported a failure: ${text
        .split('\n')
        .filter((l) => failure.test(l))
        .join(' | ')}`,
    )
}

/** Polls `check` until it holds; on time-out saves a screenshot and reports the designer's errors. */
export async function waitFor(
  f: HmiFixture,
  page: Page,
  what: string,
  check: () => Promise<boolean>,
  timeoutMs = 30000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await failIfAppReportedFailure(page)
    if (await check()) return
    await page.waitForTimeout(250)
  }
  await page.screenshot({ path: join(f.shots, 'timeout.png') })
  const errors = await page.getByTestId('hmi-errors').allInnerTexts()
  throw new Error(`timed out waiting for ${what}${errors.length ? `; designer errors: ${errors.join(' | ')}` : ''}`)
}

/** A project tree leaf by its name, unsaved or not. */
export const leaf = (page: Page, name: string) =>
  page.locator('li.group').filter({ has: page.getByText(new RegExp(`^(\\* )?${name}$`)) })

/** The preview's state, `<status> <build ms>`, from the visible canvas area. */
export const status = async (page: Page): Promise<string> =>
  (await page.locator('[data-testid="hmi-canvas-area"]:visible').first().getAttribute('data-preview')) ?? ''

/** Selects an element through the Layers tab. */
export async function pickLayer(page: Page, name: string): Promise<void> {
  await page.getByTestId('hmi-palette-tab-layers').click()
  await page.getByTestId(`hmi-outline-${name}`).click()
}

/** The selected element's property field, on whichever tab of the properties card holds it. */
export async function propertyField(page: Page, name: string) {
  const field = page.getByTestId(`hmi-prop-${name}`)
  for (const tab of ['data', 'style', 'layout']) {
    await page.getByTestId(`hmi-prop-tab-${tab}`).click()
    if (await field.isVisible()) return field
  }
  throw new Error(`no property ${name} on the properties card`)
}

const sendToWindow = (app: ElectronApplication, channel: string) =>
  app.evaluate(({ BrowserWindow }, name) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'))
    win?.webContents.send(name)
  }, channel)

export const save = (app: ElectronApplication) => sendToWindow(app, 'project:save-accelerator')
export const undo = (app: ElectronApplication) => sendToWindow(app, 'edit:undo-request')

/**
 * Drags a palette item onto the canvas with the DOM's drag events: Playwright's own drag does not reach HTML5 drag and
 * drop in an Electron window, while these run the same handlers a user's drag does.
 */
export async function htmlDrag(page: Page, sourceTestId: string, x: number, y: number): Promise<void> {
  await page.evaluate(
    ({ source, x, y }) => {
      const from = document.querySelector(`[data-testid="${source}"]`)
      const to = document.querySelector('[data-testid="hmi-canvas-overlay"]')
      if (!from || !to) throw new Error(`cannot drag ${source}`)
      const rect = to.getBoundingClientRect()
      const at = { clientX: rect.left + x, clientY: rect.top + y, bubbles: true, cancelable: true }
      const dataTransfer = new DataTransfer()
      from.dispatchEvent(new DragEvent('dragstart', { dataTransfer, bubbles: true }))
      to.dispatchEvent(new DragEvent('dragenter', { ...at, dataTransfer }))
      to.dispatchEvent(new DragEvent('dragover', { ...at, dataTransfer }))
      to.dispatchEvent(new DragEvent('drop', { ...at, dataTransfer }))
      from.dispatchEvent(new DragEvent('dragend', { dataTransfer, bubbles: true }))
    },
    { source: sourceTestId, x, y },
  )
}

export const screenOnDisk = (f: HmiFixture, name: string) => readFileSync(join(f.project, 'hmi', `${name}.st`), 'utf-8')

/** The ST view's text: Monaco renders spaces as non-breaking spaces. */
export const codeText = async (page: Page) =>
  (await page.locator('[data-testid="hmi-code-editor"] .view-lines:visible').innerText()).replace(/ /g, ' ')

/** The centre of an element on the page; fails when it is not shown. */
export async function centre(page: Page, testId: string): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId(testId).boundingBox()
  if (!box) throw new Error(`${testId} is not on the page`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}
