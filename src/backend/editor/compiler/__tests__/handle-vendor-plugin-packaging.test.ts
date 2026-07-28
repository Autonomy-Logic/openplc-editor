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

const listInstalled = jest.fn()
const getInstalledPackageManifest = jest.fn()
jest.mock('../../package-manager', () => ({
  PackageManagerModule: jest.fn().mockImplementation(() => ({
    listInstalled,
    getInstalledPackageManifest,
  })),
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

/**
 * The package's `signature.json`, as openplc-packages emits it: payload plus a
 * detached Ed25519 signature. The bytes here are not a real signature and are
 * not verified by anything in this test — what is under test is that the file
 * is forwarded VERBATIM into the upload. The crypto contract itself is pinned
 * on the runtime side, against a real signed .vpp
 * (openplc-runtime/tests/pytest/plugins/test_vpp_plugin_signature.py).
 */
const PACKAGE_SIGNATURE = {
  formatVersion: '1.0',
  alg: 'ed25519',
  keyId: 'openplc-2026',
  packageId: 'com.openplc.rpi',
  version: '1.0.0',
  signedAt: '2026-07-22T10:59:20.069Z',
  files: {
    'hal/runtime-v4/plugin/Makefile': 'a'.repeat(64),
    'hal/runtime-v4/plugin/rpi_plugin.o': 'b'.repeat(64),
    'hal/runtime-v4/plugin/config_template.json': 'c'.repeat(64),
  },
  signature: 'ZmFrZS1zaWduYXR1cmU=',
}

/** Writes a plugin directory with two payload files + an excluded one. */
function writePluginDir(pkgDir: string): string {
  const pluginDir = join(pkgDir, 'hal', 'runtime-v4', 'plugin')
  mkdirSync(pluginDir, { recursive: true })
  writeFileSync(join(pluginDir, 'rpi_plugin.o'), 'OBJECT-BYTES')
  writeFileSync(join(pluginDir, 'Makefile'), 'all:\n\techo link\n')
  // Excluded by the packager — must not be copied into vpp_plugin/.
  writeFileSync(join(pluginDir, 'config_template.json'), JSON.stringify({ plugin_name: 'rpi_gpio', pins: [] }))
  // Every published .vpp carries one of these at the package root.
  writeFileSync(join(pkgDir, 'signature.json'), JSON.stringify(PACKAGE_SIGNATURE, null, 2))
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
    // Recompilation cache key (NOT integrity — we hash files we just copied,
    // and it travels in the same upload as those files).
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

  describe('package signature forwarding', () => {
    /**
     * The runtime cannot verify a plugin it has no signature for, and the
     * signature lives at the package ROOT — outside the plugin directory this
     * method copies. Leaving it behind is exactly why an edited Makefile used
     * to compile on the device.
     */
    it('forwards the package signature verbatim, with the signed plugin dir', async () => {
      await runFor({
        type: 'runtime-v4-plugin',
        pluginType: 'native',
        provisioning: 'prebuilt',
        pluginEntry: 'hal/runtime-v4/plugin',
        configTemplate: 'hal/runtime-v4/plugin/config_template.json',
      })

      const sidecarPath = join(targetDir, 'vpp_signature.json')
      expect(existsSync(sidecarPath)).toBe(true)
      const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf-8')) as {
        pluginDir: string
        package: typeof PACKAGE_SIGNATURE
      }
      // The prefix the runtime uses to map uploaded files back onto the signed
      // hash map. POSIX separators, because the map is keyed that way.
      expect(sidecar.pluginDir).toBe('hal/runtime-v4/plugin')
      // Verbatim, whole — not a slice covering only the files that travelled.
      // The Ed25519 signature is over the canonical form of the ENTIRE payload,
      // so a filtered map is not what was signed and could never verify.
      expect(sidecar.package).toEqual(PACKAGE_SIGNATURE)
    })

    it('derives the signed plugin dir from the entry file in source mode', async () => {
      writeFileSync(join(pkgDir, 'hal', 'runtime-v4', 'plugin', 'rpi_plugin.c'), 'int main(){}')

      await runFor({
        type: 'runtime-v4-plugin',
        pluginType: 'native',
        pluginEntry: 'hal/runtime-v4/plugin/rpi_plugin.c',
        configTemplate: 'hal/runtime-v4/plugin/config_template.json',
      })

      const sidecar = JSON.parse(readFileSync(join(targetDir, 'vpp_signature.json'), 'utf-8')) as {
        pluginDir: string
      }
      expect(sidecar.pluginDir).toBe('hal/runtime-v4/plugin')
    })

    it('reports an error and writes no sidecar when the package is unsigned', async () => {
      rmSync(join(pkgDir, 'signature.json'))

      await runFor({
        type: 'runtime-v4-plugin',
        pluginType: 'native',
        provisioning: 'prebuilt',
        pluginEntry: 'hal/runtime-v4/plugin',
        configTemplate: 'hal/runtime-v4/plugin/config_template.json',
      })

      expect(existsSync(join(targetDir, 'vpp_signature.json'))).toBe(false)
      // The runtime will refuse this upload; the user has to be told why here,
      // where the cause (an unsigned package) is still visible.
      const error = logs.find((l) => l.level === 'error' && /signature\.json/.test(l.message))
      expect(error).toBeDefined()
      expect(error?.message).toMatch(/runtime will refuse/)
    })
  })
})
