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

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Mock Electron's `app.getPath('userData')` — we don't use it (we
// pass an explicit `librariesDir` to the constructor) but the import
// itself runs at module load time and would crash without this.
jest.mock('electron', () => ({
  app: { getPath: () => '/tmp/never-used' },
}))

// Mock strucpp at the require boundary — the shared shims `require`
// the pure `strucpp` entry, so that's the module-id we target.
// Returns deterministic archives with a known shape so the test can
// pin downstream behaviour without pulling in the real (ESM) package.
jest.mock(
  'strucpp',
  () => ({
    importCodesysLibraryFromBytes: jest.fn(async (bytes: Uint8Array) => ({
      success: true,
      sources: [{ fileName: 'mock.st', source: `(* imported from ${bytes.byteLength}-byte buffer *)` }],
      globalConstants: { STRING_LENGTH: 254 },
    })),
    compileStlib: jest.fn((_sources: unknown, options: { name: string; version: string; namespace: string }) => ({
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
    })),
    // Passthrough: real strucpp parses + validates the archive shape;
    // the mock just JSON.parses so the install path exercises the
    // same code without pulling in the ESM package.  Malformed input
    // throws, matching production behaviour.
    loadStlibFromString: jest.fn((text: string) => JSON.parse(text)),
  }),
  { virtual: true },
)

import type { PublicLibrary } from '../../../../middleware/shared/ports/public-catalog-types'
import { LibraryManagerModule } from '../library-manager-module'

/** Where the module actually put a library, read back from the registry. */
function installedPath(librariesDir: string, name: string): string {
  const registry = JSON.parse(readFileSync(join(librariesDir, 'registry.json'), 'utf-8'))
  const versions = (registry.libraries[name]?.versions ?? {}) as Record<string, { stlibPath: string }>
  return Object.values(versions)[0]?.stlibPath ?? ''
}

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

function makePublicLibrary(overrides: Partial<PublicLibrary> = {}): PublicLibrary {
  return {
    id: 'pub-1',
    projectId: 'project-1',
    name: 'alpha-lib',
    version: '1.0.0',
    displayName: 'Alpha Lib',
    description: null,
    license: null,
    authorHandle: 'jdoe',
    manifestPous: { functions: [], functionBlocks: [], types: [] },
    sizeBytes: 1024,
    sha256: 'a'.repeat(64),
    downloadsCount: 0,
    publishedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    isProjectPublic: false,
    projectUrl: null,
    projectStarsCount: null,
    ...overrides,
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

      // Archive lives under {librariesDir}/<name>/<version>/<name>.stlib
      const stlibPath = join(librariesDir, 'my-lib', '0.1.0', 'my-lib.stlib')
      expect(existsSync(stlibPath)).toBe(true)

      // Registry has a row keyed by name, holding that version.
      const registry = JSON.parse(readFileSync(join(librariesDir, 'registry.json'), 'utf-8'))
      expect(registry.formatVersion).toBe('2.0')
      expect(registry.libraries['my-lib'].versions['0.1.0']).toMatchObject({
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
        expect(existsSync(installedPath(librariesDir, 'OSCAT'))).toBe(true)
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
      rmSync(join(librariesDir, 'foo', '1.0.0', 'foo.stlib'))
      expect(mod.loadAll()).toEqual([])
    })
  })

  describe('loadEnabledArchives', () => {
    it('always returns bundled archives when the bundled dir exists', () => {
      writeBundled(makeArchive('iec-standard-fb'))
      const mod = makeModule()
      const result = mod.loadEnabledArchives([])
      expect(result.archives.map((a) => a.manifest.name)).toEqual(['iec-standard-fb'])
      expect(result.missing).toEqual([])
    })

    it('returns no archives when the bundled dir is absent and nothing is enabled', () => {
      const mod = makeModule()
      const result = mod.loadEnabledArchives([])
      expect(result.archives).toEqual([])
      expect(result.missing).toEqual([])
    })

    it('appends parsed archives for installed user libs that are enabled', async () => {
      writeBundled(makeArchive('iec-standard-fb'))
      const mod = makeModule()
      const tmp = join(testRoot, 'oscat.stlib')
      writeFileSync(tmp, JSON.stringify(makeArchive('oscat-basic')), 'utf-8')
      await mod.installFromFile(tmp)

      const result = mod.loadEnabledArchives([{ name: 'oscat-basic' }])
      expect(result.archives.map((a) => a.manifest.name)).toEqual(['iec-standard-fb', 'oscat-basic'])
      expect(result.missing).toEqual([])
    })

    it('does not include user libs that are installed but not enabled', async () => {
      const mod = makeModule()
      const tmp = join(testRoot, 'oscat.stlib')
      writeFileSync(tmp, JSON.stringify(makeArchive('oscat-basic')), 'utf-8')
      await mod.installFromFile(tmp)

      const result = mod.loadEnabledArchives([])
      // Bundled dir doesn't exist in this test harness.
      expect(result.archives).toEqual([])
    })

    it('reports enabled libraries that have no archive on disk', async () => {
      const mod = makeModule()
      const tmp = join(testRoot, 'foo.stlib')
      writeFileSync(tmp, JSON.stringify(makeArchive('foo')), 'utf-8')
      await mod.installFromFile(tmp)
      // Wipe the archive but keep the registry entry — pre-compile
      // gate should detect this as missing.
      rmSync(join(librariesDir, 'foo', '1.0.0', 'foo.stlib'))

      const result = mod.loadEnabledArchives([{ name: 'foo' }, { name: 'phantom' }])
      expect(result.archives).toEqual([])
      expect(result.missing).toEqual(['foo', 'phantom'])
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

  describe('installFromCatalog', () => {
    function makeStubTransport(
      archives: Record<string, ReturnType<typeof makeArchive>>,
      errors: Record<string, string> = {},
    ) {
      return {
        fetchJson: jest.fn(async () => {
          throw new Error('unused in these tests')
        }),
        fetchText: jest.fn(async (path: string) => {
          // /public/libraries/:id/download
          const match = path.match(/\/public\/libraries\/([^/]+)\/download/)
          const id = match ? decodeURIComponent(match[1]) : ''
          if (errors[id]) throw new Error(errors[id])
          const archive = archives[id]
          if (!archive) throw new Error(`Catalog request failed: 404 Not Found`)
          return JSON.stringify(archive)
        }),
      }
    }

    it('downloads each id, persists it, and returns a per-item summary', async () => {
      const transport = makeStubTransport({
        'pub-1': makeArchive('alpha-lib', '1.0.0'),
        'pub-2': makeArchive('beta-lib', '2.0.0'),
      })
      const mod = new LibraryManagerModule({ librariesDir, bundledDir, catalogTransport: transport })

      const batch = await mod.installFromCatalog([
        makePublicLibrary({ id: 'pub-1', name: 'alpha-lib' }),
        makePublicLibrary({ id: 'pub-2', name: 'beta-lib' }),
      ])

      expect(batch.results).toEqual([
        { publishedLibraryId: 'pub-1', success: true, name: 'alpha-lib', version: '1.0.0' },
        { publishedLibraryId: 'pub-2', success: true, name: 'beta-lib', version: '2.0.0' },
      ])
      // Both files actually land on disk in the user-installed
      // shape so subsequent listInstalled() picks them up.
      expect(existsSync(installedPath(librariesDir, 'alpha-lib'))).toBe(true)
      expect(existsSync(installedPath(librariesDir, 'beta-lib'))).toBe(true)
      expect(mod.listInstalled().map((r) => r.name)).toEqual(['alpha-lib', 'beta-lib'])
    })

    it("persists the catalog row's displayName/description onto the archive's own manifest", async () => {
      // listInstalled() derives displayName/description by re-reading
      // the persisted archive's manifest off disk — there's no
      // separate metadata store on this platform — so the override
      // has to land inside the .stlib file itself to be visible.
      const transport = makeStubTransport({ 'pub-1': makeArchive('alpha-lib', '1.0.0') })
      const mod = new LibraryManagerModule({ librariesDir, bundledDir, catalogTransport: transport })

      await mod.installFromCatalog([
        makePublicLibrary({
          id: 'pub-1',
          name: 'alpha-lib',
          displayName: 'ACME Industrial',
          description: 'Catalog description',
        }),
      ])

      const installed = mod.listInstalled().find((l) => l.name === 'alpha-lib')
      expect(installed).toMatchObject({ displayName: 'ACME Industrial', description: 'Catalog description' })

      const persistedArchive = JSON.parse(readFileSync(installedPath(librariesDir, 'alpha-lib'), 'utf-8'))
      expect(persistedArchive.manifest.displayName).toBe('ACME Industrial')
      expect(persistedArchive.manifest.description).toBe('Catalog description')
    })

    it('leaves the archive untouched when catalog metadata matches the manifest already', async () => {
      const archive = makeArchive('alpha-lib', '1.0.0')
      const transport = makeStubTransport({ 'pub-1': archive })
      const mod = new LibraryManagerModule({ librariesDir, bundledDir, catalogTransport: transport })

      await mod.installFromCatalog([
        makePublicLibrary({
          id: 'pub-1',
          name: 'alpha-lib',
          displayName: '',
          description: archive.manifest.description,
        }),
      ])

      const persistedText = readFileSync(installedPath(librariesDir, 'alpha-lib'), 'utf-8')
      expect(JSON.parse(persistedText)).toEqual(archive)
    })

    it('reports per-item failures without aborting the batch', async () => {
      const transport = makeStubTransport(
        { 'pub-good': makeArchive('good-lib', '1.0.0') },
        { 'pub-bad': 'Catalog request failed: 503 Service Unavailable' },
      )
      const mod = new LibraryManagerModule({ librariesDir, bundledDir, catalogTransport: transport })

      const batch = await mod.installFromCatalog([
        makePublicLibrary({ id: 'pub-bad' }),
        makePublicLibrary({ id: 'pub-good', name: 'good-lib' }),
      ])

      expect(batch.results).toHaveLength(2)
      expect(batch.results[0]).toMatchObject({
        publishedLibraryId: 'pub-bad',
        success: false,
        error: expect.stringContaining('503'),
      })
      expect(batch.results[1]).toMatchObject({
        publishedLibraryId: 'pub-good',
        success: true,
        name: 'good-lib',
      })
      // The good one still made it to disk.
      expect(existsSync(installedPath(librariesDir, 'good-lib'))).toBe(true)
    })

    it('returns an empty batch when called with no ids', async () => {
      const transport = makeStubTransport({})
      const mod = new LibraryManagerModule({ librariesDir, bundledDir, catalogTransport: transport })

      const batch = await mod.installFromCatalog([])

      expect(batch.results).toEqual([])
      expect(transport.fetchText).not.toHaveBeenCalled()
    })

    it('surfaces a conflict when a download matches a bundled library name', async () => {
      writeBundled(makeArchive('iec-standard-fb'))
      const transport = makeStubTransport({
        'pub-x': makeArchive('iec-standard-fb', '9.9.9'),
      })
      const mod = new LibraryManagerModule({ librariesDir, bundledDir, catalogTransport: transport })

      const batch = await mod.installFromCatalog([makePublicLibrary({ id: 'pub-x', name: 'iec-standard-fb' })])

      expect(batch.results).toHaveLength(1)
      expect(batch.results[0]).toMatchObject({
        publishedLibraryId: 'pub-x',
        success: false,
        name: 'iec-standard-fb',
        error: expect.stringContaining('bundled library'),
      })
    })
  })
  describe('versions side by side', () => {
    /** Install `name` at `version` through the normal file path. */
    async function install(mod: LibraryManagerModule, name: string, version: string) {
      const tmp = join(testRoot, `${name}-${version}.stlib`)
      writeFileSync(tmp, JSON.stringify(makeArchive(name, version)), 'utf-8')
      return mod.installFromFile(tmp)
    }

    it('keeps both versions on disk and in the registry', async () => {
      const mod = makeModule()
      await install(mod, 'node-uio', '0.0.1')
      await install(mod, 'node-uio', '0.0.2')

      expect(existsSync(join(librariesDir, 'node-uio', '0.0.1', 'node-uio.stlib'))).toBe(true)
      expect(existsSync(join(librariesDir, 'node-uio', '0.0.2', 'node-uio.stlib'))).toBe(true)
      const registry = JSON.parse(readFileSync(join(librariesDir, 'registry.json'), 'utf-8'))
      expect(Object.keys(registry.libraries['node-uio'].versions).sort()).toEqual(['0.0.1', '0.0.2'])
    })

    it('reports the newest version and lists the rest', async () => {
      const mod = makeModule()
      await install(mod, 'node-uio', '0.0.1')
      await install(mod, 'node-uio', '0.0.2')

      expect(mod.listInstalled()).toEqual([
        expect.objectContaining({ name: 'node-uio', version: '0.0.2', versions: ['0.0.2', '0.0.1'] }),
      ])
    })

    it('resolves the version a project pins', async () => {
      const mod = makeModule()
      await install(mod, 'node-uio', '0.0.1')
      await install(mod, 'node-uio', '0.0.2')

      const result = mod.loadEnabledArchives([{ name: 'node-uio', version: '0.0.1' }])
      expect(result.archives.map((a) => a.manifest.version)).toEqual(['0.0.1'])
      expect(result.substituted).toEqual([])
    })

    it('falls back to the newest and reports the substitution', async () => {
      const mod = makeModule()
      await install(mod, 'node-uio', '0.0.1')

      const result = mod.loadEnabledArchives([{ name: 'node-uio', version: '0.1.0' }])
      expect(result.archives.map((a) => a.manifest.version)).toEqual(['0.0.1'])
      expect(result.missing).toEqual([])
      expect(result.substituted).toEqual([{ name: 'node-uio', wanted: '0.1.0', used: '0.0.1' }])
    })

    it('uninstalls one version and leaves the other', async () => {
      const mod = makeModule()
      await install(mod, 'node-uio', '0.0.1')
      await install(mod, 'node-uio', '0.0.2')

      expect(mod.uninstall('node-uio', '0.0.1')).toEqual({ success: true })
      expect(existsSync(join(librariesDir, 'node-uio', '0.0.1'))).toBe(false)
      expect(existsSync(join(librariesDir, 'node-uio', '0.0.2', 'node-uio.stlib'))).toBe(true)
      expect(mod.listInstalled()).toEqual([expect.objectContaining({ version: '0.0.2', versions: ['0.0.2'] })])
    })

    it('refuses to uninstall a version that is not installed', async () => {
      const mod = makeModule()
      await install(mod, 'node-uio', '0.0.1')
      expect(mod.uninstall('node-uio', '9.9.9')).toEqual({
        success: false,
        error: "Library 'node-uio' version 9.9.9 is not installed",
      })
    })

    it('installs a version whose string is not a legal path segment', async () => {
      // Semver build metadata is legal and its '+' is not a path character.
      const mod = makeModule()
      await install(mod, 'node-uio', '1.0.0')
      const tmp = join(testRoot, 'build-meta.stlib')
      writeFileSync(tmp, JSON.stringify(makeArchive('node-uio', '1.0.0+sha.abc')), 'utf-8')

      expect(await mod.installFromFile(tmp)).toMatchObject({ success: true, version: '1.0.0+sha.abc' })
      const registry = JSON.parse(readFileSync(join(librariesDir, 'registry.json'), 'utf-8'))
      // The real version is the key; the folder is only sanitised.
      expect(Object.keys(registry.libraries['node-uio'].versions).sort()).toEqual(['1.0.0', '1.0.0+sha.abc'])
      expect(mod.loadEnabledArchives([{ name: 'node-uio', version: '1.0.0+sha.abc' }]).archives).toHaveLength(1)
    })

    it('uninstalls a version whose string is not a legal path segment', async () => {
      // Regression: uninstall built its folder from the raw version and ran it
      // through validatePathId, so a version that installs fine as
      // '1.0.0+sha.abc' could never be removed. The folder comes from the
      // registry entry instead.
      const mod = makeModule()
      await install(mod, 'node-uio', '1.0.0')
      const tmp = join(testRoot, 'build-meta.stlib')
      writeFileSync(tmp, JSON.stringify(makeArchive('node-uio', '1.0.0+sha.abc')), 'utf-8')
      await mod.installFromFile(tmp)

      expect(mod.uninstall('node-uio', '1.0.0+sha.abc')).toEqual({ success: true })

      const registry = JSON.parse(readFileSync(join(librariesDir, 'registry.json'), 'utf-8'))
      expect(Object.keys(registry.libraries['node-uio'].versions)).toEqual(['1.0.0'])
      expect(mod.listInstalled()).toEqual([expect.objectContaining({ versions: ['1.0.0'] })])
    })

    it('takes the library folder with the last version', async () => {
      const mod = makeModule()
      await install(mod, 'node-uio', '0.0.1')

      expect(mod.uninstall('node-uio', '0.0.1')).toEqual({ success: true })

      expect(existsSync(join(librariesDir, 'node-uio'))).toBe(false)
      expect(mod.listInstalled()).toEqual([])
    })

    it('leaves the other versions alone when one is removed', async () => {
      const mod = makeModule()
      await install(mod, 'node-uio', '0.0.1')
      await install(mod, 'node-uio', '0.0.2')

      expect(mod.uninstall('node-uio', '0.0.2')).toEqual({ success: true })

      expect(existsSync(join(librariesDir, 'node-uio', '0.0.1', 'node-uio.stlib'))).toBe(true)
      expect(mod.listInstalled()).toEqual([expect.objectContaining({ version: '0.0.1', versions: ['0.0.1'] })])
    })

    it('re-installing a version reuses its folder rather than making another', async () => {
      const mod = makeModule()
      await install(mod, 'node-uio', '1.0.0')
      const first = installedPath(librariesDir, 'node-uio')
      await install(mod, 'node-uio', '1.0.0')

      expect(installedPath(librariesDir, 'node-uio')).toBe(first)
      expect(mod.listInstalled()).toEqual([expect.objectContaining({ versions: ['1.0.0'] })])
    })

    it('lists the versions still on disk when the newest archive is gone', async () => {
      const mod = makeModule()
      await install(mod, 'node-uio', '0.0.1')
      await install(mod, 'node-uio', '0.0.2')
      rmSync(join(librariesDir, 'node-uio', '0.0.2'), { recursive: true })

      expect(mod.listInstalled()).toEqual([
        expect.objectContaining({ name: 'node-uio', version: '0.0.1', versions: ['0.0.1'] }),
      ])
    })

    it('still resolves a library recorded by the old single-version registry', () => {
      // The v1 layout: one archive directly under the library directory.
      const legacyPath = join(librariesDir, 'legacy-lib', 'legacy-lib.stlib')
      mkdirSync(join(librariesDir, 'legacy-lib'), { recursive: true })
      writeFileSync(legacyPath, JSON.stringify(makeArchive('legacy-lib', '1.2.3')), 'utf-8')
      writeFileSync(
        join(librariesDir, 'registry.json'),
        JSON.stringify({
          formatVersion: '1.0',
          libraries: {
            'legacy-lib': { version: '1.2.3', installedAt: '', stlibPath: legacyPath, origin: 'stlib' },
          },
        }),
        'utf-8',
      )

      const mod = makeModule()
      expect(mod.listInstalled()).toEqual([
        expect.objectContaining({ name: 'legacy-lib', version: '1.2.3', versions: ['1.2.3'] }),
      ])
      const result = mod.loadEnabledArchives([{ name: 'legacy-lib', version: '1.2.3' }])
      expect(result.archives.map((a) => a.manifest.name)).toEqual(['legacy-lib'])
    })
  })
})
