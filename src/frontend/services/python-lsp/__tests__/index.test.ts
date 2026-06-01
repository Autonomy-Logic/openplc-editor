/**
 * @jest-environment jsdom
 */
import type { PLCVariable } from '../../../../middleware/shared/ports/types'

// Mock the shared orchestrator BEFORE importing the service so the
// service module pulls in the mock.  The mock returns a stub
// LanguageService whose openDocument / changeDocument / closeDocument
// calls we can assert on.
const startLanguageService = jest.fn()
const setBodyLineOffset = jest.fn()
const deleteBodyLineOffset = jest.fn()

jest.mock('../../lsp-shared', () => {
  // Re-export everything else by re-requiring the real module under a
  // different specifier — keeps imports of types / converters live for
  // anything we haven't mocked.  But for the names we DO mock, route
  // through the jest.fn so each test can introspect call args.
  return {
    startLanguageService: (opts: unknown) => startLanguageService(opts),
    setBodyLineOffset: (...args: unknown[]) => setBodyLineOffset(...args),
    deleteBodyLineOffset: (...args: unknown[]) => deleteBodyLineOffset(...args),
  }
})

import { startPythonLsp } from '../index'

interface MockLanguageService {
  ready: Promise<void>
  openDocument: jest.Mock
  changeDocument: jest.Mock
  closeDocument: jest.Mock
  dispose: jest.Mock
}

function makeMockLanguageService(): MockLanguageService {
  return {
    ready: Promise.resolve(),
    openDocument: jest.fn(),
    changeDocument: jest.fn(),
    closeDocument: jest.fn(),
    dispose: jest.fn(),
  }
}

/**
 * Wire the shared-service mock so `beforeListen` fires with a stub
 * MessageConnection.  python-lsp captures that connection to send
 * `pyright/createFile` / `pyright/deleteFile` from attachPou /
 * detachPou — without invoking `beforeListen`, those notifications
 * never have a connection to ride on and the tests assert against
 * a never-called jest.fn.
 */
function installMockSharedService(): { service: MockLanguageService; sendNotification: jest.Mock } {
  const service = makeMockLanguageService()
  const sendNotification = jest.fn()
  startLanguageService.mockImplementation((opts: { beforeListen?: (connection: unknown) => void }) => {
    opts.beforeListen?.({ sendNotification })
    return service
  })
  return { service, sendNotification }
}

function makeBoolVar(name: string, varClass: 'input' | 'output' | 'local' = 'input'): PLCVariable {
  return {
    id: name,
    name,
    class: varClass,
    type: { definition: 'base-type', value: 'BOOL' },
    location: '',
    documentation: '',
    debug: false,
  } as PLCVariable
}

function makeIntVar(name: string, varClass: 'input' | 'output' = 'output'): PLCVariable {
  return {
    id: name,
    name,
    class: varClass,
    type: { definition: 'base-type', value: 'INT' },
    location: '',
    documentation: '',
    debug: false,
  } as PLCVariable
}

const POU_URI = 'file:///MyPou'
const POU_LSP_URI = `${POU_URI}.py`
const POU_NAME = 'MyPou'

beforeEach(() => {
  jest.clearAllMocks()
})

describe('startPythonLsp configuration', () => {
  it('passes Python-specific config to startLanguageService', () => {
    installMockSharedService()

    startPythonLsp({ workerUrl: 'about:blank' })

    expect(startLanguageService).toHaveBeenCalledTimes(1)
    const opts = startLanguageService.mock.calls[0][0]
    expect(opts.languageId).toBe('python')
    expect(opts.workerName).toBe('python-lsp')
    expect(opts.markerOwner).toBe('python-lsp')
    expect(opts.diagnosticSource).toBe('pyright')
    expect(opts.completionTriggerCharacters).toEqual(['.', '[', '"', "'"])
    expect(opts.signatureHelpTriggerCharacters).toEqual(['(', ','])
    expect(opts.workerUrl).toBe('about:blank')
  })

  it('exposes the shared service ready promise', async () => {
    installMockSharedService()

    const service = startPythonLsp({ workerUrl: 'about:blank' })
    await expect(service.ready).resolves.toBeUndefined()
  })

  it('forwards onCrash to the shared layer', () => {
    installMockSharedService()
    const onCrash = jest.fn()

    startPythonLsp({ workerUrl: 'about:blank', onCrash })

    const opts = startLanguageService.mock.calls[0][0]
    expect(opts.onCrash).toBe(onCrash)
  })

  it('omits the monaco option when no Monaco namespace is provided', () => {
    installMockSharedService()

    startPythonLsp({ workerUrl: 'about:blank' })

    const opts = startLanguageService.mock.calls[0][0]
    expect('monaco' in opts).toBe(false)
  })
})

