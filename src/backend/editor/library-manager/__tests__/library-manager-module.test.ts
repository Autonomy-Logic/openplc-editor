/**
 * LibraryManagerModule — backend unit tests.
 *
 * Filesystem is real (under a per-test temp dir) so we exercise the
 * actual disk shape; Electron's `app` global and the strucpp module
 * are mocked because neither is available in Jest's CJS runtime.
 *
 * The strucpp mock returns deterministic stub archives keyed off the
 * sources/options it gets — that's enough to verify our codesys
 * dispatch path and the persist-archive contract without pulling in
 * the real (ESM) strucpp package.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Mock Electron's `app.getPath('userData')` — we don't use it (we
// pass an explicit `librariesDir` to the constructor) but the import
// itself runs at module load time and would crash without this.
jest.mock('electron', () => ({
  app: { getPath: () => '/tmp/never-used' },
}))

// Mock strucpp at the require boundary — the module is only imported
// lazily inside install paths, so this only needs to exist for the
// codesys-import test.  Returns deterministic archives with a known
// shape so the test can pin downstream behaviour.
jest.mock(
  'strucpp',
  () => ({
    importCodesysLibrary: jest.fn((path: string) => ({
      success: true,
      sources: [{ fileName: 'mock.st', source: `(* imported from ${path} *)` }],
      globalConstants: { STRING_LENGTH: 254 },
    })),
    compileStlib: jest.fn(
      (
        _sources: unknown,
        options: { name: string; version: string; namespace: string },
      ) => ({
        success: true,
        archive: {
          manifest: {
            name: options.name,
            version: options.version,
            namespace: options.namespace,
            description: 'mock codesys-imported library',
            isBuiltin: false,
            functions: [],
            functionBlocks: [],
            types: [],
          },
        },
      }),
    ),
    loadStlibFromFile: jest.fn(),
  }),
  { virtual: true },
)

import { LibraryManagerModule } from '../library-manager-module'

function makeArchive(name: string, version = '1.0.0') {
  return {
    manifest: {
      name,
      version,
      namespace: name,
      description: `${name} description`,
      isBuiltin: false,
      functions: [],
      functionBlocks: [],
      types: [],
    },
  }
}

let testRoot: string
let librariesDir: string
let bundledDir: string

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), 'library-manager-test-'))
  librariesDir = join(testRoot, 'libraries')
  bundledDir = join(testRoot, 'bundled')
})

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true })
})

function makeModule(): LibraryManagerModule {
  // Constructor calls mkdirSync(librariesDir, { recursive: true });
  // bundledDir is consulted lazily, so it can be empty/missing.
  return new LibraryManagerModule({ librariesDir, bundledDir })
}

function writeBundled(archive: ReturnType<typeof makeArchive>): void {
  // The bundled discovery walks `<bundledDir>/*.stlib`.  Mirror that
  // shape so the test covers the same code path the real app uses.
  if (!existsSync(bundledDir)) {
    require('fs').mkdirSync(bundledDir, { recursive: true })
  }
  writeFileSync(join(bundledDir, `${archive.manifest.name}.stlib`), JSON.stringify(archive), 'utf-8')
}

describe('LibraryManagerModule', () => {
  describe('listInstalled', () => {
    it('returns an empty list when nothing is installed and the bundled dir is missing', () => {
      const mod = makeModule()
      expect(mod.listInstalled()).toEqual([])
    })

    it('surfaces bundled libraries with bundled=true and origin=bundled', () => {
      writeBundled(makeArchive('iec-standard-fb', '2.0.0'))
      const mod = makeModule()
      const list = mod.listInstalled()
      expect(list).toHaveLength(1)
      expect(list[0]).toMatchObject({
        name: 'iec-standard-fb',
        version: '2.0.0',
        bundled: true,
        origin: 'bundled',
      })
      expect(list[0].installedAt).toBe('')
    })

    it('lists bundled libraries before user-installed ones', async () => {
      writeBundled(makeArchive('zzz-bundled'))
      const mod = makeModule()
      // Pre-create a user-installed entry by going through the public API.
      const tmpStlib = join(testRoot, 'aaa-user.stlib')
      writeFileSync(tmpStlib, JSON.stringify(makeArchive('aaa-user', '1.2.3')), 'utf-8')
      await mod.installFromFile(tmpStlib)

      const list = mod.listInstalled()
      expect(list.map((l) => l.name)).toEqual(['zzz-bundled', 'aaa-user'])
    })
  })

  describe('installFromFile (.stlib path)', () => {
    it('rejects non-existent files', async () => {
      const mod = makeModule()
      const result = await mod.installFromFile(join(testRoot, 'missing.stlib'))
      expect(result).toEqual({ success: false, error: expect.stringContaining('File not found') })
    })

    it('rejects unsupported extensions', async () => {
      const mod = makeModule()
      const tmp = join(testRoot, 'random.txt')
      writeFileSync(tmp, 'whatever', 'utf-8')
      const result = await mod.installFromFile(tmp)
      expect(result).toEqual({ success: false, error: expect.stringContaining('Unsupported library format') })
    })

    it('rejects malformed JSON', async () => {
      const mod = makeModule()
      const tmp = join(testRoot, 'bad.stlib')
      writeFileSync(tmp, 'this is not json', 'utf-8')
      const result = await mod.installFromFile(tmp)
      expect(result).toEqual({ success: false, error: expect.stringContaining('not valid JSON') })
    })

    it('rejects archives missing the manifest', async () => {
      const mod = makeModule()
      const tmp = join(testRoot, 'no-manifest.stlib')
      writeFileSync(tmp, JSON.stringify({ headerCode: '' }), 'utf-8')
      const result = await mod.installFromFile(tmp)
      expect(result).toEqual({ success: false, error: expect.stringContaining('missing a manifest') })
    })

    it('persists a valid archive and registers it', async () => {
      const mod = makeModule()
      const tmp = join(testRoot, 'good.stlib')
      writeFileSync(tmp, JSON.stringify(makeArchive('my-lib', '0.1.0')), 'utf-8')

      const result = await mod.installFromFile(tmp)
      expect(result).toEqual({ success: true, name: 'my-lib', version: '0.1.0', origin: 'stlib' })

      // Archive lives under {librariesDir}/<name>/<name>.stlib
      const stlibPath = join(librariesDir, 'my-lib', 'my-lib.stlib')
      expect(existsSync(stlibPath)).toBe(true)

      // Registry has a row keyed by name with the right metadata.
      const registry = JSON.parse(readFileSync(join(librariesDir, 'registry.json'), 'utf-8'))
      expect(registry.libraries['my-lib']).toMatchObject({
        version: '0.1.0',
        origin: 'stlib',
        stlibPath,
      })
    })

    it('refuses to install a library that shadows a bundled one', async () => {
      writeBundled(makeArchive('iec-standard-fb', '2.0.0'))
      const mod = makeModule()
      const tmp = join(testRoot, 'rogue.stlib')
      writeFileSync(tmp, JSON.stringify(makeArchive('iec-standard-fb', '99.0.0')), 'utf-8')
      const result = await mod.installFromFile(tmp)
      expect(result).toEqual({
        success: false,
        error: expect.stringContaining('bundled library with this name'),
      })
    })

    it('rejects manifest names that contain path separators', async () => {
      const mod = makeModule()
      const tmp = join(testRoot, 'bad-id.stlib')
      writeFileSync(tmp, JSON.stringify(makeArchive('../escape')), 'utf-8')
      const result = await mod.installFromFile(tmp)
      expect(result.success).toBe(false)
    })
  })

  describe('installFromFile (CODESYS path)', () => {
    it('runs the codesys importer + compileStlib then persists the archive', async () => {
      const mod = makeModule()
      const tmp = join(testRoot, 'OSCAT.library')
      writeFileSync(tmp, 'binary codesys content', 'utf-8')

      const result = await mod.installFromFile(tmp)
      expect(result).toMatchObject({ success: true, origin: 'codesys' })
      // Mock derives the name from the file basename, sanitised.
      if (result.success && !('canceled' in result && result.canceled)) {
        expect(result.name).toBe('OSCAT')
        expect(existsSync(join(librariesDir, 'OSCAT', 'OSCAT.stlib'))).toBe(true)
      }
    })

    it('also accepts the .lib extension', async () => {
      const mod = makeModule()
      const tmp = join(testRoot, 'standard.lib')
      writeFileSync(tmp, 'mock', 'utf-8')
      const result = await mod.installFromFile(tmp)
      expect(result.success).toBe(true)
    })
  })

  describe('uninstall', () => {
    it('refuses to uninstall a bundled library', () => {
      writeBundled(makeArchive('iec-standard-fb'))
      const mod = makeModule()
      const result = mod.uninstall('iec-standard-fb')
      expect(result).toEqual({ success: false, error: expect.stringContaining('Cannot uninstall bundled') })
    })

    it("returns an error when the library isn't installed", () => {
      const mod = makeModule()
      const result = mod.uninstall('phantom')
      expect(result).toEqual({ success: false, error: expect.stringContaining('not installed') })
    })

    it('removes a user-installed library and clears its registry entry', async () => {
      const mod = makeModule()
      const tmp = join(testRoot, 'foo.stlib')
      writeFileSync(tmp, JSON.stringify(makeArchive('foo')), 'utf-8')
      await mod.installFromFile(tmp)

      const result = mod.uninstall('foo')
      expect(result).toEqual({ success: true })
      expect(existsSync(join(librariesDir, 'foo'))).toBe(false)
      const registry = JSON.parse(readFileSync(join(librariesDir, 'registry.json'), 'utf-8'))
      expect(registry.libraries.foo).toBeUndefined()
    })

    it('rejects names with path traversal', () => {
      const mod = makeModule()
      const result = mod.uninstall('../escape')
      expect(result.success).toBe(false)
    })
  })

  describe('loadAll', () => {
    it('returns bundled archives followed by user-installed', async () => {
      writeBundled(makeArchive('aaa-bundled'))
      writeBundled(makeArchive('bbb-bundled'))
      const mod = makeModule()
      const tmp = join(testRoot, 'ccc-user.stlib')
      writeFileSync(tmp, JSON.stringify(makeArchive('ccc-user')), 'utf-8')
      await mod.installFromFile(tmp)

      const all = mod.loadAll()
      expect(all.map((a) => a.manifest.name)).toEqual(['aaa-bundled', 'bbb-bundled', 'ccc-user'])
    })

    it('skips orphaned registry entries whose .stlib went missing', async () => {
      const mod = makeModule()
      const tmp = join(testRoot, 'foo.stlib')
      writeFileSync(tmp, JSON.stringify(makeArchive('foo')), 'utf-8')
      await mod.installFromFile(tmp)
      // Simulate disk corruption: the file is gone but the registry
      // still records it.  loadAll should silently skip rather than
      // throw or return undefined entries.
      rmSync(join(librariesDir, 'foo', 'foo.stlib'))
      expect(mod.loadAll()).toEqual([])
    })
  })

  describe('registry resilience', () => {
    it('treats a missing registry.json as an empty registry', () => {
      const mod = makeModule()
      expect(mod.listInstalled()).toEqual([])
    })

    it('treats a corrupt registry.json as an empty registry', () => {
      // Construct first so the librariesDir exists, then corrupt the
      // registry behind the module's back to model an external edit.
      const mod = makeModule()
      writeFileSync(join(librariesDir, 'registry.json'), '{not json', 'utf-8')
      expect(mod.listInstalled()).toEqual([])
    })
  })
})
