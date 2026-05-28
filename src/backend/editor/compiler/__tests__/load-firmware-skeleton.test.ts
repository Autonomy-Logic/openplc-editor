/**
 * `loadFirmwareSkeletonInMemory` — focused tests.
 *
 * The method reads `resources/sources/arduino/*` + `resources/sources/Baremetal/*`
 * (incl. `Baremetal/modules/*`) off disk and returns a path-keyed
 * file map the pipeline's firmware-bundle composer consumes.
 *
 * Filesystem is real (per-test temp dir) so we exercise the actual
 * directory walks; Electron's `app` is mocked because the
 * CompilerModule constructor calls `app.getPath('userData')` and we
 * don't want that in CI.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// The CompilerModule constructor reaches for `process.resourcesPath`
// (Electron's packaged-app pointer) and `app.getPath('userData')`.
// Neither exists in Jest's CJS runtime.  We stub `resourcesPath` here
// and mock the `electron` module below; the test overrides
// `sourceDirectoryPath` after construction so the stubbed values are
// only used to keep the constructor from throwing.
;(process as unknown as { resourcesPath: string }).resourcesPath = '/tmp/never-used'

// Mock Electron — the CompilerModule constructor and its private
// path resolvers reach for `app.getPath('userData')`, `app.isPackaged`,
// and `app.getAppPath()` at module load.  None of those exist in
// Jest's CJS runtime.  The test overrides `sourceDirectoryPath` after
// construction, so the returned mock values just have to keep
// constructor paths from throwing.
jest.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/never-used',
    isPackaged: false,
    getAppPath: () => '/tmp/never-used',
  },
}))

// Mock strucpp — `loadStrucpp` runs at module load via
// `strucpp-runtime.ts`, and we don't need it for these tests.
jest.mock(
  'strucpp',
  () => ({
    compileStlib: jest.fn(),
    loadStlibFromString: jest.fn((text: string) => JSON.parse(text)),
  }),
  { virtual: true },
)

import { CompilerModule } from '../compiler-module'

function makeModule(sourceDir: string): CompilerModule {
  const m = new CompilerModule()
  // The constructor resolves this from packaged app paths; in tests
  // we point it at a temp dir we control.
  ;(m as unknown as { sourceDirectoryPath: string }).sourceDirectoryPath = sourceDir
  return m
}

describe('loadFirmwareSkeletonInMemory', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'fw-skeleton-'))
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('returns an empty map for openplc-compiler (runtime v4 path)', async () => {
    // v4 builds source strucpp runtime headers via
    // `loadStrucppRuntimeHeaders` directly — no Arduino skeleton is
    // needed.  The method short-circuits before any disk read.
    const m = makeModule(tmp)
    const result = await m.loadFirmwareSkeletonInMemory('openplc-compiler')
    expect(result).toEqual({})
  })

  it('loads arduino/* into src/<filename> and Baremetal/* into examples/Baremetal/<filename>', async () => {
    mkdirSync(join(tmp, 'arduino'), { recursive: true })
    writeFileSync(join(tmp, 'arduino', 'openplc.h'), '#pragma once\n')
    writeFileSync(join(tmp, 'arduino', 'arduino_runtime_glue.cpp'), '// glue\n')

    mkdirSync(join(tmp, 'Baremetal'), { recursive: true })
    writeFileSync(join(tmp, 'Baremetal', 'Baremetal.ino'), '/* sketch */\n')
    writeFileSync(join(tmp, 'Baremetal', 'ModbusSlave.cpp'), '/* mb */\n')

    const m = makeModule(tmp)
    const result = await m.loadFirmwareSkeletonInMemory('arduino-cli')

    expect(result['src/openplc.h']).toBe('#pragma once\n')
    expect(result['src/arduino_runtime_glue.cpp']).toBe('// glue\n')
    expect(result['examples/Baremetal/Baremetal.ino']).toBe('/* sketch */\n')
    expect(result['examples/Baremetal/ModbusSlave.cpp']).toBe('/* mb */\n')
  })

  it('loads Baremetal/modules/* into examples/Baremetal/modules/<filename>', async () => {
    mkdirSync(join(tmp, 'arduino'), { recursive: true })
    mkdirSync(join(tmp, 'Baremetal', 'modules'), { recursive: true })
    writeFileSync(join(tmp, 'Baremetal', 'Baremetal.ino'), '/* sketch */\n')
    writeFileSync(join(tmp, 'Baremetal', 'modules', 'modbus_master.cpp'), '/* mm */\n')
    writeFileSync(join(tmp, 'Baremetal', 'modules', 'modbus_master.h'), '#pragma once\n')

    const m = makeModule(tmp)
    const result = await m.loadFirmwareSkeletonInMemory('simulator')

    expect(result['examples/Baremetal/modules/modbus_master.cpp']).toBe('/* mm */\n')
    expect(result['examples/Baremetal/modules/modbus_master.h']).toBe('#pragma once\n')
    // Sketch file stays at the top level.
    expect(result['examples/Baremetal/Baremetal.ino']).toBe('/* sketch */\n')
  })

  it('skips subdirectories of Baremetal/ that are NOT "modules" (forward compat)', async () => {
    mkdirSync(join(tmp, 'arduino'), { recursive: true })
    mkdirSync(join(tmp, 'Baremetal', 'extras'), { recursive: true })
    writeFileSync(join(tmp, 'Baremetal', 'Baremetal.ino'), '/* sketch */\n')
    writeFileSync(join(tmp, 'Baremetal', 'extras', 'README.md'), 'should not ship\n')

    const m = makeModule(tmp)
    const result = await m.loadFirmwareSkeletonInMemory('simulator')

    expect(result['examples/Baremetal/Baremetal.ino']).toBe('/* sketch */\n')
    // `extras/` is not whitelisted, so its contents are skipped.
    expect(Object.keys(result).some((k) => k.includes('extras'))).toBe(false)
  })

  it('returns an empty arduino-section when resources/sources/arduino/ is missing', async () => {
    // Defensive: a broken / partially-deleted install may have
    // Baremetal/ but no arduino/.  Method swallows the readdir
    // error and returns whatever it DID load — the pipeline /
    // composer surfaces the missing-headers failure downstream.
    mkdirSync(join(tmp, 'Baremetal'), { recursive: true })
    writeFileSync(join(tmp, 'Baremetal', 'Baremetal.ino'), '/* sketch */\n')

    const m = makeModule(tmp)
    const result = await m.loadFirmwareSkeletonInMemory('simulator')

    expect(result['examples/Baremetal/Baremetal.ino']).toBe('/* sketch */\n')
    expect(Object.keys(result).some((k) => k.startsWith('src/'))).toBe(false)
  })

  it('returns an empty Baremetal section when resources/sources/Baremetal/ is missing', async () => {
    mkdirSync(join(tmp, 'arduino'), { recursive: true })
    writeFileSync(join(tmp, 'arduino', 'openplc.h'), '#pragma once\n')

    const m = makeModule(tmp)
    const result = await m.loadFirmwareSkeletonInMemory('simulator')

    expect(result['src/openplc.h']).toBe('#pragma once\n')
    expect(Object.keys(result).some((k) => k.startsWith('examples/Baremetal/'))).toBe(false)
  })

  it('returns an empty map when both directories are missing (still resolves, no throw)', async () => {
    // Worst case: the entire resources/sources tree is gone (corrupt
    // install).  Method must not throw — the pipeline's downstream
    // arduino-cli compile step will surface a missing-sketch error,
    // which is easier to diagnose than an unhandled ENOENT here.
    const m = makeModule(tmp)
    const result = await m.loadFirmwareSkeletonInMemory('simulator')
    expect(result).toEqual({})
  })

  it('only includes files, not subdirectories, from arduino/', async () => {
    mkdirSync(join(tmp, 'arduino', 'subdir'), { recursive: true })
    writeFileSync(join(tmp, 'arduino', 'openplc.h'), '#pragma once\n')
    writeFileSync(join(tmp, 'arduino', 'subdir', 'nested.h'), 'should not ship\n')

    const m = makeModule(tmp)
    const result = await m.loadFirmwareSkeletonInMemory('simulator')

    expect(result['src/openplc.h']).toBe('#pragma once\n')
    // Nested files under subdirs of arduino/ are not whitelisted.
    expect(Object.keys(result).some((k) => k.includes('nested'))).toBe(false)
  })
})