describe('attachPou', () => {
  it('records the body-line offset before opening the document', () => {
    installMockSharedService()

    const service = startPythonLsp({ workerUrl: 'about:blank' })
    const vars = [makeBoolVar('red_light', 'input'), makeIntVar('counter', 'output')]
    service.attachPou(POU_URI, POU_NAME, vars, 'red_light = True\n')

    // Body-line offset is keyed by the LSP URI (model URI + `.py`)
    // — that's the URI basedpyright reports back on every
    // `publishDiagnostics` and the URI the shared converters look
    // up offsets by when translating pyright responses.
    expect(setBodyLineOffset).toHaveBeenCalledTimes(1)
    expect(setBodyLineOffset).toHaveBeenCalledWith(POU_LSP_URI, expect.any(Number))
    const recordedOffset = setBodyLineOffset.mock.calls[0][1]
    expect(recordedOffset).toBeGreaterThan(0)
  })

  it('opens the document at the .py-suffixed LSP URI with preamble + body', () => {
    const { service: mockService } = installMockSharedService()

    const service = startPythonLsp({ workerUrl: 'about:blank' })
    const vars = [makeBoolVar('red_light', 'input')]
    service.attachPou(POU_URI, POU_NAME, vars, 'red_light = True\n')

    expect(mockService.openDocument).toHaveBeenCalledTimes(1)
    const [openedUri, openedText] = mockService.openDocument.mock.calls[0]
    // The URI handed to basedpyright is the model URI + `.py`.
    // Without the extension, basedpyright treats the document as
    // a non-Python source and never publishes diagnostics — only
    // hover / completion / semantic-tokens still work via
    // on-demand queries.
    expect(openedUri).toBe(POU_LSP_URI)
    // The opened text ends with the user body and contains the
    // preamble declaration of `red_light`.
    expect(openedText.endsWith('red_light = True\n')).toBe(true)
    expect(openedText).toContain('red_light')
    expect(openedText.startsWith('red_light = True')).toBe(false)
  })

  it('records a zero offset when no IEC variables map to Python globals', () => {
    installMockSharedService()

    const service = startPythonLsp({ workerUrl: 'about:blank' })
    // `local` vars don't get hoisted into module scope; preamble is empty.
    service.attachPou(POU_URI, POU_NAME, [makeBoolVar('x', 'local')], 'pass\n')

    expect(setBodyLineOffset).toHaveBeenCalledWith(POU_LSP_URI, 0)
  })

  it('sends pyright/createFile before opening the document', () => {
    const { service: mockService, sendNotification } = installMockSharedService()

    const service = startPythonLsp({ workerUrl: 'about:blank' })
    service.attachPou(POU_URI, POU_NAME, [makeBoolVar('x', 'input')], 'x = True\n')

    // basedpyright only treats files that exist in its in-memory
    // TestFileSystem as workspace members, and only workspace
    // members get `publishDiagnostics`.  The `pyright/createFile`
    // notification adds the LSP URI to the FS; without it,
    // `didOpen` populates the document buffer but the file never
    // enters the analysis queue.  It must arrive before `didOpen`.
    expect(sendNotification).toHaveBeenCalledWith('pyright/createFile', { kind: 'create', uri: POU_LSP_URI })
    const createCallIndex = sendNotification.mock.invocationCallOrder[0]
    const openCallIndex = mockService.openDocument.mock.invocationCallOrder[0]
    expect(createCallIndex).toBeLessThan(openCallIndex)
  })
})

