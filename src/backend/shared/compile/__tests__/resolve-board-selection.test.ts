import type { InstalledPackage, PackageManifest } from '../../../../middleware/shared/ports/types'
import {
  BoardInfoResolver,
  type BoardInfoResolverConfig,
  type HalsBoardEntry,
  type HalsFileContent,
  type PackageManagerPort,
} from '../../hardware/board-info-resolver'
import { resolveBoardSelection } from '../steps/resolve-board-selection'

// ----- Lightweight test wiring -----------------------------------
//
// `BoardInfoResolver` is byte-identical between editor and web; we
// instantiate it directly with simple in-memory hals + package fakes
// so the test stays platform-agnostic (no node:fs, no IPC).

const noopPackageManager: PackageManagerPort = {
  listInstalled: () => [],
  getInstalledPackageManifest: () => null,
}

function makeResolver(
  halsContent: HalsFileContent,
  overrides: Partial<BoardInfoResolverConfig> = {},
): BoardInfoResolver {
  return new BoardInfoResolver({
    halsContent,
    packageManager: noopPackageManager,
    resolveHalSourcePath: (rel) => `/fake/sources/${rel}`,
    resolvePackageRelativePath: (pkg, rel) => `${pkg}/${rel}`,
    ...overrides,
  })
}

function halsEntry(overrides: Partial<HalsBoardEntry> = {}): HalsBoardEntry {
  return { compiler: 'arduino-cli', platform: 'arduino:avr:mega', ...overrides }
}

describe('resolveBoardSelection', () => {
  it('returns ok=false with a clear message when the boardTarget is unknown', () => {
    const resolver = makeResolver({})
    const result = resolveBoardSelection(resolver, 'No Such Board')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/"No Such Board"/)
      expect(result.error).toMatch(/hals\.json/)
      expect(result.error).toMatch(/VPP packages/)
    }
  })

  it('classifies a simulator board (compiler=simulator)', () => {
    const resolver = makeResolver({ 'OpenPLC Simulator': halsEntry({ compiler: 'simulator' }) })
    const result = resolveBoardSelection(resolver, 'OpenPLC Simulator')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.boardRuntime).toBe('simulator')
      expect(result.isSimulator).toBe(true)
      expect(result.isRuntimeV3).toBe(false)
      expect(result.isRuntimeV4).toBe(false)
    }
  })

  it('classifies the legacy OpenPLC Runtime v3 (compiler=openplc-compiler + name match)', () => {
    // The v3 daemon and the v4 vPLC share the `openplc-compiler` field
    // on disk for historical reasons; the name-string check is what
    // disambiguates them.
    const resolver = makeResolver({ 'OpenPLC Runtime v3': halsEntry({ compiler: 'openplc-compiler' }) })
    const result = resolveBoardSelection(resolver, 'OpenPLC Runtime v3')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.boardRuntime).toBe('openplc-compiler')
      expect(result.isRuntimeV3).toBe(true)
      expect(result.isRuntimeV4).toBe(false)
      expect(result.isSimulator).toBe(false)
    }
  })

  it('classifies a Runtime v4 board (compiler=openplc-compiler + non-v3 name)', () => {
    const resolver = makeResolver({ 'OpenPLC Runtime v4 (RPi)': halsEntry({ compiler: 'openplc-compiler' }) })
    const result = resolveBoardSelection(resolver, 'OpenPLC Runtime v4 (RPi)')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.boardRuntime).toBe('openplc-compiler')
      expect(result.isRuntimeV3).toBe(false)
      expect(result.isRuntimeV4).toBe(true)
      expect(result.isSimulator).toBe(false)
    }
  })

  it('classifies an arduino-cli board (compiler=arduino-cli)', () => {
    const resolver = makeResolver({ 'Arduino Mega 2560': halsEntry({ compiler: 'arduino-cli' }) })
    const result = resolveBoardSelection(resolver, 'Arduino Mega 2560')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.boardRuntime).toBe('arduino-cli')
      expect(result.isSimulator).toBe(false)
      expect(result.isRuntimeV3).toBe(false)
      expect(result.isRuntimeV4).toBe(false)
    }
  })

  it('adapts BoardBuildInfo into BoardHalsBuildEntry — required fields only when present', () => {
    // A board with no compilerFlags and no `define` must yield a
    // boardEntry with the same minimal shape; downstream consumers
    // dereference these conditionally.
    const resolver = makeResolver({ 'Arduino Mega 2560': halsEntry({ define: 'MEGA_2560' }) })
    const result = resolveBoardSelection(resolver, 'Arduino Mega 2560')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.boardEntry.platform).toBe('arduino:avr:mega')
      expect(result.boardEntry.define).toBe('MEGA_2560')
      // Absent compilerFlags must not leak through as empty arrays.
      expect(result.boardEntry.c_flags).toBeUndefined()
      expect(result.boardEntry.cxx_flags).toBeUndefined()
      expect(result.boardEntry.ld_flags).toBeUndefined()
    }
  })

  it('threads compiler flags + max_data_size through into boardEntry', () => {
    const resolver = makeResolver({
      'ESP32 Generic': halsEntry({
        platform: 'esp32:esp32:esp32',
        c_flags: ['-MMD'],
        cxx_flags: ['-std=gnu++17'],
        ld_flags: ['-Wl,foo'],
        max_data_size: 16384,
      }),
    })
    const result = resolveBoardSelection(resolver, 'ESP32 Generic')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.boardEntry.c_flags).toEqual(['-MMD'])
      expect(result.boardEntry.cxx_flags).toEqual(['-std=gnu++17'])
      expect(result.boardEntry.ld_flags).toEqual(['-Wl,foo'])
      expect(result.boardEntry.max_data_size).toBe(16384)
    }
  })

  it('resolves VPP-installed boards through the same shape', () => {
    // The whole point of the resolver: hals + VPP both look the same
    // to the pipeline, so the caller doesn't branch.
    const pkg: InstalledPackage = {
      packageId: 'com.openplc.arduino',
      version: '0.1.0',
      installedAt: '2026-01-01T00:00:00.000Z',
      path: '/fake/packages/com.openplc.arduino',
      devices: ['arduino-uno'],
    }
    const manifest: PackageManifest = {
      formatVersion: '1.0',
      package: {
        id: 'com.openplc.arduino',
        name: 'Arduino',
        version: '0.1.0',
        vendor: { name: 'Arduino', logo: 'l.png' },
        description: 'd',
      },
      devices: [
        {
          id: 'arduino-uno',
          name: 'Arduino Uno',
          preview: 'p.png',
          target: { type: 'arduino-cli', core: 'arduino:avr', platform: 'arduino:avr:uno' },
          hal: { type: 'arduino-hal', source: 'hal/arduino/uno.cpp' },
        },
      ],
    }
    const packageManager: PackageManagerPort = {
      listInstalled: () => [pkg],
      getInstalledPackageManifest: (id) => (id === pkg.packageId ? manifest : null),
    }
    const resolver = makeResolver({}, { packageManager })

    const result = resolveBoardSelection(resolver, 'Arduino Uno')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.boardEntry.platform).toBe('arduino:avr:uno')
      expect(result.boardEntry.core).toBe('arduino:avr')
      expect(result.boardRuntime).toBe('arduino-cli')
    }
  })
})
