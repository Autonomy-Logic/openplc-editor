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

// Mock strucpp at the require boundary — the shared shims `require`
// the pure `strucpp` entry, so that's the module-id we target.
// Returns deterministic archives with a known shape so the test can
// pin downstream behaviour without pulling in the real (ESM) package.
jest.mock('strucpp', () => ({
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
}))

import type { PublicLibrary } from '../../../../middleware/shared/ports/public-catalog-types'
import { HMI_CORE_API_VERSION } from '../../../../middleware/shared/utils/hmi/widget-libraries'
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
let hmiWidgetsDir: string

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), 'library-manager-test-'))
  librariesDir = join(testRoot, 'libraries')
  bundledDir = join(testRoot, 'bundled')
  hmiWidgetsDir = join(testRoot, 'hmi-widgets')
})

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true })
})

function makeModule(): LibraryManagerModule {
  // Constructor calls mkdirSync(librariesDir, { recursive: true });
  // bundledDir is consulted lazily, so it can be empty/missing.
  return new LibraryManagerModule({ librariesDir, bundledDir, hmiWidgetsDir })
}

/** An archive whose one chunk needs the HMI core at `version`, as a widget library's do. */
function needingCore(archive: ReturnType<typeof makeArchive>, version = String(HMI_CORE_API_VERSION)) {
  return {
    ...archive,
    chunks: [{ name: 'W', kind: 'functionBlock', deps: [], headers: [{ name: 'hmi_core.h', version }] }],
  }
}

/** Puts an archive among the pre-installed HMI widgets release. */
function writeHmiWidget(archive: object & { manifest: { name: string } }): void {
  require('fs').mkdirSync(hmiWidgetsDir, { recursive: true })
  writeFileSync(join(hmiWidgetsDir, `${archive.manifest.name}.stlib`), JSON.stringify(archive), 'utf-8')
}