describe('notifyBodyChange', () => {
  it('forwards an augmented document with the previously-installed preamble', () => {
    const { service: mockService } = installMockSharedService()

    const service = startPythonLsp({ workerUrl: 'about:blank' })
    const vars = [makeBoolVar('red_light', 'input')]
    service.attachPou(POU_URI, POU_NAME, vars, 'red_light = True\n')
    service.notifyBodyChange(POU_URI, 'red_light = False\n')

    expect(mockService.changeDocument).toHaveBeenCalledTimes(1)
    const [, changedText, version] = mockService.changeDocument.mock.calls[0]
    expect(changedText.endsWith('red_light = False\n')).toBe(true)
    expect(changedText).toContain('red_light')
    // Version is owned by the shared service — python-lsp doesn't
    // supply one, so the shared service advances its own internal
    // counter starting from the version `openDocument` used.
    expect(version).toBeUndefined()
  })

  it('leaves version assignment to the shared service across successive calls', () => {
    const { service: mockService } = installMockSharedService()

    const service = startPythonLsp({ workerUrl: 'about:blank' })
    service.attachPou(POU_URI, POU_NAME, [], 'x = 1\n')
    service.notifyBodyChange(POU_URI, 'x = 2\n')
    service.notifyBodyChange(POU_URI, 'x = 3\n')

    // python-lsp never passes a version to the shared service —
    // doing so would risk overlapping the version `openDocument`
    // used (LSP requires strictly-increasing versions; a
    // collision makes Pyright silently drop the change).  The
    // shared service's internal counter handles it.
    const versions = mockService.changeDocument.mock.calls.map(([, , v]) => v)
    expect(versions).toEqual([undefined, undefined])
  })

  it('uses an empty preamble for URIs that were never attached', () => {
    const { service: mockService } = installMockSharedService()

    const service = startPythonLsp({ workerUrl: 'about:blank' })
    service.notifyBodyChange(POU_URI, 'x = 1\n')

    const [, changedText] = mockService.changeDocument.mock.calls[0]
    expect(changedText).toBe('x = 1\n')
  })
})

describe('notifyVariablesChange', () => {
  it('regenerates the preamble and re-records the offset', () => {
    const { service: mockService } = installMockSharedService()

    const service = startPythonLsp({ workerUrl: 'about:blank' })
    service.attachPou(POU_URI, POU_NAME, [makeBoolVar('a', 'input')], 'a = True\n')
    const firstOffset = setBodyLineOffset.mock.calls[0][1]

    service.notifyVariablesChange(POU_URI, [makeBoolVar('a', 'input'), makeIntVar('b', 'output')], 'a = True\nb = 1\n')

    expect(setBodyLineOffset).toHaveBeenCalledTimes(2)
    const secondOffset = setBodyLineOffset.mock.calls[1][1]
    expect(secondOffset).toBeGreaterThan(firstOffset)
    // The latest changeDocument must contain both variables.
    const lastChange = mockService.changeDocument.mock.calls.at(-1)
    expect(lastChange?.[1]).toContain('a')
    expect(lastChange?.[1]).toContain('b')
  })
})

describe('detachPou', () => {
  it('closes the document and clears registry entries', () => {
    const { service: mockService } = installMockSharedService()

    const service = startPythonLsp({ workerUrl: 'about:blank' })
    service.attachPou(POU_URI, POU_NAME, [makeBoolVar('x', 'input')], 'x = True\n')
    service.detachPou(POU_URI)

    expect(mockService.closeDocument).toHaveBeenCalledWith(POU_LSP_URI)
    expect(deleteBodyLineOffset).toHaveBeenCalledWith(POU_LSP_URI)
  })

  it('sends pyright/deleteFile after closing the document', () => {
    const { service: mockService, sendNotification } = installMockSharedService()

    const service = startPythonLsp({ workerUrl: 'about:blank' })
    service.attachPou(POU_URI, POU_NAME, [makeBoolVar('x', 'input')], 'x = True\n')
    sendNotification.mockClear()
    service.detachPou(POU_URI)

    // Mirror of `pyright/createFile` — remove the FS entry once the
    // document is closed so workspace membership returns to zero
    // when no Python POU is open.  Order matches the createFile
    // path: didClose precedes deleteFile.
    expect(sendNotification).toHaveBeenCalledWith('pyright/deleteFile', { kind: 'delete', uri: POU_LSP_URI })
    const closeCallIndex = mockService.closeDocument.mock.invocationCallOrder.at(-1) ?? 0
    const deleteCallIndex = sendNotification.mock.invocationCallOrder[0]
    expect(deleteCallIndex).toBeGreaterThan(closeCallIndex)
  })

  it('does not throw when called on a never-attached URI', () => {
    installMockSharedService()

    const service = startPythonLsp({ workerUrl: 'about:blank' })
    expect(() => service.detachPou(POU_URI)).not.toThrow()
  })
})

describe('dispose', () => {
  it('disposes the underlying shared service', () => {
    const { service: mockService } = installMockSharedService()

    const service = startPythonLsp({ workerUrl: 'about:blank' })
    service.dispose()

    expect(mockService.dispose).toHaveBeenCalledTimes(1)
  })
})
