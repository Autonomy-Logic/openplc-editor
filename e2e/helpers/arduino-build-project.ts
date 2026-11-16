import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir, platform, tmpdir } from 'node:os'
import { join } from 'node:path'

import { type ElectronApplication, expect, type Page } from '@playwright/test'

/** The editor profile whose arduino-cli folder and board packages the specs borrow. */
export const SOURCE_USER_DATA =
  process.env.OPENPLC_E2E_SOURCE_USER_DATA ??
  (platform() === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', 'open-plc-editor')
    : platform() === 'win32'
      ? join(process.env.APPDATA ?? '', 'open-plc-editor')
      : join(homedir(), '.config', 'open-plc-editor'))

export interface BoardFixture {
  board: string
  packageId: string
  vendorScreenData?: Record<string, unknown>
}

export const SLM_CPU_0: BoardFixture = {
  board: 'SLM-CPU-0',
  packageId: 'com.synergy-logic.slm-rp4',
  vendorScreenData: {
    network: {
      enabled: true,
      interface: 'Ethernet',
      enable_dhcp: false,
      subnet: '255.255.255.0',
      ip_address: '192.168.1.100',
      gateway: '192.168.1.1',
      dns: '8.8.8.8',
    },
    'module-configuration': { slots: [null, null, null, null, null, null, null, null], slotsConfig: {} },
    'io-mapping': { entries: [] },
  },
}

export const ARDUINO_MEGA: BoardFixture = { board: 'Arduino Mega', packageId: 'com.openplc.arduino' }

export const PROJECT_NAME = 'incremental-build'

const PROGRAM = 'PROGRAM main\n  VAR\n    counter : INT;\n  END_VAR\n\ncounter := counter + 1;\n\nEND_PROGRAM\n'
const EXTRA_FB =
  'FUNCTION_BLOCK extra_fb\n  VAR_INPUT\n    x : INT;\n  END_VAR\n  VAR_OUTPUT\n    y : INT;\n  END_VAR\n\ny := x * 2;\n\nEND_FUNCTION_BLOCK\n'

/** Why a spec cannot run on this machine, or undefined when it can. */
export function missingPrerequisite(fixture: BoardFixture): string | undefined {
  if (!existsSync(join(SOURCE_USER_DATA, 'arduino', 'data'))) return `no arduino-cli data folder in ${SOURCE_USER_DATA}`
  if (!existsSync(join(SOURCE_USER_DATA, 'packages', fixture.packageId)))
    return `board package ${fixture.packageId} is not installed in ${SOURCE_USER_DATA}`
  return undefined
}

export interface ArduinoProject {
  project: string
  userData: string
  buildDir: string
  sketchDir: string
}

/**
 * Writes a one-program project for @p fixture with its board package installed. `arduino`
 * 'shared' borrows this machine's installed cores and libraries; 'empty' starts with none.
 */
export function writeArduinoProject(
  name: string,
  fixture: BoardFixture,
  arduino: 'shared' | 'empty' = 'shared',
): ArduinoProject {
  const root = join(realpathSync(tmpdir()), name)
  const project = join(root, 'project')
  const userData = join(root, 'userdata')
  rmSync(root, { recursive: true, force: true })
  mkdirSync(join(project, 'pous', 'programs'), { recursive: true })
  mkdirSync(join(project, 'pous', 'function-blocks'), { recursive: true })
  mkdirSync(join(project, 'devices'), { recursive: true })
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
      deviceBoard: fixture.board,
      communicationPort: '',
      runtimeIpAddress: '192.168.1.100',
      vendorScreenData: fixture.vendorScreenData ?? {},
      selectedPlatformOptions: {},
    }),
  )
  writeFileSync(join(project, 'devices', 'pin-mapping.json'), '{}')
  writeFileSync(join(project, 'pous', 'programs', 'main.st'), PROGRAM)
  writeFileSync(join(project, 'pous', 'function-blocks', 'extra_fb.st'), EXTRA_FB)

  mkdirSync(userData, { recursive: true })
  if (arduino === 'shared') {
    symlinkSync(join(SOURCE_USER_DATA, 'arduino'), join(userData, 'arduino'))
  } else {
    mkdirSync(join(userData, 'arduino', 'data'), { recursive: true })
  }

  const packages = join(userData, 'packages')
  mkdirSync(packages, { recursive: true })
  cpSync(join(SOURCE_USER_DATA, 'packages', fixture.packageId), join(packages, fixture.packageId), { recursive: true })
  const registry = JSON.parse(readFileSync(join(SOURCE_USER_DATA, 'packages', 'registry.json'), 'utf-8')) as {
    formatVersion: number
    packages: Record<string, Record<string, unknown>>
  }
  writeFileSync(
    join(packages, 'registry.json'),
    JSON.stringify({
      formatVersion: registry.formatVersion,
      packages: {
        [fixture.packageId]: { ...registry.packages[fixture.packageId], path: join(packages, fixture.packageId) },
      },
    }),
  )

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
  for (const control of ['arduino-core-control.json', 'arduino-library-control.json']) {
    const source = join(SOURCE_USER_DATA, 'User', 'Runtime', control)
    if (existsSync(source)) copyFileSync(source, join(runtime, control))
    else writeFileSync(join(runtime, control), '[]')
  }

  const buildDir = join(project, 'build', fixture.board)
  return { project, userData, buildDir, sketchDir: join(buildDir, 'examples', 'Baremetal') }
}