function writeBundled(archive: object & { manifest: { name: string } }): void {
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

    it('keeps every top-level field of bundled and user archives, known or not', async () => {
      const bundled = { ...makeArchive('aaa-bundled'), futureField: 'bundled' }
      writeBundled(bundled)
      const mod = makeModule()
      const tmp = join(testRoot, 'ccc-user.stlib')
      writeFileSync(tmp, JSON.stringify({ ...makeArchive('ccc-user'), futureField: 'user' }), 'utf-8')
      await mod.installFromFile(tmp)

      expect(mod.loadAll()).toEqual([
        { ...makeArchive('aaa-bundled'), futureField: 'bundled' },
        { ...makeArchive('ccc-user'), futureField: 'user' },
      ])
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

      const result = mod.loadEnabledArchives(['oscat-basic'])
      expect(result.archives.map((a) => a.manifest.name)).toEqual(['iec-standard-fb', 'oscat-basic'])
      expect(result.missing).toEqual([])
    })

    it('leaves out user libs that are installed but not enabled', async () => {
      const mod = makeModule()
      const tmp = join(testRoot, 'oscat.stlib')
      writeFileSync(tmp, JSON.stringify(makeArchive('oscat-basic')), 'utf-8')
      await mod.installFromFile(tmp)

      const result = mod.loadEnabledArchives([])
      // Bundled dir doesn't exist in this test harness.
      expect(result.archives).toEqual([])
      expect(result.missing).toEqual([])
    })

    it('reports enabled libraries that have no archive on disk', async () => {
      const mod = makeModule()
      const tmp = join(testRoot, 'foo.stlib')
      writeFileSync(tmp, JSON.stringify(makeArchive('foo')), 'utf-8')
      await mod.installFromFile(tmp)
      // Wipe the archive but keep the registry entry — pre-compile
      // gate should detect this as missing.
      rmSync(join(librariesDir, 'foo', 'foo.stlib'))

      const result = mod.loadEnabledArchives(['foo', 'phantom'])
      expect(result.archives).toEqual([])
      expect(result.missing).toEqual(['foo', 'phantom'])
    })
  })

  describe('pre-installed HMI libraries', () => {
    it('lists the HMI widgets release as bundled rows, after the strucpp libraries', () => {
      writeBundled(makeArchive('iec-standard-fb'))
      writeHmiWidget(needingCore(makeArchive('standard-widgets')))
      writeHmiWidget(makeArchive('hmi-alarms'))
      writeFileSync(join(hmiWidgetsDir, 'SHA256SUMS'), '', 'utf-8')
      writeFileSync(join(hmiWidgetsDir, 'LICENSE'), 'GPLv3', 'utf-8')
      const rows = makeModule().listInstalled()
      expect(rows.map((r) => [r.name, r.bundled, r.origin])).toEqual([
        ['iec-standard-fb', true, 'bundled'],
        ['hmi-alarms', true, 'bundled'],
        ['standard-widgets', true, 'bundled'],
      ])
    })

    it('refuses to uninstall or shadow a pre-installed HMI library', async () => {
      writeHmiWidget(needingCore(makeArchive('standard-widgets')))
      const mod = makeModule()
      expect(mod.uninstall('standard-widgets')).toEqual({
        success: false,
        error: "Cannot uninstall bundled library 'standard-widgets'",
      })
      const tmp = join(testRoot, 'standard-widgets.stlib')
      writeFileSync(tmp, JSON.stringify(needingCore(makeArchive('standard-widgets'))), 'utf-8')
      const result = await mod.installFromFile(tmp)
      expect(result.success).toBe(false)
      expect(mod.listInstalled().map((r) => r.name)).toEqual(['standard-widgets'])
    })

    it('reads a pre-installed HMI archive as text', () => {
      writeHmiWidget(makeArchive('hmi-alarms'))
      expect(JSON.parse(makeModule().readArchiveText('hmi-alarms') ?? '')).toMatchObject({
        manifest: { name: 'hmi-alarms' },
      })
    })

    it('builds with the pre-installed libraries and the enabled ones only', async () => {
      writeHmiWidget(needingCore(makeArchive('standard-widgets')))
      const mod = makeModule()
      for (const archive of [needingCore(makeArchive('extra-widgets')), makeArchive('oscat-basic')]) {
        const tmp = join(testRoot, `${archive.manifest.name}.stlib`)
        writeFileSync(tmp, JSON.stringify(archive), 'utf-8')
        expect((await mod.installFromFile(tmp)).success).toBe(true)
      }
      expect(mod.loadEnabledArchives([]).archives.map((a) => a.manifest.name)).toEqual(['standard-widgets'])
      expect(mod.loadEnabledArchives(['oscat-basic']).archives.map((a) => a.manifest.name)).toEqual([
        'standard-widgets',
        'oscat-basic',
      ])
      expect(mod.loadEnabledArchives(['extra-widgets', 'oscat-basic']).archives.map((a) => a.manifest.name)).toEqual([
        'standard-widgets',
        'extra-widgets',
        'oscat-basic',
      ])
    })

    it('installs a library built for another HMI core API, and warns on its row that HMI builds leave it out', async () => {
      const tmp = join(testRoot, 'old-widgets.stlib')
      writeFileSync(tmp, JSON.stringify(needingCore(makeArchive('old-widgets'), String(HMI_CORE_API_VERSION + 1))))
      const mod = makeModule()
      expect((await mod.installFromFile(tmp)).success).toBe(true)
      expect(mod.listInstalled().find((r) => r.name === 'old-widgets')?.warning).toBe(
        `The library "old-widgets" is left out of HMI builds: it is built for HMI core API ` +
          `${HMI_CORE_API_VERSION + 1}, but this editor provides HMI core API ${HMI_CORE_API_VERSION}. Install a ` +
          `build of the library for HMI core API ${HMI_CORE_API_VERSION}.`,
      )
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
      const mod = new LibraryManagerModule({ librariesDir, bundledDir, hmiWidgetsDir, catalogTransport: transport })

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
      expect(existsSync(join(librariesDir, 'alpha-lib', 'alpha-lib.stlib'))).toBe(true)
      expect(existsSync(join(librariesDir, 'beta-lib', 'beta-lib.stlib'))).toBe(true)
      expect(mod.listInstalled().map((r) => r.name)).toEqual(['alpha-lib', 'beta-lib'])
    })

    it("persists the catalog row's displayName/description onto the archive's own manifest", async () => {
      // listInstalled() derives displayName/description by re-reading
      // the persisted archive's manifest off disk — there's no
      // separate metadata store on this platform — so the override
      // has to land inside the .stlib file itself to be visible.
      const transport = makeStubTransport({ 'pub-1': makeArchive('alpha-lib', '1.0.0') })
      const mod = new LibraryManagerModule({ librariesDir, bundledDir, hmiWidgetsDir, catalogTransport: transport })

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

      const persistedArchive = JSON.parse(readFileSync(join(librariesDir, 'alpha-lib', 'alpha-lib.stlib'), 'utf-8'))
      expect(persistedArchive.manifest.displayName).toBe('ACME Industrial')
      expect(persistedArchive.manifest.description).toBe('Catalog description')
    })

    it('leaves the archive untouched when catalog metadata matches the manifest already', async () => {
      const archive = makeArchive('alpha-lib', '1.0.0')
      const transport = makeStubTransport({ 'pub-1': archive })
      const mod = new LibraryManagerModule({ librariesDir, bundledDir, hmiWidgetsDir, catalogTransport: transport })

      await mod.installFromCatalog([
        makePublicLibrary({
          id: 'pub-1',
          name: 'alpha-lib',
          displayName: '',
          description: archive.manifest.description,
        }),
      ])

      const persistedText = readFileSync(join(librariesDir, 'alpha-lib', 'alpha-lib.stlib'), 'utf-8')
      expect(JSON.parse(persistedText)).toEqual(archive)
    })

    it('reports per-item failures without aborting the batch', async () => {
      const transport = makeStubTransport(
        { 'pub-good': makeArchive('good-lib', '1.0.0') },
        { 'pub-bad': 'Catalog request failed: 503 Service Unavailable' },
      )
      const mod = new LibraryManagerModule({ librariesDir, bundledDir, hmiWidgetsDir, catalogTransport: transport })

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
      expect(existsSync(join(librariesDir, 'good-lib', 'good-lib.stlib'))).toBe(true)
    })

    it('returns an empty batch when called with no ids', async () => {
      const transport = makeStubTransport({})
      const mod = new LibraryManagerModule({ librariesDir, bundledDir, hmiWidgetsDir, catalogTransport: transport })

      const batch = await mod.installFromCatalog([])

      expect(batch.results).toEqual([])
      expect(transport.fetchText).not.toHaveBeenCalled()
    })

    it('surfaces a conflict when a download matches a bundled library name', async () => {
      writeBundled(makeArchive('iec-standard-fb'))
      const transport = makeStubTransport({
        'pub-x': makeArchive('iec-standard-fb', '9.9.9'),
      })
      const mod = new LibraryManagerModule({ librariesDir, bundledDir, hmiWidgetsDir, catalogTransport: transport })

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
})

describe('LibraryManagerModule library objects', () => {
  it('keeps a compiled object next to a user library, by kind, and removes it with the library', async () => {
    const mod = makeModule()
    const stlib = join(testRoot, 'alpha.stlib')
    writeFileSync(stlib, JSON.stringify(makeArchive('alpha-lib')), 'utf-8')
    expect((await mod.installFromFile(stlib)).success).toBe(true)
    expect(mod.readLibraryObject('alpha-lib', 'hmi')).toBeNull()
    mod.writeLibraryObject('alpha-lib', 'hmi', new Uint8Array([1, 2, 3]))
    mod.writeLibraryObject('alpha-lib', 'simulator', new Uint8Array([4]))
    expect(mod.readLibraryObject('alpha-lib', 'hmi')).toEqual(new Uint8Array([1, 2, 3]))
    expect(mod.readLibraryObject('alpha-lib', 'simulator')).toEqual(new Uint8Array([4]))
    expect(existsSync(join(librariesDir, 'alpha-lib', 'alpha-lib.hmi.wasm-object'))).toBe(true)
    expect(mod.uninstall('alpha-lib').success).toBe(true)
    expect(mod.readLibraryObject('alpha-lib', 'hmi')).toBeNull()
  })

  it('keeps nothing for a bundled or unknown library, or a kind that is not a plain name', async () => {
    writeBundled(makeArchive('bundled-lib'))
    const mod = makeModule()
    mod.writeLibraryObject('bundled-lib', 'hmi', new Uint8Array([1]))
    mod.writeLibraryObject('nobody', 'hmi', new Uint8Array([1]))
    expect(mod.readLibraryObject('bundled-lib', 'hmi')).toBeNull()
    expect(mod.readLibraryObject('nobody', 'hmi')).toBeNull()
    const stlib = join(testRoot, 'alpha.stlib')
    writeFileSync(stlib, JSON.stringify(makeArchive('alpha-lib')), 'utf-8')
    await mod.installFromFile(stlib)
    mod.writeLibraryObject('alpha-lib', '../x', new Uint8Array([1]))
    expect(mod.readLibraryObject('alpha-lib', '../x')).toBeNull()
    expect(mod.readLibraryObject('../alpha-lib', 'hmi')).toBeNull()
  })
})
