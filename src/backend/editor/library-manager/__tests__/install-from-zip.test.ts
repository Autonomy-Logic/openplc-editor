/**
 * Installing a ZIP of `.stlib` archives.
 *
 * Same mocks as `library-manager-module.test.ts` — real filesystem under a
 * temp dir, Electron and strucpp stubbed — because the point here is what
 * lands on disk and in the registry, not what strucpp thinks of an archive.
 *
 * The case that drove the shape of the result: a bundle where one archive is
 * corrupt has to install the rest and say which one it skipped. Refusing the
 * whole ZIP over a single bad file is the behaviour this file exists to
 * prevent.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

jest.mock('electron', () => ({
  app: { getPath: () => '/tmp/never-used' },
}))

jest.mock(
  'strucpp',
  () => ({
    // Malformed input throws, the way the real loader does — that is what
    // makes a corrupt entry in the bundle a per-entry failure.
    loadStlibFromString: jest.fn((text: string) => JSON.parse(text)),
    // The CODESYS path: the importer refuses the marker below so the mixed
    // bundle has a failing .library as well as a failing .stlib.
    importCodesysLibraryFromBytes: jest.fn(async (bytes: Uint8Array) => {
      const text = new TextDecoder().decode(bytes)
      if (text.includes('REFUSE')) return { success: false, errors: ['not a CODESYS library'] }
      return { success: true, sources: [{ fileName: 'mock.st', source: '(* imported *)' }], globalConstants: {} }
    }),
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
  }),
  { virtual: true },
)

import JSZip from 'jszip'

import { LibraryManagerModule } from '../library-manager-module'

const archiveText = (name: string, version = '1.0.0') =>
  JSON.stringify({
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
  })

let testRoot: string
let librariesDir: string
let bundledDir: string

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), 'library-zip-test-'))
  librariesDir = join(testRoot, 'libraries')
  bundledDir = join(testRoot, 'bundled')
})

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true })
})

const makeModule = () => new LibraryManagerModule({ librariesDir, bundledDir })

/** Write a real ZIP to disk and hand back its path, the way the picker would. */
async function writeZip(files: Record<string, string>, name = 'bundle.zip'): Promise<string> {
  const zip = new JSZip()
  for (const [path, content] of Object.entries(files)) zip.file(path, content)
  const path = join(testRoot, name)
  writeFileSync(path, await zip.generateAsync({ type: 'uint8array' }))
  return path
}

/** Library names the registry holds, sorted. */
function registryNames(): string[] {
  return Object.keys(JSON.parse(readFileSync(join(librariesDir, 'registry.json'), 'utf-8')).libraries).sort()
}

