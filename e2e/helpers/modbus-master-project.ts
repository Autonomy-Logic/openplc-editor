import type { ChildProcess } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import { _electron as electron, type ElectronApplication, type Page, test, type TestInfo } from '@playwright/test'

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
 * Writes the project, a fresh profile, empty Arduino control files and the e2e baremetal package under the real
 * temp folder.
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

/** How long `launchProject` waits for the project to show in the start screen. */
const LAUNCH_TIMEOUT_MS = 60000

/** How many lines of app output a launch failure quotes. */
const OUTPUT_TAIL_LINES = 40

/** How many distinct caught errors a launch failure quotes. */
const CAUGHT_ERRORS_KEPT = 5

/** How many lines of app output a launch keeps. */
const OUTPUT_KEPT_LINES = 2000

/** The app process kept at launch and the output it wrote since. */
interface LaunchedApp {
  proc: ChildProcess
  output: string[]
}

const launched = new WeakMap<ElectronApplication, LaunchedApp>()

/** A launch that can no longer succeed, with its reason. */
class LaunchFailure extends Error {}

/** The first line of a thrown value's message. */
function firstLine(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split('\n')[0]
}

/** Appends a chunk of output to `output` line by line, keeping the last lines only. */
function appendOutput(output: string[], chunk: string, prefix: string): void {
  for (const line of chunk.split('\n')) {
    if (line.trim() !== '') output.push(`${prefix}${line}`)
  }
  if (output.length > OUTPUT_KEPT_LINES) output.splice(0, output.length - OUTPUT_KEPT_LINES)
}

/** Settles as `step`, or rejects with a timeout error once `ms` elapse first. */
async function within<T>(step: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms)
  })
  try {
    return await Promise.race([step, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Watches a launching app for a process exit, a splash startup error, a renderer crash of the main window or of a
 * window with no page loaded, or the main window closing. Records window URLs, caught errors and page errors.
 */
class LaunchWatch {
  reason: string | undefined
  readonly errors: string[] = []
  readonly urls = new Set<string>()
  readonly crashed = new Set<Page>()
  readonly failed: Promise<never>
  private reject: (error: LaunchFailure) => void = () => undefined
  private readonly pageUrls = new Map<Page, string>()

  constructor(
    app: ElectronApplication,
    private readonly target: LaunchedApp,
  ) {
    this.failed = new Promise<never>((_, reject) => {
      this.reject = reject
    })
    this.failed.catch(() => undefined)
    const { proc } = target
    if (proc.exitCode !== null || proc.signalCode !== null) this.exited(proc.exitCode, proc.signalCode)
    proc.once('exit', (code, signal) => this.exited(code, signal))
    app.on('window', (page) => this.watch(page))
    for (const page of app.windows()) this.watch(page)
  }

  /** Ends the launch with `reason`; the first reason wins. */
  fail(reason: string): void {
    if (this.reason !== undefined) return
    this.reason = reason
    this.reject(new LaunchFailure(reason))
  }

  /** Settles as `step`, or rejects as soon as the launch fails. */
  step<T>(step: Promise<T>): Promise<T> {
    return Promise.race([step, this.failed])
  }

  /** Keeps the first line of an error the launch caught, the last few distinct ones only. */
  caught(error: unknown): void {
    const line = firstLine(error)
    const seen = this.errors.indexOf(line)
    if (seen !== -1) this.errors.splice(seen, 1)
    this.errors.push(line)
    if (this.errors.length > CAUGHT_ERRORS_KEPT) this.errors.shift()
  }

  /** The last URL a page showed, kept after its renderer crashed, or '' when it never loaded one. */
  urlOf(page: Page): string {
    return this.pageUrls.get(page) ?? page.url()
  }

  /** Records a window URL and fails the launch when it is the splash with a startup error. */
  seeUrl(url: string): void {
    if (url === '') return
    this.urls.add(url)
    if (!url.includes('splash')) return
    const error = new URL(url).searchParams.get('error')
    if (error) this.fail(`the editor could not start: ${error}`)
  }

  private exited(code: number | null, signal: NodeJS.Signals | null): void {
    this.fail(`the app process exited with code ${String(code)} and signal ${String(signal)}`)
  }

  private watch(page: Page): void {
    if (this.pageUrls.has(page)) return
    this.pageUrls.set(page, page.url())
    this.seeUrl(page.url())
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame() || frame.url() === '') return
      this.pageUrls.set(page, frame.url())
      this.seeUrl(frame.url())
    })
    page.on('crash', () => {
      this.crashed.add(page)
      const url = this.urlOf(page)
      appendOutput(this.target.output, `renderer crashed: ${url || 'no page loaded'}`, '[window] ')
      if (url.includes('index.html')) this.fail(`the main window renderer crashed (${url})`)
      else if (url === '' || url === 'about:blank') this.fail('a window renderer crashed before it loaded a page')
    })
    page.on('close', () => {
      const url = this.urlOf(page)
      if (url.includes('index.html')) this.fail(`the main window closed (${url})`)
    })
    page.on('pageerror', (error) =>
      appendOutput(this.target.output, `${this.urlOf(page)}: ${error.message}`, '[pageerror] '),
    )
    page.on('console', (message) => {
      if (message.type() === 'error') {
        appendOutput(this.target.output, `${this.urlOf(page)}: ${message.text()}`, '[console] ')
      }
    })
  }
}

