import { join, resolve, sep } from 'node:path'

import type { InstalledPackage, PackageManifest } from '../../../../middleware/shared/ports/types'
import {
  BoardInfoResolver,
  type BoardInfoResolverConfig,
  type HalsBoardEntry,
  type HalsFileContent,
  type PackageManagerPort,
} from '../board-info-resolver'

const SOURCES_DIR = '/fake/resources/sources'
const PKG_PATH = '/fake/user-data/packages/com.openplc.arduino'

// Editor-style adapters used by these tests.  Real editor passes the
// same shape (filesystem-backed path joins); web will pass its own
// browser-friendly equivalents when VPP-on-web lands.
const halsSourcePath = (rel: string): string => join(SOURCES_DIR, 'hal', rel)
const packageRelative = (pkgPath: string, relPath: string): string => {
  const root = resolve(pkgPath)
  const candidate = resolve(root, relPath)
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    throw new Error(`Path "${relPath}" escapes package directory ${pkgPath}`)
  }
  return candidate
}

function makeHalsEntry(overrides: Partial<HalsBoardEntry> = {}): HalsBoardEntry {
  return {
    compiler: 'arduino-cli',
    core: 'arduino:avr',
    platform: 'arduino:avr:mega',
    source: 'mega_due.cpp',
    ...overrides,
  }
}

function makePkg(overrides: Partial<InstalledPackage> = {}): InstalledPackage {
  return {
    packageId: 'com.openplc.arduino',
    version: '0.1.0',
    installedAt: '2026-05-13T00:00:00.000Z',
    path: PKG_PATH,
    devices: ['arduino-mega'],
    ...overrides,
  }
}

function makeManifest(overrides: Partial<PackageManifest> = {}): PackageManifest {
  return {
    formatVersion: '1.0',
    package: {
      id: 'com.openplc.arduino',
      name: 'Arduino',
      version: '0.1.0',
      vendor: { name: 'Arduino', logo: 'assets/logo.png' },
      description: 'desc',
    },
    devices: [
      {
        id: 'arduino-mega',
        name: 'Arduino Mega',
        preview: 'assets/boards/mega.png',
        target: { type: 'arduino-cli', core: 'arduino:avr', platform: 'arduino:avr:mega' },
        hal: { type: 'arduino-hal', source: 'hal/arduino/mega_due.cpp' },
      },
    ],
    ...overrides,
  }
}

function makePackageManager(
  installed: InstalledPackage[],
  manifests: Record<string, PackageManifest | null>,
): PackageManagerPort {
  return {
    listInstalled: () => installed,
    getInstalledPackageManifest: (id) => manifests[id] ?? null,
  }
}

function makeResolver(
  halsContent: HalsFileContent,
  packageManager: PackageManagerPort,
  overrides: Partial<BoardInfoResolverConfig> = {},
): BoardInfoResolver {
  return new BoardInfoResolver({
    halsContent,
    packageManager,
    resolveHalSourcePath: halsSourcePath,
    resolvePackageRelativePath: packageRelative,
    ...overrides,
  })
}

