/**
 * @jest-environment jsdom
 */
import type { PLCPou } from '../../../../middleware/shared/ports/types'
import type { SystemLibrary } from '../../../store/slices/library/types'
import { openPLCStoreBase } from '../../../store'
import { attachEnabledLibrariesSync, attachProjectSync } from '../project-sync'
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

/** A POU whose only variable is bound to a producer alias by NAME — the
 *  single-field location model the LSP projection has to resolve. */
function makeAliasPou(name: string): PLCPou {
  return {
    name,
    pouType: 'program',
    interface: {
      variables: [
        {
          id: '1',
          name: 'label2',
          class: 'local',
          type: { definition: 'base-type', value: 'INT' },
          documentation: '',
          debug: false,
          location: 'label2',
        },
      ],
    },
    body: { language: 'st', value: 'x := 1;' },
    documentation: '',
  } as PLCPou
}

/** Seed a Runtime v4 target plus one Modbus holding-register point carrying
 *  `alias`, so the store's alias index resolves it to `%IW0`. */
function seedAliasProducer(alias: string) {
  const { deviceActions, projectActions } = openPLCStoreBase.getState()
  deviceActions.setAvailableOptions({
    availableBoards: new Map([
      [
        'OpenPLC Runtime v4',
        {
          compiler: 'openplc-compiler',
          core: 'rt-v4',
          preview: '',
          specs: {},
          capabilities: {
            pinMapping: false,
            vppIo: false,
            modbusTcpRemote: true,
            ethercat: true,
            modbusTcpServer: true,
            opcuaServer: true,
            s7Server: true,
            debuggerTransports: ['websocket'],
            pythonFunctionBlocks: true,
            arduinoApiCompletions: false,
            hasRuntimeStats: true,
            isInProcessSimulator: false,
            directUsbUpload: false,
          },
        },
      ],
    ]) as never,
  })
  deviceActions.setDeviceBoard('OpenPLC Runtime v4')

  const current = openPLCStoreBase.getState().project
  projectActions.setProject({
    ...current,
    data: {
      ...current.data,
      remoteDevices: [
        {
          name: 'Dev1',
          protocol: 'modbus-tcp',
          modbusTcpConfig: { host: '127.0.0.1', port: 502, slaveId: 1, timeout: 1000, ioGroups: [] },
        },
      ],
    },
  })
  projectActions.addIOGroup('Dev1', {
    id: 'g1',
    name: 'group-g1',
    functionCode: '3',
    cycleTime: 100,
    offset: '0',
    length: 1,
    errorHandling: 'keep-last-value',
    ioPoints: [],
  })
  const pointId =
    openPLCStoreBase.getState().project.data.remoteDevices![0].modbusTcpConfig!.ioGroups[0].ioPoints![0].id
  projectActions.updateIOPointAlias('Dev1', 'g1', pointId, alias)
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
    expect(calls).toEqual(expect.arrayContaining(['inmemory://pou/Main.st', 'inmemory://stub/TankFB.st']))
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

  it("regenerates stub text when a graphical POU's variable interface changes", () => {
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

  it('forceResync() re-publishes every tracked document with bumped versions', () => {
    setProjectPous([makeStPou('A'), makeStPou('B')])
    const service = makeStubService()
    const handle = attachProjectSync(service)
    service.openDocument.mockClear()
    service.changeDocument.mockClear()

    handle.forceResync()

    expect(service.changeDocument).toHaveBeenCalledTimes(2)
    const uris = service.changeDocument.mock.calls.map((c) => c[0]).sort()
    expect(uris).toEqual(['inmemory://pou/A.st', 'inmemory://pou/B.st'])
    const versions = service.changeDocument.mock.calls.map((c) => c[2])
    expect(new Set(versions).size).toBe(versions.length)
    handle.dispose()
  })

  // `AT <alias>` is not valid IEC ST — strucpp abandons the whole VAR block on
  // it, so every symbol after the first alias-bound variable falls out of the
  // POU's scope (no autocomplete, red boxes in the LD/FBD editors).
  it('never publishes a bare alias name as a location', () => {
    setProjectPous([makeAliasPou('Main')])
    const service = makeStubService()
    const handle = attachProjectSync(service)

    const text = service.openDocument.mock.calls.find((c) => c[0] === 'inmemory://pou/Main.st')?.[1] as string
    expect(text).not.toContain('AT label2')
    expect(text).toContain('label2 : INT;')
    // The store still holds the alias-name form — only the LSP projection is
    // resolved.
    expect(openPLCStoreBase.getState().project.data.pous[0].interface?.variables?.[0].location).toBe('label2')
    handle.dispose()
  })

  it('publishes the address an alias currently resolves to', () => {
    seedAliasProducer('label2')
    setProjectPous([makeAliasPou('Main')])
    const service = makeStubService()
    const handle = attachProjectSync(service)

    const text = service.openDocument.mock.calls.find((c) => c[0] === 'inmemory://pou/Main.st')?.[1] as string
    expect(text).toContain('label2 : INT AT %IW0;')
    handle.dispose()
  })

  it('re-publishes when producer state changes without a POU edit', () => {
    seedAliasProducer('label2')
    setProjectPous([makeAliasPou('Main')])
    const service = makeStubService()
    const handle = attachProjectSync(service)
    service.changeDocument.mockClear()

    // Dropping the producer touches only `remoteDevices` — the POU array is
    // untouched, so only the alias-index subscription can catch it. Without
    // it the stub would keep advertising the now-dead `%IW0`.
    openPLCStoreBase.setState((s) => ({
      ...s,
      project: { ...s.project, data: { ...s.project.data, remoteDevices: [] } },
    }))

    expect(service.changeDocument).toHaveBeenCalledTimes(1)
    const [uri, text] = service.changeDocument.mock.calls[0] as [string, string]
    expect(uri).toBe('inmemory://pou/Main.st')
    expect(text).toContain('label2 : INT;')
    expect(text).not.toContain('%IW0')
    handle.dispose()
  })
})

function makeSystemLibrary(name: string, version: string = '1.0.0'): SystemLibrary {
  return {
    name,
    author: 'test',
    version,
    stPath: `/libs/${name}.st`,
    cPath: `/libs/${name}.c`,
    pous: [],
  } as SystemLibrary
}

describe('attachEnabledLibrariesSync', () => {
  beforeEach(() => {
    // Reset the library slice to a known state between tests.  The
    // store is shared across the file, so left-over enabled libraries
    // would otherwise leak from earlier tests.
    const a = openPLCStoreBase.getState().libraryActions
    a.setProjectLibraries([])
    a.setSystemLibraries([])
  })

  it('fires refreshStlibs when a library is enabled for the project', () => {
    const service = makeStubService()
    const unsubscribe = attachEnabledLibrariesSync(service)
    const a = openPLCStoreBase.getState().libraryActions
    a.setSystemLibraries([makeSystemLibrary('Semaphore_Package')])
    ;(service.refreshStlibs as jest.Mock).mockClear()

    a.enableLibrary('Semaphore_Package')

    expect(service.refreshStlibs).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('fires refreshStlibs when a library is disabled for the project', () => {
    const service = makeStubService()
    const a = openPLCStoreBase.getState().libraryActions
    a.setSystemLibraries([makeSystemLibrary('Semaphore_Package')])
    a.enableLibrary('Semaphore_Package')

    const unsubscribe = attachEnabledLibrariesSync(service)
    ;(service.refreshStlibs as jest.Mock).mockClear()

    a.disableLibrary('Semaphore_Package')

    expect(service.refreshStlibs).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('does not fire when only libraries.user changes (handled by attachLibrarySync)', () => {
    const service = makeStubService()
    const unsubscribe = attachEnabledLibrariesSync(service)
    ;(service.refreshStlibs as jest.Mock).mockClear()

    openPLCStoreBase.getState().libraryActions.addLibrary('UserFB', 'function-block')

    expect(service.refreshStlibs).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('is order-independent — a reorder of the same set does not refresh', () => {
    const service = makeStubService()
    const a = openPLCStoreBase.getState().libraryActions
    a.setSystemLibraries([makeSystemLibrary('A'), makeSystemLibrary('B')])

    const unsubscribe = attachEnabledLibrariesSync(service)
    a.setProjectLibraries([
      { name: 'A', version: '1.0.0' },
      { name: 'B', version: '1.0.0' },
    ])
    ;(service.refreshStlibs as jest.Mock).mockClear()

    a.setProjectLibraries([
      { name: 'B', version: '1.0.0' },
      { name: 'A', version: '1.0.0' },
    ])

    expect(service.refreshStlibs).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('unsubscribe stops the subscription firing', () => {
    const service = makeStubService()
    const a = openPLCStoreBase.getState().libraryActions
    a.setSystemLibraries([makeSystemLibrary('Semaphore_Package')])

    const unsubscribe = attachEnabledLibrariesSync(service)
    unsubscribe()
    ;(service.refreshStlibs as jest.Mock).mockClear()

    a.enableLibrary('Semaphore_Package')

    expect(service.refreshStlibs).not.toHaveBeenCalled()
  })

  it('calls onAfterRefresh once refreshStlibs resolves (forces document re-analyze)', async () => {
    const service = makeStubService()
    const onAfterRefresh = jest.fn()
    const unsubscribe = attachEnabledLibrariesSync(service, onAfterRefresh)
    const a = openPLCStoreBase.getState().libraryActions
    a.setSystemLibraries([makeSystemLibrary('Semaphore_Package')])
    ;(service.refreshStlibs as jest.Mock).mockClear()
    onAfterRefresh.mockClear()

    a.enableLibrary('Semaphore_Package')
    // Drain the `.then(...)` continuation that runs after the
    // refreshStlibs() promise resolves.
    await Promise.resolve()
    await Promise.resolve()

    expect(service.refreshStlibs).toHaveBeenCalledTimes(1)
    expect(onAfterRefresh).toHaveBeenCalledTimes(1)
    unsubscribe()
  })
})
