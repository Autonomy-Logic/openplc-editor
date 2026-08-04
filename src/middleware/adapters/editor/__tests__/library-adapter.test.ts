import type { LibraryPort } from '../../../shared/ports/library-port'
import type { PublicLibrary } from '../../../shared/ports/public-catalog-types'
import { createEditorLibraryAdapter } from '../library-adapter'

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

let adapter: LibraryPort

beforeEach(() => {
  window.bridge = {
    loadAllLibraries: jest.fn().mockResolvedValue([{ manifest: { name: 'IEC' } }]),
    listInstalledLibraries: jest.fn().mockResolvedValue([{ name: 'IEC', bundled: true }]),
    installLibraryFromFile: jest.fn().mockResolvedValue({ success: true, installed: { name: 'oscat' } }),
    uninstallLibrary: jest.fn().mockResolvedValue({ success: true }),
    onLibrariesChanged: jest.fn().mockReturnValue(() => undefined),
    installLibrariesFromCatalog: jest.fn().mockResolvedValue({ results: [] }),
  } as unknown as typeof window.bridge

  adapter = createEditorLibraryAdapter()
})

describe('loadAll', () => {
  it('delegates to bridge and casts the unknown payload to StlibArchiveDTO[]', async () => {
    const result = await adapter.loadAll()

    expect(window.bridge.loadAllLibraries).toHaveBeenCalledTimes(1)
    expect(result).toEqual([{ manifest: { name: 'IEC' } }])
  })
})

describe('listInstalled', () => {
  it('delegates to bridge', async () => {
    const result = await adapter.listInstalled()

    expect(window.bridge.listInstalledLibraries).toHaveBeenCalledTimes(1)
    expect(result).toEqual([{ name: 'IEC', bundled: true }])
  })
})

describe('installFromFile', () => {
  it('delegates to bridge', async () => {
    const result = await adapter.installFromFile()

    expect(window.bridge.installLibraryFromFile).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ success: true, installed: { name: 'oscat' } })
  })
})

describe('uninstall', () => {
  it('normalises a successful bridge response into a Result', async () => {
    const result = await adapter.uninstall('oscat')

    expect(window.bridge.uninstallLibrary).toHaveBeenCalledWith('oscat')
    expect(result).toEqual({ success: true })
  })

  it('passes through the bridge-supplied error', async () => {
    ;(window.bridge.uninstallLibrary as jest.Mock).mockResolvedValueOnce({
      success: false,
      error: 'Library not found',
    })

    const result = await adapter.uninstall('missing')

    expect(result).toEqual({ success: false, error: 'Library not found' })
  })

  it('falls back to a generic message when the bridge omits the error string', async () => {
    ;(window.bridge.uninstallLibrary as jest.Mock).mockResolvedValueOnce({ success: false })

    const result = await adapter.uninstall('missing')

    expect(result).toEqual({ success: false, error: 'Uninstall failed' })
  })
})

describe('installFromCatalog', () => {
  it('narrows the catalog rows to bare ids before delegating to the bridge', async () => {
    const libraries = [makePublicLibrary({ id: 'pub-1' }), makePublicLibrary({ id: 'pub-2' })]
    const batch = { results: [{ publishedLibraryId: 'pub-1', success: true }] }
    ;(window.bridge.installLibrariesFromCatalog as jest.Mock).mockResolvedValueOnce(batch)

    const result = await adapter.installFromCatalog!(libraries)

    expect(window.bridge.installLibrariesFromCatalog).toHaveBeenCalledWith(['pub-1', 'pub-2'])
    expect(result).toEqual(batch)
  })
})

describe('onLibrariesChanged', () => {
  it('forwards the callback to the bridge and returns the bridge unsubscribe', () => {
    const callback = jest.fn()
    const unsub = jest.fn()
    ;(window.bridge.onLibrariesChanged as jest.Mock).mockReturnValueOnce(unsub)

    const returned = adapter.onLibrariesChanged(callback)

    expect(window.bridge.onLibrariesChanged).toHaveBeenCalledWith(callback)
    expect(returned).toBe(unsub)
  })
})