describe('installing a ZIP of archives', () => {
  it('installs every .stlib it holds', async () => {
    const zip = await writeZip({
      'alpha.stlib': archiveText('alpha'),
      'nested/beta.stlib': archiveText('beta'),
      'gamma.stlib': archiveText('gamma', '2.1.0'),
    })

    const result = await makeModule().installFromFile(zip)

    expect(result.success).toBe(true)
    if (!result.success || !('entries' in result)) throw new Error('expected a bundle result')
    expect(result.installed).toEqual([
      { name: 'alpha', version: '1.0.0' },
      { name: 'gamma', version: '2.1.0' },
      { name: 'beta', version: '1.0.0' },
    ])
    expect(result.failed).toEqual([])
    expect(registryNames()).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('writes each archive where a single install would have put it', async () => {
    const zip = await writeZip({ 'alpha.stlib': archiveText('alpha') })
    await makeModule().installFromFile(zip)

    const registry = JSON.parse(readFileSync(join(librariesDir, 'registry.json'), 'utf-8'))
    const entry = registry.libraries.alpha.versions['1.0.0']
    expect(entry.origin).toBe('stlib')
    expect(readFileSync(entry.stlibPath, 'utf-8')).toBe(archiveText('alpha'))
  })

  it('installs the good ones and names the bad one, rather than refusing the lot', async () => {
    const zip = await writeZip({
      'alpha.stlib': archiveText('alpha'),
      'broken.stlib': 'this is not JSON',
      'gamma.stlib': archiveText('gamma'),
    })

    const result = await makeModule().installFromFile(zip)

    expect(result.success).toBe(true)
    if (!result.success || !('entries' in result)) throw new Error('expected a bundle result')
    expect(result.installed.map((library) => library.name)).toEqual(['alpha', 'gamma'])
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0].path).toBe('broken.stlib')
    expect(registryNames()).toEqual(['alpha', 'gamma'])
  })

  it('reports a plain failure when nothing installed', async () => {
    // Nothing to select and no reason to refresh, so a partial success here
    // would be a lie dressed as one.
    const zip = await writeZip({ 'a.stlib': 'nope', 'b.stlib': 'also nope' })

    const result = await makeModule().installFromFile(zip)

    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected a failure')
    expect(result.error).toContain('No libraries installed')
    expect(result.error).toContain('a.stlib')
    expect(result.error).toContain('b.stlib')
  })

  it('refuses a ZIP holding no library files', async () => {
    const zip = await writeZip({ 'readme.txt': 'nothing here' })
    const result = await makeModule().installFromFile(zip)

    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected a failure')
    expect(result.error).toContain('no .stlib, .lib or .library files')
  })

  it('refuses a file that is not a ZIP at all', async () => {
    const path = join(testRoot, 'fake.zip')
    writeFileSync(path, 'definitely not a zip')

    const result = await makeModule().installFromFile(path)

    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected a failure')
    expect(result.error).toContain('Not a readable ZIP archive')
  })

  it('still refuses a format it has no path for', async () => {
    const path = join(testRoot, 'thing.tar')
    writeFileSync(path, 'x')

    const result = await makeModule().installFromFile(path)

    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected a failure')
    expect(result.error).toContain('.zip')
  })

  it('installs CODESYS files in the bundle alongside the archives', async () => {
    const zip = await writeZip({
      'alpha.stlib': archiveText('alpha'),
      'vendor/OSCAT.library': 'codesys bytes',
      'vendor/legacy.lib': 'codesys bytes',
    })

    const result = await makeModule().installFromFile(zip)

    expect(result.success).toBe(true)
    if (!result.success || !('entries' in result)) throw new Error('expected a bundle result')
    expect(result.failed).toEqual([])
    // The mock derives each name from the file basename, sanitised.
    expect(result.installed.map((library) => library.name).sort()).toEqual(['OSCAT', 'alpha', 'legacy'])
    expect(result.entries.map((entry) => entry.success && entry.origin).sort()).toEqual(['codesys', 'codesys', 'stlib'])
    expect(registryNames()).toEqual(['OSCAT', 'alpha', 'legacy'])
  })

  it('reports a CODESYS file that fails to import without touching the rest', async () => {
    const zip = await writeZip({
      'alpha.stlib': archiveText('alpha'),
      'bad.library': 'REFUSE this one',
    })

    const result = await makeModule().installFromFile(zip)

    expect(result.success).toBe(true)
    if (!result.success || !('entries' in result)) throw new Error('expected a bundle result')
    expect(result.installed.map((library) => library.name)).toEqual(['alpha'])
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0].path).toBe('bad.library')
    expect(result.failed[0].error).toContain('not a CODESYS library')
  })

  it('lands every version when the bundle carries several of one library', async () => {
    // The reason a bundle exists at all in some vendor drops: one library,
    // built for several releases, meant to sit side by side.
    const zip = await writeZip({
      'alpha-1.stlib': archiveText('alpha', '1.0.0'),
      'alpha-2.stlib': archiveText('alpha', '2.0.0'),
    })

    await makeModule().installFromFile(zip)

    const registry = JSON.parse(readFileSync(join(librariesDir, 'registry.json'), 'utf-8'))
    expect(Object.keys(registry.libraries.alpha.versions).sort()).toEqual(['1.0.0', '2.0.0'])
  })
})
