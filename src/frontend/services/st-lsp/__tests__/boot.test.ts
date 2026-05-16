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

jest.mock('../index', () => ({
  startStLsp: (...args: unknown[]) => startStLsp(...args),
}))
jest.mock('../project-sync', () => ({
  attachProjectSync: (...args: unknown[]) => attachProjectSync(...args),
  attachLibrarySync: (...args: unknown[]) => attachLibrarySync(...args),
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
    dispose: jest.fn(),
  })
  attachLibrarySync.mockReturnValue(jest.fn())
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

  it('starts the service and attaches both sync layers when enabled', () => {
    const handle = bootStLsp(makePorts(), monacoStub)
    expect(handle).not.toBeNull()
    expect(startStLsp).toHaveBeenCalledTimes(1)
    expect(attachProjectSync).toHaveBeenCalledTimes(1)
    expect(attachLibrarySync).toHaveBeenCalledTimes(1)
  })

  it('dispose() tears down project sync, library sync, and the service', () => {
    const handle = bootStLsp(makePorts(), monacoStub)
    expect(handle).not.toBeNull()
    handle!.dispose()
    expect(handle!.service.dispose).toHaveBeenCalledTimes(1)
    expect(attachProjectSync.mock.results[0].value.dispose).toHaveBeenCalledTimes(1)
    expect(attachLibrarySync.mock.results[0].value).toHaveBeenCalledTimes(1)
  })
})