describe('BoardInfoResolver', () => {
  describe('hals.json lookup', () => {
    it('resolves a board found in hals.json into a `source: hals` BoardBuildInfo', () => {
      const r = makeResolver({ 'Arduino Mega': makeHalsEntry() }, makePackageManager([], {}))
      const info = r.resolve('Arduino Mega')
      expect(info.source).toBe('hals')
      expect(info.compiler).toBe('arduino-cli')
      expect(info.platform).toBe('arduino:avr:mega')
      expect(info.core).toBe('arduino:avr')
      expect(info.halSourceFile).toBe(join(SOURCES_DIR, 'hal', 'mega_due.cpp'))
    })

    it('maps optional hals fields (board_manager_url, flags, define, extra_libraries, max_data_size)', () => {
      const r = makeResolver(
        {
          'Sequent ESP32': makeHalsEntry({
            board_manager_url: 'https://example.com/index.json',
            c_flags: ['-MMD'],
            cxx_flags: ['-std=gnu++17'],
            ld_flags: ['-Wl,foo'],
            define: 'BOARD_ESP32',
            extra_libraries: ['SomeLib'],
            max_data_size: 8192,
          }),
        },
        makePackageManager([], {}),
      )
      const info = r.resolve('Sequent ESP32')
      expect(info.boardManagerUrl).toBe('https://example.com/index.json')
      expect(info.compilerFlags).toEqual({
        c_flags: ['-MMD'],
        cxx_flags: ['-std=gnu++17'],
        ld_flags: ['-Wl,foo'],
      })
      expect(info.define).toBe('BOARD_ESP32')
      expect(info.extraArduinoLibraries).toEqual(['SomeLib'])
      expect(info.maxDataSize).toBe(8192)
    })

    it('omits compilerFlags entirely when no flag arrays exist', () => {
      const r = makeResolver({ 'Arduino Uno': makeHalsEntry() }, makePackageManager([], {}))
      const info = r.resolve('Arduino Uno')
      expect(info.compilerFlags).toBeUndefined()
    })

    it('emits partial compilerFlags when only c_flags is set (cxx/ld omitted)', () => {
      // Each flag array is independently optional in `#collectFlags`;
      // a board may declare only one without forcing the others. The
      // resolver must not synthesise empty arrays.
      const r = makeResolver({ 'Some Board': makeHalsEntry({ c_flags: ['-MMD'] }) }, makePackageManager([], {}))
      const info = r.resolve('Some Board')
      expect(info.compilerFlags).toEqual({ c_flags: ['-MMD'] })
    })

    it('emits partial compilerFlags when only cxx_flags is set', () => {
      const r = makeResolver(
        { 'Some Board': makeHalsEntry({ cxx_flags: ['-std=gnu++17'] }) },
        makePackageManager([], {}),
      )
      const info = r.resolve('Some Board')
      expect(info.compilerFlags).toEqual({ cxx_flags: ['-std=gnu++17'] })
    })

    it('emits partial compilerFlags when only ld_flags is set', () => {
      const r = makeResolver({ 'Some Board': makeHalsEntry({ ld_flags: ['-Wl,foo'] }) }, makePackageManager([], {}))
      const info = r.resolve('Some Board')
      expect(info.compilerFlags).toEqual({ ld_flags: ['-Wl,foo'] })
    })

    it('omits core / platform / halSourceFile when those hals fields are absent', () => {
      // The schema marks all three as optional; the resolver must not
      // attach `undefined` keys to the result (downstream callers do
      // truthy checks).
      const r = makeResolver(
        {
          // Type-system shortcut: a HalsBoardEntry minimally requires
          // `compiler`, the other fields are optional.
          Minimal: { compiler: 'arduino-cli' } as HalsBoardEntry,
        },
        makePackageManager([], {}),
      )
      const info = r.resolve('Minimal')
      expect(info.core).toBeUndefined()
      expect(info.platform).toBeUndefined()
      expect(info.halSourceFile).toBeUndefined()
    })

    it('propagates entry.debug (DebugSpec) onto BoardBuildInfo for hals entries', () => {
      // The renderer pulls `.debug` to decide whether the toolbar's
      // debug button should be enabled (and which transport to wire).
      // No `debug` on the entry must produce no `.debug` on the info.
      const debugSpec = {
        channels: [
          {
            label: 'Modbus TCP',
            channel: 'tcp' as const,
            enabledWhen: true,
            params: { ip: '192.168.0.1' },
          },
        ],
      }
      const r = makeResolver({ 'Debuggable Board': makeHalsEntry({ debug: debugSpec }) }, makePackageManager([], {}))
      const info = r.resolve('Debuggable Board')
      expect(info.debug).toEqual(debugSpec)
    })

    it('falls through to VPP when hals.json has no entry', () => {
      const pkg = makePkg()
      const manifest = makeManifest()
      const pm = makePackageManager([pkg], { [pkg.packageId]: manifest })
      const r = makeResolver({}, pm)
      const info = r.resolve('Arduino Mega')
      expect(info.source).toBe('vpp')
    })
  })

  describe('precedence', () => {
    it('hals.json wins when the same board exists in both catalogs', () => {
      const hals: HalsFileContent = { 'Arduino Mega': makeHalsEntry({ platform: 'hals-platform' }) }
      const pkg = makePkg()
      const manifest = makeManifest({
        devices: [
          {
            id: 'arduino-mega',
            name: 'Arduino Mega',
            preview: 'assets/boards/mega.png',
            target: { type: 'arduino-cli', core: 'arduino:avr', platform: 'vpp-platform' },
            hal: { type: 'arduino-hal', source: 'hal/arduino/mega_due.cpp' },
          },
        ],
      })
      const pm = makePackageManager([pkg], { [pkg.packageId]: manifest })
      const r = makeResolver(hals, pm)
      const info = r.resolve('Arduino Mega')
      expect(info.source).toBe('hals')
      expect(info.platform).toBe('hals-platform')
    })
  })

  describe('VPP lookup', () => {
    it('resolves a VPP-only arduino-cli board with full field mapping', () => {
      const pkg = makePkg()
      const manifest = makeManifest({
        devices: [
          {
            id: 'arduino-giga',
            name: 'Arduino Giga',
            preview: 'assets/boards/generic.png',
            target: {
              type: 'arduino-cli',
              core: 'arduino:mbed_giga',
              platform: 'arduino:mbed_giga:giga',
              boardManagerUrl: 'https://example.com/mbed.json',
            },
            hal: {
              type: 'arduino-hal',
              source: 'hal/arduino/giga.cpp',
              compilerFlags: { c_flags: ['-MMD'], cxx_flags: ['-std=gnu++17'] },
              define: ['BOARD_GIGA', 'EXTRA'],
              extraArduinoLibraries: ['Ethernet'],
              libraries: 'hal/arduino/libraries',
            },
          },
        ],
      })
      const pm = makePackageManager([pkg], { [pkg.packageId]: manifest })
      const r = makeResolver({}, pm)
      const info = r.resolve('Arduino Giga')
      expect(info).toMatchObject({
        source: 'vpp',
        compiler: 'arduino-cli',
        core: 'arduino:mbed_giga',
        platform: 'arduino:mbed_giga:giga',
        boardManagerUrl: 'https://example.com/mbed.json',
        halSourceFile: join(PKG_PATH, 'hal', 'arduino', 'giga.cpp'),
        compilerFlags: { c_flags: ['-MMD'], cxx_flags: ['-std=gnu++17'] },
        define: ['BOARD_GIGA', 'EXTRA'],
        extraArduinoLibraries: ['Ethernet'],
        localLibrariesDir: join(PKG_PATH, 'hal', 'arduino', 'libraries'),
        vppPackageId: 'com.openplc.arduino',
        vppDeviceId: 'arduino-giga',
        vppPackagePath: PKG_PATH,
      })
    })

    it('resolves a runtime-v4 plugin board (python) and maps target type to openplc-compiler', () => {
      const pkg = makePkg({ packageId: 'com.openplc.raspberry-pi' })
      const manifest = makeManifest({
        package: {
          id: 'com.openplc.raspberry-pi',
          name: 'Raspberry Pi',
          version: '0.1.0',
          vendor: { name: 'Raspberry Pi', logo: 'assets/logo.png' },
          description: 'desc',
        },
        devices: [
          {
            id: 'raspberry-pi',
            name: 'Raspberry Pi',
            preview: 'assets/boards/raspberry-pi.png',
            target: { type: 'runtime-v4', platform: 'linux-arm' },
            hal: {
              type: 'runtime-v4-plugin',
              pluginType: 'python',
              pluginEntry: 'hal/runtime-v4/plugin/rpi_hal.py',
              configTemplate: 'hal/runtime-v4/plugin/config_template.json',
              requirements: 'hal/runtime-v4/plugin/requirements.txt',
            },
          },
        ],
      })
      const pm = makePackageManager([pkg], { [pkg.packageId]: manifest })
      const r = makeResolver({}, pm)
      const info = r.resolve('Raspberry Pi')
      expect(info.compiler).toBe('openplc-compiler')
      expect(info.pluginType).toBe('python')
      expect(info.pluginEntry).toBe(join(pkg.path, 'hal', 'runtime-v4', 'plugin', 'rpi_hal.py'))
      expect(info.configTemplate).toBe(join(pkg.path, 'hal', 'runtime-v4', 'plugin', 'config_template.json'))
      expect(info.requirements).toBe(join(pkg.path, 'hal', 'runtime-v4', 'plugin', 'requirements.txt'))
    })

    it('forwards target.platformOptions verbatim from the manifest', () => {
      const pkg = makePkg()
      const manifest = makeManifest({
        devices: [
          {
            id: 'arduino-nano',
            name: 'Arduino Nano',
            preview: 'p.png',
            target: {
              type: 'arduino-cli',
              core: 'arduino:avr',
              platform: 'arduino:avr:nano',
              platformOptions: [
                {
                  key: 'cpu',
                  label: 'Processor',
                  default: 'atmega328',
                  help: 'Pick the bootloader variant.',
                  values: [
                    { id: 'atmega328', label: 'New Bootloader' },
                    { id: 'atmega328old', label: 'Old Bootloader', help: '57600 baud' },
                  ],
                },
              ],
            },
            hal: { type: 'arduino-hal', source: 'hal/arduino/nano.cpp' },
          },
        ],
      })
      const pm = makePackageManager([pkg], { [pkg.packageId]: manifest })
      const r = makeResolver({}, pm)
      const info = r.resolve('Arduino Nano')
      expect(info.platformOptions).toEqual([
        {
          key: 'cpu',
          label: 'Processor',
          default: 'atmega328',
          help: 'Pick the bootloader variant.',
          values: [
            { id: 'atmega328', label: 'New Bootloader' },
            { id: 'atmega328old', label: 'Old Bootloader', help: '57600 baud' },
          ],
        },
      ])
    })

    it('omits platformOptions when the manifest does not declare any', () => {
      const pkg = makePkg()
      const manifest = makeManifest({
        devices: [
          {
            id: 'arduino-mega',
            name: 'Arduino Mega',
            preview: 'p.png',
            target: {
              type: 'arduino-cli',
              core: 'arduino:avr',
              platform: 'arduino:avr:mega',
            },
            hal: { type: 'arduino-hal', source: 'hal/arduino/mega.cpp' },
          },
        ],
      })
      const pm = makePackageManager([pkg], { [pkg.packageId]: manifest })
      const r = makeResolver({}, pm)
      const info = r.resolve('Arduino Mega')
      expect(info.platformOptions).toBeUndefined()
    })

    it('propagates device.debug (DebugSpec) onto BoardBuildInfo for VPP devices', () => {
      // Same renderer-side consumer as the hals branch above (Debug
      // button enable state); the VPP path goes through `#fromVppDevice`,
      // so we need an independent regression here.
      const debugSpec = {
        channels: [
          {
            label: 'Modbus TCP',
            channel: 'tcp' as const,
            enabledWhen: true,
            params: { ip: '192.168.0.1' },
          },
        ],
      }
      const pkg = makePkg()
      const manifest = makeManifest({
        devices: [
          {
            id: 'arduino-mega',
            name: 'Arduino Mega',
            preview: 'p.png',
            target: { type: 'arduino-cli', core: 'arduino:avr', platform: 'arduino:avr:mega' },
            hal: { type: 'arduino-hal', source: 'hal/arduino/mega.cpp' },
            debug: debugSpec,
          },
        ],
      })
      const pm = makePackageManager([pkg], { [pkg.packageId]: manifest })
      const r = makeResolver({}, pm)
      const info = r.resolve('Arduino Mega')
      expect(info.debug).toEqual(debugSpec)
    })

    it('passes through unknown target types as compiler value', () => {
      const pkg = makePkg()
      const manifest = makeManifest({
        devices: [
          {
            id: 'weird',
            name: 'Weird Board',
            preview: 'p.png',
            target: { type: 'my-future-toolchain' },
            hal: { type: 'arduino-hal' },
          },
        ],
      })
      const pm = makePackageManager([pkg], { [pkg.packageId]: manifest })
      const r = makeResolver({}, pm)
      const info = r.resolve('Weird Board')
      expect(info.compiler).toBe('my-future-toolchain')
    })

    it('skips installed packages whose manifest fails to load', () => {
      const broken = makePkg({ packageId: 'com.broken.pkg' })
      const good = makePkg({ packageId: 'com.openplc.arduino', devices: ['arduino-mega'] })
      const pm = makePackageManager([broken, good], {
        'com.broken.pkg': null,
        'com.openplc.arduino': makeManifest(),
      })
      const r = makeResolver({}, pm)
      const info = r.resolve('Arduino Mega')
      expect(info.source).toBe('vpp')
      expect(info.vppPackageId).toBe('com.openplc.arduino')
    })

    it('finds a board in the second installed package when the first does not have it', () => {
      const a = makePkg({ packageId: 'com.openplc.arduino', devices: ['arduino-mega'] })
      const b = makePkg({ packageId: 'com.openplc.espressif', path: '/fake/user-data/packages/com.openplc.espressif' })
      const pm = makePackageManager([a, b], {
        'com.openplc.arduino': makeManifest(),
        'com.openplc.espressif': makeManifest({
          package: {
            id: 'com.openplc.espressif',
            name: 'Espressif',
            version: '0.1.0',
            vendor: { name: 'Espressif', logo: 'assets/logo.png' },
            description: 'desc',
          },
          devices: [
            {
              id: 'esp32-generic',
              name: 'ESP32 Generic',
              preview: 'assets/boards/esp32.png',
              target: { type: 'arduino-cli', core: 'esp32:esp32', platform: 'esp32:esp32:esp32' },
              hal: { type: 'arduino-hal', source: 'hal/arduino/esp32.cpp' },
            },
          ],
        }),
      })
      const r = makeResolver({}, pm)
      const info = r.resolve('ESP32 Generic')
      expect(info.vppPackageId).toBe('com.openplc.espressif')
      expect(info.halSourceFile).toBe(join(b.path, 'hal', 'arduino', 'esp32.cpp'))
    })
  })

  describe('runtime classification flags', () => {
    it('classifies an arduino-cli board correctly', () => {
      const r = makeResolver({ 'Arduino Mega': makeHalsEntry() }, makePackageManager([], {}))
      const info = r.resolve('Arduino Mega')
      expect(info.boardRuntime).toBe('arduino-cli')
      expect(info.isSimulator).toBe(false)
      expect(info.isRuntimeV3).toBe(false)
      expect(info.isRuntimeV4).toBe(false)
    })

    it('classifies the simulator board correctly', () => {
      const r = makeResolver(
        { 'OpenPLC Simulator': makeHalsEntry({ compiler: 'simulator' }) },
        makePackageManager([], {}),
      )
      const info = r.resolve('OpenPLC Simulator')
      expect(info.boardRuntime).toBe('simulator')
      expect(info.isSimulator).toBe(true)
      expect(info.isRuntimeV3).toBe(false)
      expect(info.isRuntimeV4).toBe(false)
    })

    it('classifies legacy Runtime v3 by board name', () => {
      const r = makeResolver(
        { 'OpenPLC Runtime v3': makeHalsEntry({ compiler: 'openplc-compiler' }) },
        makePackageManager([], {}),
      )
      const info = r.resolve('OpenPLC Runtime v3')
      expect(info.boardRuntime).toBe('openplc-compiler')
      expect(info.isRuntimeV3).toBe(true)
      expect(info.isRuntimeV4).toBe(false)
      expect(info.isSimulator).toBe(false)
    })

    it('classifies Runtime v4 (openplc-compiler + non-v3 name)', () => {
      const r = makeResolver(
        { 'OpenPLC Runtime v4 (RPi)': makeHalsEntry({ compiler: 'openplc-compiler' }) },
        makePackageManager([], {}),
      )
      const info = r.resolve('OpenPLC Runtime v4 (RPi)')
      expect(info.boardRuntime).toBe('openplc-compiler')
      expect(info.isRuntimeV4).toBe(true)
      expect(info.isRuntimeV3).toBe(false)
      expect(info.isSimulator).toBe(false)
    })

    it('classifies a VPP runtime-v4 plugin board as Runtime v4', () => {
      const pkg = makePkg()
      const manifest = makeManifest({
        devices: [
          {
            id: 'rpi',
            name: 'RPi Plugin',
            preview: 'p.png',
            target: { type: 'runtime-v4' },
            hal: { type: 'runtime-v4-plugin', pluginType: 'python' },
          },
        ],
      })
      const pm = makePackageManager([pkg], { [pkg.packageId]: manifest })
      const r = makeResolver({}, pm)
      const info = r.resolve('RPi Plugin')
      expect(info.isRuntimeV4).toBe(true)
      expect(info.isRuntimeV3).toBe(false)
      expect(info.isSimulator).toBe(false)
    })
  })

  describe('errors', () => {
    it('throws when board exists in neither catalog', () => {
      const r = makeResolver({}, makePackageManager([], {}))
      expect(() => r.resolve('Phantom Board')).toThrow(/not found in hals\.json or any installed VPP package/)
    })

    it('rejects path-traversal in manifest paths via the platform-supplied resolver', () => {
      const pkg = makePkg()
      const manifest = makeManifest({
        devices: [
          {
            id: 'evil',
            name: 'Evil Board',
            preview: 'p.png',
            target: { type: 'arduino-cli' },
            hal: { type: 'arduino-hal', source: '../../../etc/passwd' },
          },
        ],
      })
      const pm = makePackageManager([pkg], { [pkg.packageId]: manifest })
      const r = makeResolver({}, pm)
      expect(() => r.resolve('Evil Board')).toThrow(/escapes package directory/)
    })

    it('accepts manifest paths that resolve exactly at the package root (no traversal)', () => {
      const pkg = makePkg()
      const manifest = makeManifest({
        devices: [
          {
            id: 'root-hal',
            name: 'Root HAL Board',
            preview: 'p.png',
            target: { type: 'arduino-cli' },
            hal: { type: 'arduino-hal', source: './hal/arduino/mega_due.cpp' },
          },
        ],
      })
      const pm = makePackageManager([pkg], { [pkg.packageId]: manifest })
      const r = makeResolver({}, pm)
      const info = r.resolve('Root HAL Board')
      expect(info.halSourceFile).toBe(join(pkg.path, 'hal', 'arduino', 'mega_due.cpp'))
      expect(info.halSourceFile?.startsWith(pkg.path + sep)).toBe(true)
    })
  })

  describe('no-op (web-style) package manager stub', () => {
    it('behaves as hals-only when packageManager returns no installed packages', () => {
      const stub: PackageManagerPort = {
        listInstalled: () => [],
        getInstalledPackageManifest: () => null,
      }
      const r = makeResolver({ 'Arduino Mega': makeHalsEntry() }, stub)
      const info = r.resolve('Arduino Mega')
      expect(info.source).toBe('hals')
    })

    it('throws cleanly when a VPP-only board is queried against a no-op packageManager', () => {
      const stub: PackageManagerPort = {
        listInstalled: () => [],
        getInstalledPackageManifest: () => null,
      }
      const r = makeResolver({}, stub)
      expect(() => r.resolve('Arduino Giga')).toThrow(/not found/)
    })
  })
})
