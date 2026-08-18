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

// hals.json stand-in for the built-in-target check in the licensing-gate
// warning (Thiago's review of #1014): the warning must stay silent for a
// board hals.json knows (the plain "OpenPLC Runtime" build) and fire only
// for a board known to neither store. Tests flip `current` per case.
const halsFileContent: { current: Record<string, unknown> } = { current: {} }
jest.mock('@root/backend/shared/firmware/hals-loader', () => ({
  readHalsFile: jest.fn(async () => halsFileContent.current),
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

function makeManifest(hal: Record<string, unknown>, capabilities?: Record<string, unknown>) {
  return {
    devices: [
      {
        name: BOARD,
        target: { type: 'runtime-v4' },
        hal,
        capabilities,
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

  const runFor = (hal: Record<string, unknown>, capabilities?: Record<string, unknown>) => {
    listInstalled.mockReturnValue([{ packageId: 'com.openplc.rpi', path: pkgDir }])
    getInstalledPackageManifest.mockReturnValue(makeManifest(hal, capabilities))
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

  // ---------------------------------------------------------------------
  // Trusted-keys branch — licensable VPPs get a generated trusted_keys.c
  // in the plugin link set; a licensable package without a usable
  // trusted_keys.json is a packaging fault that stops the build.
  // ---------------------------------------------------------------------

  const PREBUILT_HAL = {
    type: 'runtime-v4-plugin',
    pluginType: 'native',
    provisioning: 'prebuilt',
    pluginEntry: 'hal/runtime-v4/plugin',
    configTemplate: 'hal/runtime-v4/plugin/config_template.json',
  }
  /** 128 hex chars — 64 bytes of 0xab. */
  const HEX_KEY = 'ab'.repeat(64)

  it('generates trusted_keys.c into the link set for a licensable device', async () => {
    writeFileSync(join(pkgDir, 'trusted_keys.json'), JSON.stringify({ keys: [{ keyId: 0, pubKeyRawHex: HEX_KEY }] }))

    await runFor(PREBUILT_HAL, { isLicensable: true })

    const generated = readFileSync(join(targetDir, 'vpp_plugin', 'trusted_keys.c'), 'utf-8')
    expect(generated).toContain('const uint8_t LIC_TRUSTED_KEYS[][64] = {')
    expect(generated).toContain('const uint8_t LIC_TRUSTED_KEY_COUNT = 1;')
    expect(logs.some((l) => l.level === 'info' && /Trusted-keys table generated/.test(l.message))).toBe(true)
  })

  it('folds the generated table into the plugin checksum (key rotation forces a device rebuild)', async () => {
    writeFileSync(join(pkgDir, 'trusted_keys.json'), JSON.stringify({ keys: [{ keyId: 0, pubKeyRawHex: HEX_KEY }] }))
    await runFor(PREBUILT_HAL, { isLicensable: true })
    const checksumBefore = readFileSync(join(targetDir, 'vpp_plugin', 'checksum.sha256'), 'utf-8')

    // Same plugin payload, different key table — the checksum MUST move,
    // or the runtime's compile.sh would skip the rebuild and the device
    // would keep validating blobs against the previous table.
    writeFileSync(
      join(pkgDir, 'trusted_keys.json'),
      JSON.stringify({ keys: [{ keyId: 0, pubKeyRawHex: 'cd'.repeat(64) }] }),
    )
    await runFor(PREBUILT_HAL, { isLicensable: true })
    const checksumAfter = readFileSync(join(targetDir, 'vpp_plugin', 'checksum.sha256'), 'utf-8')

    expect(checksumAfter).not.toBe(checksumBefore)
  })

  it('stops the build when a licensable package has no trusted_keys.json', async () => {
    await expect(runFor(PREBUILT_HAL, { isLicensable: true })).rejects.toThrow(/com\.openplc\.rpi/)

    // Fails BEFORE anything lands in the bundle — no partial plugin upload.
    expect(existsSync(join(targetDir, 'vpp_plugin'))).toBe(false)
    expect(logs.some((l) => l.level === 'error' && /packaging fault/.test(l.message))).toBe(true)
  })

  it('stops the build when the trusted_keys.json is malformed', async () => {
    writeFileSync(join(pkgDir, 'trusted_keys.json'), JSON.stringify({ keys: [] }))

    await expect(runFor(PREBUILT_HAL, { isLicensable: true })).rejects.toThrow(/at least one signing key/)
    expect(existsSync(join(targetDir, 'vpp_plugin'))).toBe(false)
  })

  it('generates no trusted_keys.c for a non-licensable device, even when the json exists', async () => {
    writeFileSync(join(pkgDir, 'trusted_keys.json'), JSON.stringify({ keys: [{ keyId: 0, pubKeyRawHex: HEX_KEY }] }))

    await runFor(PREBUILT_HAL)

    expect(existsSync(join(targetDir, 'vpp_plugin', 'rpi_plugin.o'))).toBe(true)
    expect(existsSync(join(targetDir, 'vpp_plugin', 'trusted_keys.c'))).toBe(false)
  })

  const runWithEmptyStore = () => {
    listInstalled.mockReturnValue([])
    return handler.call({} as CompilerModule, BOARD, projectDir, targetDir, (message: string | Buffer, level?: string) => {
      logs.push({ message: String(message), level: level ?? '' })
    })
  }

  it('stays silent about licensing for a built-in (hals.json) target with no VPP package', async () => {
    // The common case Thiago's review caught: every plain runtime-v4 build
    // goes through this function, and the built-in target must not produce
    // a "reinstall the package" warning about a package that never existed.
    halsFileContent.current = { [BOARD]: { runtime: 'runtime-v4' } }

    await runWithEmptyStore()

    expect(logs.some((l) => l.level === 'warning')).toBe(false)
    expect(logs.some((l) => l.message.includes('not from a VPP package'))).toBe(true)
  })

  it('warns when the board is known to neither the package store nor hals.json (drifted VPP)', async () => {
    halsFileContent.current = {}

    await runWithEmptyStore()

    expect(
      logs.some((l) => l.level === 'warning' && l.message.includes('licensing gate could not be evaluated')),
    ).toBe(true)
  })
})
