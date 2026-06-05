import type { StlibSourcePort } from '../../../shared/ports/stlib-source-port'
import { createEditorStlibSourceAdapter } from '../stlib-source-adapter'

let adapter: StlibSourcePort
let onLibrariesChangedHandlers: Array<() => void>

function makeArchive(name: string, version: string) {
  return {
    formatVersion: 1,
    manifest: {
      name,
      version,
      namespace: name.toLowerCase(),
      functions: [],
      functionBlocks: [],
      types: [],
      headers: [],
      isBuiltin: false,
    },
    chunks: [],
    dependencies: [],
  }
}

beforeEach(() => {
  onLibrariesChangedHandlers = []
  window.bridge = {
    loadAllLibraries: jest.fn().mockResolvedValue([makeArchive('IEC', '1.0.0'), makeArchive('Oscat', '3.3.5')]),
    onLibrariesChanged: jest.fn((cb: () => void) => {
      onLibrariesChangedHandlers.push(cb)
      return () => undefined
    }),
  } as unknown as typeof window.bridge

  adapter = createEditorStlibSourceAdapter()
})

describe('listStlibs', () => {
  it('returns one descriptor per installed archive', async () => {
    const sources = await adapter.listStlibs()

    expect(window.bridge.loadAllLibraries).toHaveBeenCalledTimes(1)
    expect(sources).toEqual([
      { name: 'IEC', version: '1.0.0', sourceLabel: 'IEC' },
      { name: 'Oscat', version: '3.3.5', sourceLabel: 'Oscat' },
    ])
  })

  it('hits the IPC bridge only once across repeated calls (cache)', async () => {
    await adapter.listStlibs()
    await adapter.listStlibs()
    await adapter.listStlibs()
    expect(window.bridge.loadAllLibraries).toHaveBeenCalledTimes(1)
  })

  it('re-fetches after a libraries:changed notification', async () => {
    await adapter.listStlibs()
    expect(window.bridge.loadAllLibraries).toHaveBeenCalledTimes(1)

    onLibrariesChangedHandlers[0]()

    await adapter.listStlibs()
    expect(window.bridge.loadAllLibraries).toHaveBeenCalledTimes(2)
  })

  it('skips archives missing a name or version (defensive)', async () => {
    ;(window.bridge.loadAllLibraries as jest.Mock).mockResolvedValueOnce([
      makeArchive('Good', '1.0.0'),
      { manifest: { name: 'NoVersion' } },
      { manifest: { version: '2.0.0' } },
      makeArchive('AlsoGood', '0.1.0'),
    ])
    const sources = await adapter.listStlibs()
    expect(sources.map((s) => s.name)).toEqual(['Good', 'AlsoGood'])
  })
})

describe('readStlib', () => {
  it('returns a JSON string of the cached archive', async () => {
    await adapter.listStlibs() // prime the cache
    const json = await adapter.readStlib('IEC')
    const parsed = JSON.parse(json) as { manifest: { name: string; version: string } }
    expect(parsed.manifest.name).toBe('IEC')
    expect(parsed.manifest.version).toBe('1.0.0')
  })

  it('primes the cache automatically on first read', async () => {
    const json = await adapter.readStlib('Oscat')
    expect(window.bridge.loadAllLibraries).toHaveBeenCalledTimes(1)
    expect(JSON.parse(json).manifest.name).toBe('Oscat')
  })

  it('throws when the sourceLabel is unknown', async () => {
    await expect(adapter.readStlib('MissingLib')).rejects.toThrow(/Unknown stlib source 'MissingLib'/)
  })
})

describe('libraries:changed subscription', () => {
  it('registers exactly one listener via window.bridge', () => {
    expect(window.bridge.onLibrariesChanged).toHaveBeenCalledTimes(1)
  })

  it('survives missing onLibrariesChanged (older bridges / test harnesses)', () => {
    window.bridge = {
      loadAllLibraries: jest.fn().mockResolvedValue([]),
    } as unknown as typeof window.bridge
    expect(() => createEditorStlibSourceAdapter()).not.toThrow()
  })
})
