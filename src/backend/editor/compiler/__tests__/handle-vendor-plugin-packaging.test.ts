/**
 * `CompilerModule.handleVendorPluginPackaging` — prebuilt vs source
 * provisioning branch.
 *
 * The packager treats `hal.pluginEntry` differently depending on
 * `hal.provisioning`:
 *   - "prebuilt": pluginEntry IS the directory holding the precompiled
 *     `.o` objects + link-only Makefile — copied verbatim.
 *   - source (default / absent): pluginEntry is the entry source FILE,
 *     so the directory to copy is its parent.
 *
 * We drive the real method against a temp filesystem, mocking only the
 * package manager (which board/manifest it sees) and electron (so the
 * module import doesn't try to reach the Electron app at load time).
 * The method doesn't touch `this`, so we invoke it via the prototype
 * and skip the constructor entirely.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// The module calls `electronApp.getPath(...)` in its constructor; we never
// construct it here, but the top-level `import electron` still has to resolve.
jest.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  dialog: {},
  MessageChannelMain: class {},
}))

type FindVppDevice = typeof import('../../../shared/hardware/find-vpp-device')

const listInstalled = jest.fn()
const getInstalledPackageManifest = jest.fn()
// The build-time integrity gate (DOPE-539). Defaults to "intact" so the
// provisioning tests below exercise the packaging behaviour they are about; the
// refusal case overrides it explicitly.
const verifyBoardPackageIntegrity = jest.fn<{ ok: boolean; packageId?: string; reason?: string }, [string]>(() => ({
  ok: true,
}))
jest.mock('../../package-manager', () => ({
  formatPackageIntegrityError: (boardName: string, failure: { packageId: string; reason: string }) =>
    `Board "${boardName}" is provided by the VPP package "${failure.packageId}", which no longer matches its signature: ${failure.reason}.`,
  PackageManagerModule: jest.fn().mockImplementation(() => {
    const port = { listInstalled, getInstalledPackageManifest }
    return {
      ...port,
      verifyBoardPackageIntegrity,
      // Board lookup runs through the shared `findVppDeviceByBoardName`, and
      // the mock runs the real one over these two stubs rather than
      // re-implementing the search — a stub that resolved boards its own way
      // would let the production lookup change without a test noticing.
      // `require` (not a top-level import) because jest.mock factories are
      // hoisted above the import block.
      findDeviceByBoardName: (boardName: string) =>
        (jest.requireActual('../../../shared/hardware/find-vpp-device') as FindVppDevice).findVppDeviceByBoardName(
          port,
          boardName,
        ),
    }
  }),
}))

// eslint-disable-next-line import/first
import { CompilerModule } from '../compiler-module'

type LogEntry = { message: string; level: string }

const BOARD = 'Raspberry Pi (prebuilt test)'

const handler = CompilerModule.prototype.handleVendorPluginPackaging

function makeManifest(hal: Record<string, unknown>) {
  return {
    devices: [
      {
        name: BOARD,
        target: { type: 'runtime-v4' },
        hal,
        moduleSystem: undefined,
      },
    ],
  }
}

/** Writes a plugin directory with two payload files + an excluded one. */
function writePluginDir(pkgDir: string): string {
  const pluginDir = join(pkgDir, 'hal', 'runtime-v4', 'plugin')
  mkdirSync(pluginDir, { recursive: true })
  writeFileSync(join(pluginDir, 'rpi_plugin.o'), 'OBJECT-BYTES')
  writeFileSync(join(pluginDir, 'Makefile'), 'all:\n\techo link\n')
  // Excluded by the packager — must not be copied into vpp_plugin/.
  writeFileSync(join(pluginDir, 'config_template.json'), JSON.stringify({ plugin_name: 'rpi_gpio', pins: [] }))
  return pluginDir
}