/** The running test's info, or `undefined` outside a test. */
function currentTest(): TestInfo | undefined {
  try {
    return test.info()
  } catch {
    return undefined
  }
}

/** The test output folder for a failed launch on `userData`, or `undefined` outside a test. */
function launchFailureDir(userData: string): string | undefined {
  return currentTest()?.outputPath(`launch-failure-${basename(dirname(userData))}`)
}

/**
 * Saves a screenshot of each window whose renderer did not crash, the app trace, the app output and the profile's
 * `logs/` for a failed launch. Returns one line per artifact, saved or not.
 */
async function saveLaunchArtifacts(
  app: ElectronApplication,
  userData: string,
  target: LaunchedApp,
  watch: LaunchWatch,
  tracing: boolean,
): Promise<string[]> {
  const dir = launchFailureDir(userData)
  if (dir === undefined) return ['not saved: no running test']
  mkdirSync(dir, { recursive: true })
  const notes: string[] = []
  const windows = app.windows()
  for (const [index, page] of windows.entries()) {
    const name = `window ${index} (${watch.urlOf(page) || 'no page loaded'})`
    if (watch.crashed.has(page)) {
      notes.push(`${name} renderer crashed, no screenshot`)
      continue
    }
    const path = join(dir, `window-${index}.png`)
    try {
      await within(page.screenshot({ path, timeout: 5000 }), 10000, 'screenshot')
      notes.push(`${name}: ${path}`)
    } catch (error) {
      notes.push(`${name} screenshot not saved: ${firstLine(error)}`)
    }
  }
  if (windows.length === 0) notes.push('no window to screenshot')
  if (tracing) {
    const path = join(dir, 'trace.zip')
    try {
      await within(app.context().tracing.stop({ path }), 15000, 'trace save')
      notes.push(path)
    } catch (error) {
      notes.push(`trace not saved: ${firstLine(error)}`)
    }
  }
  const outputPath = join(dir, 'app-output.txt')
  writeFileSync(outputPath, `${target.output.join('\n')}\n`)
  notes.push(outputPath)
  const logs = join(userData, 'logs')
  if (existsSync(logs)) {
    cpSync(logs, join(dir, 'logs'), { recursive: true })
    notes.push(join(dir, 'logs'))
  } else {
    notes.push(`no ${logs} folder`)
  }
  return notes
}

/** Saves the launch artifacts, stops the app and throws the launch failure with what the watch saw. */
async function failLaunch(
  app: ElectronApplication,
  userData: string,
  target: LaunchedApp,
  watch: LaunchWatch,
  tracing: boolean,
): Promise<never> {
  const artifacts = await saveLaunchArtifacts(app, userData, target, watch, tracing)
  await shutdown(app)
  const tail = target.output.slice(-OUTPUT_TAIL_LINES)
  const earlier = watch.errors.slice(0, -1)
  throw new Error(
    [
      `main window never appeared: ${watch.reason ?? 'unknown reason'}`,
      `Last caught error: ${watch.errors.at(-1) ?? 'none'}`,
      ...(earlier.length > 0 ? ['Earlier caught errors:', ...earlier.map((line) => `  ${line}`)] : []),
      `Window URLs seen: ${watch.urls.size > 0 ? [...watch.urls].join(', ') : 'none'}`,
      `App output, last ${tail.length} lines:`,
      ...tail.map((line) => `  ${line}`),
      'Launch artifacts:',
      ...artifacts.map((line) => `  ${line}`),
    ].join('\n'),
  )
}

