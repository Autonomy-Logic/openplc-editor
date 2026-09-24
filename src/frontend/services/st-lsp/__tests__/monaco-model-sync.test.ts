/**
 * @jest-environment jsdom
 */
import type { PLCPou } from '../../../../middleware/shared/ports/types'
import { openPLCStoreBase } from '../../../store'
import { attachMonacoModelSync } from '../monaco-model-sync'

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

interface FakeModel {
  uri: string
  value: string
  language: string
  disposed: boolean
}

function makeMonacoStub() {
  const models = new Map<string, FakeModel>()
  const wrappers = new Map<string, { getValue: () => string; setValue: (v: string) => void; dispose: () => void }>()

  function wrap(m: FakeModel) {
    const w = {
      getValue: () => m.value,
      setValue: (v: string) => {
        m.value = v
      },
      dispose: () => {
        m.disposed = true
        models.delete(m.uri)
        wrappers.delete(m.uri)
      },
    }
    wrappers.set(m.uri, w)
    return w
  }

  return {
    Uri: {
      parse: (uri: string) =>
        ({
          toString: () => uri,
        }) as unknown as ReturnType<typeof import('monaco-editor').Uri.parse>,
    },
    editor: {
      getModel: (uri: { toString: () => string }) =>
        (wrappers.get(uri.toString()) ?? null) as unknown as ReturnType<typeof import('monaco-editor').editor.getModel>,
      createModel: (value: string, language: string, uri: { toString: () => string }) => {
        const m: FakeModel = {
          uri: uri.toString(),
          value,
          language,
          disposed: false,
        }
        models.set(uri.toString(), m)
        return wrap(m) as unknown as ReturnType<typeof import('monaco-editor').editor.createModel>
      },
    },
    __models: models,
  }
}

beforeEach(() => {
  setProjectPous([])
})

describe('attachMonacoModelSync', () => {
  it('creates a model at the pou:// URI for every ST POU on attach', () => {
    setProjectPous([makeStPou('Main', 'a := 1;'), makeStPou('Other', 'b := 2;')])
    const stub = makeMonacoStub()

    const handle = attachMonacoModelSync(stub as unknown as typeof import('monaco-editor'))

    expect(stub.__models.has('inmemory://pou/Main.st')).toBe(true)
    expect(stub.__models.get('inmemory://pou/Main.st')!.value).toBe('a := 1;')
    expect(stub.__models.get('inmemory://pou/Other.st')!.value).toBe('b := 2;')
    handle.dispose()
  })

  it('creates a stub:// model with the opaque placeholder for non-ST POUs', () => {
    setProjectPous([makeFbdPou('TankFB')])
    const stub = makeMonacoStub()
    const handle = attachMonacoModelSync(stub as unknown as typeof import('monaco-editor'))

    const tank = stub.__models.get('inmemory://stub/TankFB.st')
    expect(tank).toBeDefined()
    expect(tank!.value).toContain('graphical body')
    handle.dispose()
  })

  it('updates an existing model when the POU body changes', () => {
    setProjectPous([makeStPou('P', 'a := 1;')])
    const stub = makeMonacoStub()
    const handle = attachMonacoModelSync(stub as unknown as typeof import('monaco-editor'))

    expect(stub.__models.get('inmemory://pou/P.st')!.value).toBe('a := 1;')

    setProjectPous([makeStPou('P', 'a := 99;')])

    expect(stub.__models.get('inmemory://pou/P.st')!.value).toBe('a := 99;')
    handle.dispose()
  })

  it('disposes the model when its POU is removed', () => {
    // Genuine single-POU removal: another POU survives, so the list is
    // non-empty and the disappeared-POU sweep runs.
    setProjectPous([makeStPou('Doomed'), makeStPou('Keeper')])
    const stub = makeMonacoStub()
    const handle = attachMonacoModelSync(stub as unknown as typeof import('monaco-editor'))
    expect(stub.__models.has('inmemory://pou/Doomed.st')).toBe(true)

    setProjectPous([makeStPou('Keeper')])
    expect(stub.__models.has('inmemory://pou/Doomed.st')).toBe(false)
    expect(stub.__models.has('inmemory://pou/Keeper.st')).toBe(true)
    handle.dispose()
  })

  it('does NOT dispose models on the transient empty-pous clear (stash reload guard)', () => {
    // `handleOpenProjectResponse` sets `pous = []` before repopulating on every
    // project reload (e.g. after a stash apply/pop).  The owned models must
    // survive that transient so the open editor keeps its (still-attached)
    // model — otherwise @monaco-editor/react crashes on a null getModel().
    setProjectPous([makeStPou('Main', 'a := 1;')])
    const stub = makeMonacoStub()
    const handle = attachMonacoModelSync(stub as unknown as typeof import('monaco-editor'))
    expect(stub.__models.has('inmemory://pou/Main.st')).toBe(true)

    // Transient clear — model must NOT be disposed.
    setProjectPous([])
    expect(stub.__models.get('inmemory://pou/Main.st')!.disposed).toBe(false)

    // Repopulate with updated body — same model is reused and synced.
    setProjectPous([makeStPou('Main', 'a := 2;')])
    expect(stub.__models.get('inmemory://pou/Main.st')!.value).toBe('a := 2;')
    handle.dispose()
  })

  it('disposes every model it created on handle.dispose()', () => {
    setProjectPous([makeStPou('A'), makeStPou('B')])
    const stub = makeMonacoStub()
    const handle = attachMonacoModelSync(stub as unknown as typeof import('monaco-editor'))

    expect(stub.__models.size).toBe(2)
    handle.dispose()
    expect(stub.__models.size).toBe(0)
  })

  it('is safe to dispose twice', () => {
    setProjectPous([makeStPou('A')])
    const stub = makeMonacoStub()
    const handle = attachMonacoModelSync(stub as unknown as typeof import('monaco-editor'))
    handle.dispose()
    expect(() => handle.dispose()).not.toThrow()
  })
})

