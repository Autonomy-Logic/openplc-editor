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

const POU_URI = 'file:///MyPou.py'

beforeEach(() => {
  jest.clearAllMocks()
})

describe('startPythonLsp configuration', () => {
  it('passes Python-specific config to startLanguageService', () => {
    const mockService = makeMockLanguageService()
    startLanguageService.mockReturnValue(mockService)

    startPythonLsp({ workerUrlOverride: 'about:blank' })

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
    const mockService = makeMockLanguageService()
    startLanguageService.mockReturnValue(mockService)

    const service = startPythonLsp({ workerUrlOverride: 'about:blank' })
    await expect(service.ready).resolves.toBeUndefined()
  })

  it('forwards onCrash to the shared layer', () => {
    const mockService = makeMockLanguageService()
    startLanguageService.mockReturnValue(mockService)
    const onCrash = jest.fn()

    startPythonLsp({ workerUrlOverride: 'about:blank', onCrash })

    const opts = startLanguageService.mock.calls[0][0]
    expect(opts.onCrash).toBe(onCrash)
  })

  it('omits the monaco option when no Monaco namespace is provided', () => {
    const mockService = makeMockLanguageService()
    startLanguageService.mockReturnValue(mockService)

    startPythonLsp({ workerUrlOverride: 'about:blank' })

    const opts = startLanguageService.mock.calls[0][0]
    expect('monaco' in opts).toBe(false)
  })
})

describe('attachPou', () => {
  it('records the body-line offset before opening the document', () => {
    const mockService = makeMockLanguageService()
    startLanguageService.mockReturnValue(mockService)

    const service = startPythonLsp({ workerUrlOverride: 'about:blank' })
    const vars = [makeBoolVar('red_light', 'input'), makeIntVar('counter', 'output')]
    service.attachPou(POU_URI, vars, 'red_light = True\n')

    expect(setBodyLineOffset).toHaveBeenCalledTimes(1)
    expect(setBodyLineOffset).toHaveBeenCalledWith(POU_URI, expect.any(Number))
    const recordedOffset = setBodyLineOffset.mock.calls[0][1]
    expect(recordedOffset).toBeGreaterThan(0)
  })

  it('opens the document with preamble + body concatenated', () => {
    const mockService = makeMockLanguageService()
    startLanguageService.mockReturnValue(mockService)

    const service = startPythonLsp({ workerUrlOverride: 'about:blank' })
    const vars = [makeBoolVar('red_light', 'input')]
    service.attachPou(POU_URI, vars, 'red_light = True\n')

    expect(mockService.openDocument).toHaveBeenCalledTimes(1)
    const [openedUri, openedText] = mockService.openDocument.mock.calls[0]
    expect(openedUri).toBe(POU_URI)
    // The opened text should END with the user body and contain
    // the preamble declaration of `red_light`.
    expect(openedText.endsWith('red_light = True\n')).toBe(true)
    expect(openedText).toContain('red_light')
    expect(openedText.startsWith('red_light = True')).toBe(false)
  })

  it('records a zero offset when no IEC variables map to Python globals', () => {
    const mockService = makeMockLanguageService()
    startLanguageService.mockReturnValue(mockService)

    const service = startPythonLsp({ workerUrlOverride: 'about:blank' })
    // `local` vars don't get hoisted into module scope; preamble is empty.
    service.attachPou(POU_URI, [makeBoolVar('x', 'local')], 'pass\n')

    expect(setBodyLineOffset).toHaveBeenCalledWith(POU_URI, 0)
  })
})

describe('notifyBodyChange', () => {
  it('forwards an augmented document with the previously-installed preamble', () => {
    const mockService = makeMockLanguageService()
    startLanguageService.mockReturnValue(mockService)

    const service = startPythonLsp({ workerUrlOverride: 'about:blank' })
    const vars = [makeBoolVar('red_light', 'input')]
    service.attachPou(POU_URI, vars, 'red_light = True\n')
    service.notifyBodyChange(POU_URI, 'red_light = False\n')

    expect(mockService.changeDocument).toHaveBeenCalledTimes(1)
    const [, changedText, version] = mockService.changeDocument.mock.calls[0]
    expect(changedText.endsWith('red_light = False\n')).toBe(true)
    expect(changedText).toContain('red_light')
    expect(typeof version).toBe('number')
    expect(version).toBeGreaterThanOrEqual(1)
  })

  it('bumps the version monotonically across successive calls', () => {
    const mockService = makeMockLanguageService()
    startLanguageService.mockReturnValue(mockService)

    const service = startPythonLsp({ workerUrlOverride: 'about:blank' })
    service.attachPou(POU_URI, [], 'x = 1\n')
    service.notifyBodyChange(POU_URI, 'x = 2\n')
    service.notifyBodyChange(POU_URI, 'x = 3\n')

    const versions = mockService.changeDocument.mock.calls.map(([, , v]) => v)
    expect(versions).toEqual([1, 2])
  })

  it('uses an empty preamble for URIs that were never attached', () => {
    const mockService = makeMockLanguageService()
    startLanguageService.mockReturnValue(mockService)

    const service = startPythonLsp({ workerUrlOverride: 'about:blank' })
    service.notifyBodyChange(POU_URI, 'x = 1\n')

    const [, changedText] = mockService.changeDocument.mock.calls[0]
    expect(changedText).toBe('x = 1\n')
  })
})

describe('notifyVariablesChange', () => {
  it('regenerates the preamble and re-records the offset', () => {
    const mockService = makeMockLanguageService()
    startLanguageService.mockReturnValue(mockService)

    const service = startPythonLsp({ workerUrlOverride: 'about:blank' })
    service.attachPou(POU_URI, [makeBoolVar('a', 'input')], 'a = True\n')
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
    const mockService = makeMockLanguageService()
    startLanguageService.mockReturnValue(mockService)

    const service = startPythonLsp({ workerUrlOverride: 'about:blank' })
    service.attachPou(POU_URI, [makeBoolVar('x', 'input')], 'x = True\n')
    service.detachPou(POU_URI)

    expect(mockService.closeDocument).toHaveBeenCalledWith(POU_URI)
    expect(deleteBodyLineOffset).toHaveBeenCalledWith(POU_URI)
  })

  it('does not throw when called on a never-attached URI', () => {
    const mockService = makeMockLanguageService()
    startLanguageService.mockReturnValue(mockService)

    const service = startPythonLsp({ workerUrlOverride: 'about:blank' })
    expect(() => service.detachPou(POU_URI)).not.toThrow()
  })
})

describe('dispose', () => {
  it('disposes the underlying shared service', () => {
    const mockService = makeMockLanguageService()
    startLanguageService.mockReturnValue(mockService)

    const service = startPythonLsp({ workerUrlOverride: 'about:blank' })
    service.dispose()

    expect(mockService.dispose).toHaveBeenCalledTimes(1)
  })
})
