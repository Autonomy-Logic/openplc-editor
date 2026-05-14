import type { LibraryPort } from '../../../shared/ports/library-port'
import { createEditorLibraryAdapter } from '../library-adapter'

let adapter: LibraryPort

beforeEach(() => {
  window.bridge = {
    loadAllLibraries: jest.fn().mockResolvedValue([{ manifest: { name: 'IEC' } }]),
    listInstalledLibraries: jest.fn().mockResolvedValue([{ name: 'IEC', bundled: true }]),
    installLibraryFromFile: jest.fn().mockResolvedValue({ success: true, installed: { name: 'oscat' } }),
    uninstallLibrary: jest.fn().mockResolvedValue({ success: true }),
    onLibrariesChanged: jest.fn().mockReturnValue(() => undefined),
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