/**
 * Pins the coupling that makes the file-watch reload guard necessary (DOPE-652,
 * GitHub #977).
 *
 * An ST body editor binds to `pouUri(name)`, the same URI this sync owns, so any
 * write to a POU body in the store reaches that editor's own Monaco model as a
 * full `setValue`.  `@monaco-editor/react` only suppresses `onChange` for the
 * edits it performs itself, so a `setValue` coming from here does fire it, and
 * the editor's `handleWriteInPou` treats that as a user edit and flags the file
 * unsaved.  Harmless while the write came from typing; wrong when it came from
 * disk, because `handleExternalChange` only reloads a file that is still saved
 * and the sync then stops for good.
 *
 * `reloadFromDisk` and the mount-time external-change check therefore raise
 * `isSyncingModelRef` around their `updatePou` call.  This test does not
 * exercise that flag (it lives in a closure inside the editor component); it
 * pins the chain the flag exists to interrupt, so that a change to the URI
 * sharing or to the subscription shows up here rather than as a silent
 * regression of #977.
 */
describe('store write reaches the shared ST model synchronously', () => {
  /** Like `makeMonacoStub`, but `setValue` notifies content-change listeners as the real model does. */
  function makeListeningMonacoStub() {
    const models = new Map<string, { uri: string; value: string; listeners: Array<() => void> }>()
    const wrappers = new Map<string, unknown>()

    function wrap(m: { uri: string; value: string; listeners: Array<() => void> }) {
      const w = {
        getValue: () => m.value,
        setValue: (v: string) => {
          m.value = v
          m.listeners.forEach((l) => l())
        },
        onDidChangeModelContent: (l: () => void) => {
          m.listeners.push(l)
          return { dispose: () => undefined }
        },
        dispose: () => {
          models.delete(m.uri)
          wrappers.delete(m.uri)
        },
      }
      wrappers.set(m.uri, w)
      return w
    }

    return {
      Uri: { parse: (uri: string) => ({ toString: () => uri }) },
      editor: {
        getModel: (uri: { toString: () => string }) => wrappers.get(uri.toString()) ?? null,
        createModel: (value: string, _language: string, uri: { toString: () => string }) => {
          const m = { uri: uri.toString(), value, listeners: [] as Array<() => void> }
          models.set(uri.toString(), m)
          return wrap(m)
        },
      },
      __wrappers: wrappers,
    }
  }

  it('updatePou drives setValue on pou://, and an unguarded onChange would flag the file unsaved', () => {
    const state = openPLCStoreBase.getState()
    state.fileActions.clearFiles()
    setProjectPous([makeStPou('Main', 'a := 1;')])
    state.fileActions.addFile({ name: 'Main', type: 'program', filePath: 'pous/programs/Main.st' })
    state.fileActions.updateFile({ name: 'Main', saved: true })
    expect(openPLCStoreBase.getState().fileActions.getSavedState({ name: 'Main' })).toBe(true)

    const stub = makeListeningMonacoStub()
    const handle = attachMonacoModelSync(stub as unknown as typeof import('monaco-editor'))

    const model = stub.__wrappers.get('inmemory://pou/Main.st') as {
      getValue: () => string
      onDidChangeModelContent: (l: () => void) => { dispose: () => void }
    }
    expect(model).toBeDefined()

    // Stands in for what @monaco-editor/react registers: it calls the editor's
    // onChange for every content change it did not itself make.
    let onChangeCalls = 0
    model.onDidChangeModelContent(() => {
      onChangeCalls += 1
      openPLCStoreBase.getState().sharedWorkspaceActions.handleFileAndWorkspaceSavedState('Main')
    })

    // What `reloadFromDisk` does once it has parsed the file from disk.
    openPLCStoreBase.getState().projectActions.updatePou({
      name: 'Main',
      content: { language: 'st', value: 'a := 42;' },
    })

    expect(onChangeCalls).toBe(1)
    expect(model.getValue()).toBe('a := 42;')
    expect(openPLCStoreBase.getState().fileActions.getSavedState({ name: 'Main' })).toBe(false)

    handle.dispose()
  })
})