/** Modification time of @p path, or 0 when it does not exist. */
export function mtimeOf(path: string): number {
  return existsSync(path) ? statSync(path).mtimeMs : 0
}

/** The linked firmware the build exported, under the sketch folder. */
export function elfPath(sketchDir: string): string | undefined {
  const exportDir = join(sketchDir, 'build')
  if (!existsSync(exportDir)) return undefined
  for (const fqbn of readdirSync(exportDir)) {
    const elf = join(exportDir, fqbn, 'Baremetal.ino.elf')
    if (existsSync(elf)) return elf
  }
  return undefined
}

/** arduino-cli's build cache folder for @p sketchDir, found through its build.options.json. */
export function arduinoCacheDir(sketchDir: string): string | undefined {
  const base =
    platform() === 'darwin'
      ? join(homedir(), 'Library', 'Caches', 'arduino', 'sketches')
      : platform() === 'win32'
        ? join(process.env.LOCALAPPDATA ?? '', 'arduino', 'sketches')
        : join(homedir(), '.cache', 'arduino', 'sketches')
  if (!existsSync(base)) return undefined
  for (const entry of readdirSync(base)) {
    const options = join(base, entry, 'build.options.json')
    if (!existsSync(options)) continue
    try {
      const parsed = JSON.parse(readFileSync(options, 'utf-8')) as { sketchLocation?: string }
      if (parsed.sketchLocation !== undefined && realpathSync(parsed.sketchLocation) === realpathSync(sketchDir))
        return join(base, entry)
    } catch {
      /* unreadable options file: not this sketch */
    }
  }
  return undefined
}

/** Modification times of every object file under @p dir, keyed by path. */
export function objectTimes(dir: string): Map<string, number> {
  const times = new Map<string, number>()
  if (!existsSync(dir)) return times
  for (const entry of readdirSync(dir, { recursive: true }) as string[]) {
    if (entry.endsWith('.o')) times.set(entry, statSync(join(dir, entry)).mtimeMs)
  }
  return times
}

/** Opens Build options, picks @p option, and waits until a new firmware has been linked. */
export async function buildAndWait(page: Page, sketchDir: string, option: string, timeout = 600000): Promise<void> {
  const before = mtimeOf(elfPath(sketchDir) ?? '')
  await page.getByRole('button', { name: 'Build options' }).click({ timeout: 30000 })
  await page.getByText(option, { exact: true }).click({ timeout: 15000 })
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const elf = elfPath(sketchDir)
    if (elf !== undefined && mtimeOf(elf) > before) break
    await new Promise((r) => setTimeout(r, 1000))
  }
  if (mtimeOf(elfPath(sketchDir) ?? '') <= before) throw new Error(`no new firmware after "${option}"`)
  await expect(page.getByRole('button', { name: 'Build options' })).toBeEnabled({ timeout: 120000 })
}

type CompileArgsHolder = { __lastCompileArgs?: unknown[] }

/** Records the project data each build sends, so a test can replay it into the debug compile. */
export async function recordCompileArgs(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    ipcMain.on('compiler:run-compile-program', (_event, args: unknown[]) => {
      ;(globalThis as CompileArgsHolder).__lastCompileArgs = args
    })
  })
}

/**
 * Runs the debug compile a debugger session starts, with the project data of the last build,
 * and resolves with its final message.
 */
export function runDebugCompile(app: ElectronApplication): Promise<string> {
  return app.evaluate(
    ({ ipcMain, MessageChannelMain }) =>
      new Promise<string>((resolve) => {
        const args = (globalThis as CompileArgsHolder).__lastCompileArgs
        if (!args) {
          resolve('no build was recorded')
          return
        }
        const { port1, port2 } = new MessageChannelMain()
        port2.on('message', ({ data }: { data: { message?: string } }) => {
          const message = data.message ?? ''
          if (/completed successfully|Stopping debug compilation/.test(message)) resolve(message)
        })
        port2.start()
        ipcMain.emit('compiler:run-debug-compilation', { ports: [port1] }, [args[0], args[1], args[4]])
      }),
  )
}