describe('handleVendorPluginPackaging — provisioning branch', () => {
  let pkgDir: string
  let projectDir: string
  let targetDir: string
  let logs: LogEntry[]

  const runFor = (hal: Record<string, unknown>) => {
    listInstalled.mockReturnValue([{ packageId: 'com.openplc.rpi', path: pkgDir }])
    getInstalledPackageManifest.mockReturnValue(makeManifest(hal))
    return handler.call(
      {} as CompilerModule,
      BOARD,
      projectDir,
      targetDir,
      (message: string | Buffer, level?: string) => {
        logs.push({ message: String(message), level: level ?? '' })
      },
    )
  }

  beforeEach(() => {
    jest.clearAllMocks()
    pkgDir = mkdtempSync(join(tmpdir(), 'vpp-pkg-'))
    projectDir = mkdtempSync(join(tmpdir(), 'vpp-proj-'))
    targetDir = mkdtempSync(join(tmpdir(), 'vpp-target-'))
    logs = []
    writePluginDir(pkgDir)
  })

  afterEach(() => {
    for (const dir of [pkgDir, projectDir, targetDir]) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('treats pluginEntry as a directory when provisioning is "prebuilt"', async () => {
    await runFor({
      type: 'runtime-v4-plugin',
      pluginType: 'native',
      provisioning: 'prebuilt',
      pluginEntry: 'hal/runtime-v4/plugin',
      configTemplate: 'hal/runtime-v4/plugin/config_template.json',
    })

    const dest = join(targetDir, 'vpp_plugin')
    expect(existsSync(join(dest, 'rpi_plugin.o'))).toBe(true)
    expect(existsSync(join(dest, 'Makefile'))).toBe(true)
    // Excluded file is never copied.
    expect(existsSync(join(dest, 'config_template.json'))).toBe(false)
    // Deterministic integrity checksum is emitted.
    expect(existsSync(join(dest, 'checksum.sha256'))).toBe(true)
    // The summary log distinguishes the prebuilt path.
    expect(logs.some((l) => /prebuilt file\(s\)/.test(l.message))).toBe(true)
  })

  it('treats pluginEntry as a file and copies its parent dir in source mode (provisioning absent)', async () => {
    // Source-mode pluginEntry points at the entry FILE; the directory to copy
    // is its parent — the same plugin dir, reached via dirname().
    writeFileSync(join(pkgDir, 'hal', 'runtime-v4', 'plugin', 'rpi_plugin.c'), 'int main(){}')

    await runFor({
      type: 'runtime-v4-plugin',
      pluginType: 'native',
      pluginEntry: 'hal/runtime-v4/plugin/rpi_plugin.c',
      configTemplate: 'hal/runtime-v4/plugin/config_template.json',
    })

    const dest = join(targetDir, 'vpp_plugin')
    expect(existsSync(join(dest, 'rpi_plugin.c'))).toBe(true)
    expect(existsSync(join(dest, 'Makefile'))).toBe(true)
    expect(existsSync(join(dest, 'config_template.json'))).toBe(false)
    expect(logs.some((l) => /source file\(s\)/.test(l.message))).toBe(true)
  })

  it('refuses to copy the payload when the package no longer matches its signature', async () => {
    // DOPE-539: this step is re-gated because it runs minutes after the
    // compile-entry check, and what it copies is compiled on the live PLC.
    // A throw is the contract — `packageVppPlugin` in the platform port turns
    // it into the `errors[]` the pipeline bails on, whereas a logged error
    // would let the build upload a bundle with no vendor I/O.
    verifyBoardPackageIntegrity.mockReturnValueOnce({
      ok: false,
      packageId: 'com.openplc.rpi',
      reason: 'Tampered file detected: hal/runtime-v4/plugin/rpi_plugin.o',
    })

    await expect(
      runFor({
        type: 'runtime-v4-plugin',
        pluginType: 'native',
        provisioning: 'prebuilt',
        pluginEntry: 'hal/runtime-v4/plugin',
        configTemplate: 'hal/runtime-v4/plugin/config_template.json',
      }),
    ).rejects.toThrow(/com\.openplc\.rpi/)

    expect(existsSync(join(targetDir, 'vpp_plugin'))).toBe(false)
    expect(logs.some((l) => l.level === 'error' && /rpi_plugin\.o/.test(l.message))).toBe(true)
  })

  it('copies the payload byte-for-byte (prebuilt object content preserved)', async () => {
    await runFor({
      type: 'runtime-v4-plugin',
      pluginType: 'native',
      provisioning: 'prebuilt',
      pluginEntry: 'hal/runtime-v4/plugin',
      configTemplate: 'hal/runtime-v4/plugin/config_template.json',
    })

    const copied = readFileSync(join(targetDir, 'vpp_plugin', 'rpi_plugin.o'), 'utf-8')
    expect(copied).toBe('OBJECT-BYTES')
  })
})
