/**
 * @jest-environment jsdom
 */
import type { PLCPou } from '../../../../middleware/shared/ports/types'
import { openPLCStoreBase } from '../../../store'
import { attachProjectSync } from '../project-sync'
import type { StLspService } from '../types'

function makeStPou(name: string, body: string = 'x := 1;'): PLCPou {
  return {
    name,
    pouType: 'program',
    interface: { variables: [] },
    body: { language: 'st', value: body },
    documentation: '',
  } as PLCPou
}

function makeFbdPou(name: string): PLCPou {
  return {
    name,
    pouType: 'function-block',
    interface: { variables: [] },
    body: { language: 'fbd', value: {} as never },
    documentation: '',
  } as PLCPou
}

function makeStubService() {
  return {
    ready: Promise.resolve(),
    refreshStlibs: jest.fn().mockResolvedValue(undefined),
    openDocument: jest.fn(),
    changeDocument: jest.fn(),
    closeDocument: jest.fn(),
    dispose: jest.fn(),
  } as unknown as StLspService & {
    openDocument: jest.Mock
    changeDocument: jest.Mock
    closeDocument: jest.Mock
  }
}

function setProjectPous(pous: PLCPou[]) {
  openPLCStoreBase.setState((s) => ({
    ...s,
    project: {
      ...s.project,
      data: {
        ...s.project.data,
        pous,
      },
    },
  }))
}

beforeEach(() => {
  // Clear any leftover POUs from prior tests.
  setProjectPous([])
})

describe('attachProjectSync', () => {
  it('opens every POU that exists when sync is attached', () => {
    setProjectPous([makeStPou('Main'), makeFbdPou('TankFB')])
    const service = makeStubService()
    const handle = attachProjectSync(service)

    expect(service.openDocument).toHaveBeenCalledTimes(2)
    const calls = service.openDocument.mock.calls.map((c) => c[0])
    expect(calls).toEqual(
      expect.arrayContaining(['inmemory://pou/Main.st', 'inmemory://stub/TankFB.st']),
    )
    handle.dispose()
  })

  it('sends didOpen on POU creation', () => {
    const service = makeStubService()
    const handle = attachProjectSync(service)
    expect(service.openDocument).not.toHaveBeenCalled()

    setProjectPous([makeStPou('NewProg')])
    expect(service.openDocument).toHaveBeenCalledWith(
      'inmemory://pou/NewProg.st',
      expect.stringContaining('PROGRAM NewProg'),
    )
    handle.dispose()
  })

  it('sends didChange when an ST body changes', () => {
    setProjectPous([makeStPou('P', 'x := 1;')])
    const service = makeStubService()
    const handle = attachProjectSync(service)
    service.changeDocument.mockClear()

    setProjectPous([makeStPou('P', 'x := 99;')])
    expect(service.changeDocument).toHaveBeenCalledTimes(1)
    const [uri, text] = service.changeDocument.mock.calls[0]
    expect(uri).toBe('inmemory://pou/P.st')
    expect(text).toContain('x := 99;')
    handle.dispose()
  })

  it('does not re-send didChange when text is unchanged', () => {
    setProjectPous([makeStPou('Idle')])
    const service = makeStubService()
    const handle = attachProjectSync(service)
    service.openDocument.mockClear()
    service.changeDocument.mockClear()

    // Force a project update with the same content — sync must
    // notice the text is identical and skip the change message.
    setProjectPous([makeStPou('Idle')])
    expect(service.changeDocument).not.toHaveBeenCalled()
    expect(service.openDocument).not.toHaveBeenCalled()
    handle.dispose()
  })

  it('sends didClose when a POU is deleted', () => {
    setProjectPous([makeStPou('Doomed')])
    const service = makeStubService()
    const handle = attachProjectSync(service)
    service.closeDocument.mockClear()

    setProjectPous([])
    expect(service.closeDocument).toHaveBeenCalledWith('inmemory://pou/Doomed.st')
    handle.dispose()
  })

  it('emits close-then-reopen when body language flips', () => {
    setProjectPous([makeStPou('Foo')])
    const service = makeStubService()
    const handle = attachProjectSync(service)
    service.openDocument.mockClear()
    service.closeDocument.mockClear()

    // Same name, body language now FBD — URI scheme flips from pou://
    // to stub:// so the worker must see the old URI close + new URI open.
    setProjectPous([makeFbdPou('Foo')])
    expect(service.closeDocument).toHaveBeenCalledWith('inmemory://pou/Foo.st')
    expect(service.openDocument).toHaveBeenCalledWith(
      'inmemory://stub/Foo.st',
      expect.stringContaining('FUNCTION_BLOCK Foo'),
    )
    handle.dispose()
  })

  it('regenerates stub text when a graphical POU\'s variable interface changes', () => {
    const initial = makeFbdPou('Tank')
    setProjectPous([initial])
    const service = makeStubService()
    const handle = attachProjectSync(service)
    service.changeDocument.mockClear()

    const updated: PLCPou = {
      ...initial,
      interface: {
        variables: [
          {
            id: '1',
            name: 'sp',
            class: 'input',
            type: { definition: 'base-type', value: 'INT' },
            documentation: '',
            debug: false,
            location: '',
          },
        ],
      },
    } as PLCPou
    setProjectPous([updated])

    expect(service.changeDocument).toHaveBeenCalledTimes(1)
    const [, text] = service.changeDocument.mock.calls[0]
    expect(text).toContain('VAR_INPUT')
    expect(text).toContain('sp : INT;')
    handle.dispose()
  })

  it('dispose() closes every open document', () => {
    setProjectPous([makeStPou('A'), makeStPou('B')])
    const service = makeStubService()
    const handle = attachProjectSync(service)
    service.closeDocument.mockClear()

    handle.dispose()
    expect(service.closeDocument).toHaveBeenCalledTimes(2)
    const uris = service.closeDocument.mock.calls.map((c) => c[0]).sort()
    expect(uris).toEqual(['inmemory://pou/A.st', 'inmemory://pou/B.st'])
  })

  it('resync() reissues the current state without prior diffs', () => {
    setProjectPous([makeStPou('Static')])
    const service = makeStubService()
    const handle = attachProjectSync(service)
    service.openDocument.mockClear()
    service.changeDocument.mockClear()

    // resync against an unchanged store doesn't re-open — nothing
    // changed in the diff layer.
    handle.resync()
    expect(service.openDocument).not.toHaveBeenCalled()
    expect(service.changeDocument).not.toHaveBeenCalled()
    handle.dispose()
  })
})
