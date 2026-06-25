/**
 * @jest-environment jsdom
 */
import type { PlatformPorts } from '../../../../middleware/shared/providers/types'

// Mock the orchestrator + sync layers BEFORE importing boot so the
// boot module pulls in the mocked versions.  We're testing wiring,
// not the orchestrator itself.
const startStLsp = jest.fn()
const attachProjectSync = jest.fn()
const attachLibrarySync = jest.fn()
const attachEnabledLibrariesSync = jest.fn()
const attachBundledLibrariesSync = jest.fn()

jest.mock('../index', () => ({
  startStLsp: (...args: unknown[]) => startStLsp(...args),
}))
jest.mock('../project-sync', () => ({
  attachProjectSync: (...args: unknown[]) => attachProjectSync(...args),
  attachLibrarySync: (...args: unknown[]) => attachLibrarySync(...args),
  attachEnabledLibrariesSync: (...args: unknown[]) => attachEnabledLibrariesSync(...args),
  attachBundledLibrariesSync: (...args: unknown[]) => attachBundledLibrariesSync(...args),
}))

import { bootStLsp } from '../boot'

function makePorts(overrides: Partial<PlatformPorts> = {}): PlatformPorts {
  return {
    capabilities: {
      hasStLSP: true,
    },
    stlibSource: {
      listStlibs: jest.fn(),
      readStlib: jest.fn(),
    },
    ...overrides,
  } as unknown as PlatformPorts
}

const monacoStub = {} as typeof import('monaco-editor')

beforeEach(() => {
  startStLsp.mockReset()
  attachProjectSync.mockReset()
  attachLibrarySync.mockReset()
  attachEnabledLibrariesSync.mockReset()
  attachBundledLibrariesSync.mockReset()

  startStLsp.mockReturnValue({
    ready: Promise.resolve(),
    refreshStlibs: jest.fn(),
    openDocument: jest.fn(),
    changeDocument: jest.fn(),
    closeDocument: jest.fn(),
    dispose: jest.fn(),
  })
  attachProjectSync.mockReturnValue({
    resync: jest.fn(),
    forceResync: jest.fn(),
    dispose: jest.fn(),
  })
  attachLibrarySync.mockReturnValue(jest.fn())
  attachEnabledLibrariesSync.mockReturnValue(jest.fn())
  attachBundledLibrariesSync.mockReturnValue(jest.fn())
})

describe('bootStLsp', () => {
  it('returns null when hasStLSP is false', () => {
    const handle = bootStLsp(
      makePorts({
        capabilities: { hasStLSP: false } as PlatformPorts['capabilities'],
      }),
      monacoStub,
    )
    expect(handle).toBeNull()
    expect(startStLsp).not.toHaveBeenCalled()
  })

  it('returns null when stlibSource port is missing', () => {
    const handle = bootStLsp(makePorts({ stlibSource: undefined }), monacoStub)
    expect(handle).toBeNull()
    expect(startStLsp).not.toHaveBeenCalled()
  })

  it('starts the service and attaches every sync layer when enabled', () => {
    const handle = bootStLsp(makePorts(), monacoStub)
    expect(handle).not.toBeNull()
    expect(startStLsp).toHaveBeenCalledTimes(1)
    expect(attachProjectSync).toHaveBeenCalledTimes(1)
    expect(attachLibrarySync).toHaveBeenCalledTimes(1)
    expect(attachEnabledLibrariesSync).toHaveBeenCalledTimes(1)
    expect(attachBundledLibrariesSync).toHaveBeenCalledTimes(1)
  })

  it('dispose() tears down every subscription and the service', () => {
    const handle = bootStLsp(makePorts(), monacoStub)
    expect(handle).not.toBeNull()
    handle!.dispose()
    expect(handle!.service.dispose).toHaveBeenCalledTimes(1)
    expect(attachProjectSync.mock.results[0].value.dispose).toHaveBeenCalledTimes(1)
    expect(attachLibrarySync.mock.results[0].value).toHaveBeenCalledTimes(1)
    expect(attachEnabledLibrariesSync.mock.results[0].value).toHaveBeenCalledTimes(1)
    expect(attachBundledLibrariesSync.mock.results[0].value).toHaveBeenCalledTimes(1)
  })

  it('passes an onAfterRefresh callback to every library subscription that calls forceResync', () => {
    bootStLsp(makePorts(), monacoStub)
    const projectSyncHandle = attachProjectSync.mock.results[0].value as {
      forceResync: jest.Mock
    }
    const librarySyncCallback = attachLibrarySync.mock.calls[0][1] as () => void
    const enabledSyncCallback = attachEnabledLibrariesSync.mock.calls[0][1] as () => void
    const bundledSyncCallback = attachBundledLibrariesSync.mock.calls[0][1] as () => void

    expect(typeof librarySyncCallback).toBe('function')
    expect(typeof enabledSyncCallback).toBe('function')
    expect(typeof bundledSyncCallback).toBe('function')

    librarySyncCallback()
    enabledSyncCallback()
    bundledSyncCallback()

    expect(projectSyncHandle.forceResync).toHaveBeenCalledTimes(3)
  })
})
