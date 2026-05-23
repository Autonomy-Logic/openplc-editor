import { join, sep } from 'node:path'

import type { InstalledPackage, PackageManifest } from '../../package-manager/types'
import { BoardInfoResolver, type PackageManagerLike } from '../board-info-resolver'
import type { BoardInfo, HalsFile } from '../types'

const HALS_PATH = '/fake/resources/sources/boards/hals.json'
const SOURCES_DIR = '/fake/resources/sources'
const PKG_PATH = '/fake/user-data/packages/com.openplc.arduino'

function makeHalsEntry(overrides: Partial<BoardInfo> = {}): BoardInfo {
  return {
    compiler: 'arduino-cli',
    core: 'arduino:avr',
    platform: 'arduino:avr:mega',
    default_din: '2, 3',
    default_dout: '4, 5',
    default_ain: 'A0',
    default_aout: '6',
    preview: 'mega.png',
    source: 'mega_due.cpp',
    specs: {
      CPU: 'ATmega 2560',
      RAM: '8 KB',
      Flash: '256 KB',
      DigitalPins: '70',
      AnalogPins: '16',
      PWMPins: '15',
      WiFi: 'No',
      Bluetooth: 'No',
      Ethernet: 'No',
    },
    ...overrides,
  }
}

function makeHalsReader(content: HalsFile | Error): <T>(path: string) => Promise<T> {
  return async <T>() => {
    if (content instanceof Error) throw content
    return content as unknown as T
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
): PackageManagerLike {
  return {
    listInstalled: () => installed,
    getInstalledPackageManifest: (id) => manifests[id] ?? null,
  }
}

describe('BoardInfoResolver', () => {
  describe('hals.json lookup', () => {
    it('resolves a board found in hals.json into a `source: hals` BoardBuildInfo', async () => {
      const hals: HalsFile = { 'Arduino Mega': makeHalsEntry() }
      const r = new BoardInfoResolver(HALS_PATH, SOURCES_DIR, makePackageManager([], {}), makeHalsReader(hals))
      const info = await r.resolve('Arduino Mega')
      expect(info.source).toBe('hals')
      expect(info.compiler).toBe('arduino-cli')
      expect(info.platform).toBe('arduino:avr:mega')
      expect(info.core).toBe('arduino:avr')
      expect(info.halSourceFile).toBe(join(SOURCES_DIR, 'hal', 'mega_due.cpp'))
    })

    it('maps optional hals fields (board_manager_url, flags, define, extra_libraries)', async () => {
      const hals: HalsFile = {
        'Sequent ESP32': makeHalsEntry({
          board_manager_url: 'https://example.com/index.json',
          c_flags: ['-MMD'],
          cxx_flags: ['-std=gnu++17'],
          ld_flags: ['-Wl,foo'],
          define: 'BOARD_ESP32',
          extra_libraries: ['SomeLib'],
        }),
      }
      const r = new BoardInfoResolver(HALS_PATH, SOURCES_DIR, makePackageManager([], {}), makeHalsReader(hals))
      const info = await r.resolve('Sequent ESP32')
      expect(info.boardManagerUrl).toBe('https://example.com/index.json')
      expect(info.compilerFlags).toEqual({
        c_flags: ['-MMD'],
        cxx_flags: ['-std=gnu++17'],
        ld_flags: ['-Wl,foo'],
      })
      expect(info.define).toBe('BOARD_ESP32')
      expect(info.extraArduinoLibraries).toEqual(['SomeLib'])
    })

    it('omits compilerFlags entirely when no flag arrays exist', async () => {
      const hals: HalsFile = { 'Arduino Uno': makeHalsEntry() }
      const r = new BoardInfoResolver(HALS_PATH, SOURCES_DIR, makePackageManager([], {}), makeHalsReader(hals))
      const info = await r.resolve('Arduino Uno')
      expect(info.compilerFlags).toBeUndefined()
    })

    it('falls through to VPP when hals.json read fails (missing file)', async () => {
      const pkg = makePkg()
      const manifest = makeManifest()
      const pm = makePackageManager([pkg], { [pkg.packageId]: manifest })
      const r = new BoardInfoResolver(HALS_PATH, SOURCES_DIR, pm, makeHalsReader(new Error('ENOENT')))
      const info = await r.resolve('Arduino Mega')
      expect(info.source).toBe('vpp')
    })
  })

  describe('precedence', () => {
    it('hals.json wins when the same board exists in both catalogs', async () => {
      const hals: HalsFile = { 'Arduino Mega': makeHalsEntry({ platform: 'hals-platform' }) }
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
      const r = new BoardInfoResolver(HALS_PATH, SOURCES_DIR, pm, makeHalsReader(hals))
      const info = await r.resolve('Arduino Mega')
      expect(info.source).toBe('hals')
      expect(info.platform).toBe('hals-platform')
    })
  })

  describe('VPP lookup', () => {
    it('resolves a VPP-only arduino-cli board with full field mapping', async () => {
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
      const r = new BoardInfoResolver(HALS_PATH, SOURCES_DIR, pm, makeHalsReader({}))
      const info = await r.resolve('Arduino Giga')
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

    it('resolves a runtime-v4 plugin board (python) and maps target type to openplc-compiler', async () => {
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
      const r = new BoardInfoResolver(HALS_PATH, SOURCES_DIR, pm, makeHalsReader({}))
      const info = await r.resolve('Raspberry Pi')
      expect(info.compiler).toBe('openplc-compiler')
      expect(info.pluginType).toBe('python')
      expect(info.pluginEntry).toBe(join(pkg.path, 'hal', 'runtime-v4', 'plugin', 'rpi_hal.py'))
      expect(info.configTemplate).toBe(join(pkg.path, 'hal', 'runtime-v4', 'plugin', 'config_template.json'))
      expect(info.requirements).toBe(join(pkg.path, 'hal', 'runtime-v4', 'plugin', 'requirements.txt'))
    })

    it('forwards target.platformOptions verbatim from the manifest', async () => {
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
      const r = new BoardInfoResolver(HALS_PATH, SOURCES_DIR, pm, makeHalsReader({}))
      const info = await r.resolve('Arduino Nano')
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

    it('omits platformOptions when the manifest does not declare any', async () => {
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
      const r = new BoardInfoResolver(HALS_PATH, SOURCES_DIR, pm, makeHalsReader({}))
      const info = await r.resolve('Arduino Mega')
      expect(info.platformOptions).toBeUndefined()
    })

    it('passes through unknown target types as compiler value', async () => {
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
      const r = new BoardInfoResolver(HALS_PATH, SOURCES_DIR, pm, makeHalsReader({}))
      const info = await r.resolve('Weird Board')
      expect(info.compiler).toBe('my-future-toolchain')
    })

    it('skips installed packages whose manifest fails to load', async () => {
      const broken = makePkg({ packageId: 'com.broken.pkg' })
      const good = makePkg({ packageId: 'com.openplc.arduino', devices: ['arduino-mega'] })
      const pm = makePackageManager([broken, good], {
        'com.broken.pkg': null,
        'com.openplc.arduino': makeManifest(),
      })
      const r = new BoardInfoResolver(HALS_PATH, SOURCES_DIR, pm, makeHalsReader({}))
      const info = await r.resolve('Arduino Mega')
      expect(info.source).toBe('vpp')
      expect(info.vppPackageId).toBe('com.openplc.arduino')
    })

    it('finds a board in the second installed package when the first does not have it', async () => {
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
      const r = new BoardInfoResolver(HALS_PATH, SOURCES_DIR, pm, makeHalsReader({}))
      const info = await r.resolve('ESP32 Generic')
      expect(info.vppPackageId).toBe('com.openplc.espressif')
      expect(info.halSourceFile).toBe(join(b.path, 'hal', 'arduino', 'esp32.cpp'))
    })
  })

  describe('errors', () => {
    it('throws when board exists in neither catalog', async () => {
      const r = new BoardInfoResolver(HALS_PATH, SOURCES_DIR, makePackageManager([], {}), makeHalsReader({}))
      await expect(r.resolve('Phantom Board')).rejects.toThrow(/not found in hals\.json or any installed VPP package/)
    })

    it('rejects path-traversal in manifest paths', async () => {
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
      const r = new BoardInfoResolver(HALS_PATH, SOURCES_DIR, pm, makeHalsReader({}))
      await expect(r.resolve('Evil Board')).rejects.toThrow(/escapes package directory/)
    })

    it('accepts manifest paths that resolve exactly at the package root (no traversal)', async () => {
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
      const r = new BoardInfoResolver(HALS_PATH, SOURCES_DIR, pm, makeHalsReader({}))
      const info = await r.resolve('Root HAL Board')
      expect(info.halSourceFile).toBe(join(pkg.path, 'hal', 'arduino', 'mega_due.cpp'))
      expect(info.halSourceFile?.startsWith(pkg.path + sep)).toBe(true)
    })
  })
})