/**
 * Launches the built app on `userData`, stubs the signature check once the project history shows and opens the
 * project. Fails at once on an app exit, a splash startup error or a main window crash or close, with the cause,
 * output and artifacts.
 */
export async function launchProject(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [join(__dirname, '..', '..', 'release', 'app', 'dist', 'main', 'main.js'), `--user-data-dir=${userData}`],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  const target: LaunchedApp = { proc: app.process(), output: [] }
  launched.set(app, target)
  target.proc.stdout?.on('data', (chunk: Buffer) => appendOutput(target.output, chunk.toString(), ''))
  target.proc.stderr?.on('data', (chunk: Buffer) => appendOutput(target.output, chunk.toString(), '[stderr] '))
  const watch = new LaunchWatch(app, target)
  const deadline = Date.now() + LAUNCH_TIMEOUT_MS
  const left = () => Math.max(1, deadline - Date.now())
  let tracing = false

  const traceStart = app.context().tracing.start({ screenshots: true, snapshots: true })
  void traceStart.then(
    () => (tracing = true),
    () => undefined,
  )
  try {
    await watch.step(within(traceStart, left(), 'trace start'))
    tracing = true
  } catch (error) {
    if (!(error instanceof LaunchFailure)) watch.caught(`trace not started: ${firstLine(error)}`)
  }

  try {
    while (watch.reason === undefined && Date.now() < deadline) {
      const urls = await watch
        .step(
          within(
            app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.webContents.getURL())),
            left(),
            'window list',
          ),
        )
        .catch((error: unknown) => {
          if (error instanceof LaunchFailure) throw error
          if (Date.now() < deadline) watch.caught(error)
          return []
        })
      for (const url of urls) watch.seeUrl(url)
      const main = app.windows().find((w) => !w.isClosed() && watch.urlOf(w).includes('index.html'))
      if (main) {
        try {
          const project = main.getByText(PROJECT_NAME, { exact: true }).first()
          await watch.step(main.waitForLoadState('domcontentloaded', { timeout: left() }))
          await watch.step(project.waitFor({ timeout: left() }))
          await watch.step(
            within(
              app.evaluate(({ ipcMain }) => {
                ipcMain.removeHandler('packages:verify-signatures')
                ipcMain.handle('packages:verify-signatures', () => [])
              }),
              left(),
              'signature stub',
            ),
          )
          await watch.step(project.click({ timeout: left() }))
          if (tracing) await app.context().tracing.stop()
          return { app, page: main }
        } catch (error) {
          if (error instanceof LaunchFailure) throw error
          watch.caught(error)
        }
      }
      await watch.step(new Promise((r) => setTimeout(r, Math.min(500, left()))))
    }
    watch.fail(`the project did not show in the main window within ${LAUNCH_TIMEOUT_MS / 1000} s`)
  } catch (error) {
    if (!(error instanceof LaunchFailure)) watch.fail(`the launch threw: ${firstLine(error)}`)
  }
  return failLaunch(app, userData, target, watch, tracing)
}

/**
 * Kills the app process kept at launch and waits for it to exit. An app that had already exited is recorded,
 * with its exit code and signal, as a test annotation and on stderr.
 */
export async function shutdown(app: ElectronApplication): Promise<void> {
  const proc = launched.get(app)?.proc ?? app.process()
  if (proc.exitCode !== null || proc.signalCode !== null) {
    const description = `the app had already exited with code ${String(proc.exitCode)} and signal ${String(proc.signalCode)}`
    process.stderr.write(`${description}\n`)
    currentTest()?.annotations.push({ type: 'app-exit', description })
    return
  }
  const exited = new Promise((resolve) => proc.once('exit', resolve))
  proc.kill('SIGKILL')
  await exited
}

/** Sends the save accelerator to the main window. */
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
