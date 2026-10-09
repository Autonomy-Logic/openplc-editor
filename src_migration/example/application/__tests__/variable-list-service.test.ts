// Application tests: the use cases run against hand-written fake ports, so timing (deferred I/O) is fully controlled.
import type { VariableDocument } from '../../domain'
import { createVariableListService } from '..'
import type {
  PersistenceLoadResult,
  PersistenceSaveResult,
  VariableDocumentState,
  VariableDocumentStatePort,
  VariablePersistencePort,
} from '../ports'

const EMPTY: VariableDocument = { variables: [], nextId: 1 }

function createFakeState(): VariableDocumentStatePort & { readonly listenerCount: () => number } {
  let state: VariableDocumentState = { document: EMPTY, revision: 0, savedRevision: 0, activity: 'idle', failure: null }
  const listeners = new Set<() => void>()
  const set = (next: Partial<VariableDocumentState>) => {
    state = { ...state, ...next }
    listeners.forEach((listener) => listener())
  }
  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    commitEdit: (document) => set({ document, revision: state.revision + 1 }),
    replaceLoaded: (document) =>
      set({
        document,
        revision: state.revision + 1,
        savedRevision: state.revision + 1,
        activity: 'idle',
        failure: null,
      }),
    beginActivity: (activity) => set({ activity, failure: null }),
    finishSave: (revision) =>
      set({ savedRevision: Math.max(state.savedRevision, revision), activity: 'idle', failure: null }),
    failActivity: (failure) => set({ activity: 'idle', failure }),
    listenerCount: () => listeners.size,
  }
}

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function createControlledPersistence() {
  const loads: Deferred<PersistenceLoadResult>[] = []
  const saves: { readonly document: VariableDocument; readonly reply: Deferred<PersistenceSaveResult> }[] = []
  const persistence: VariablePersistencePort = {
    load: () => {
      const reply = deferred<PersistenceLoadResult>()
      loads.push(reply)
      return reply.promise
    },
    save: (document) => {
      const reply = deferred<PersistenceSaveResult>()
      saves.push({ document, reply })
      return reply.promise
    },
  }
  return { persistence, loads, saves }
}

function setup() {
  const state = createFakeState()
  const controlled = createControlledPersistence()
  const service = createVariableListService({ state, persistence: controlled.persistence })
  return { state, service, ...controlled }
}

describe('variable list service', () => {
  it('adds, renames and removes through the domain rules', () => {
    const { service } = setup()
    expect(service.addVariable({ name: 'Start', type: 'BOOL' })).toEqual({ ok: true })
    expect(service.renameVariable({ id: 1, name: 'StartButton' })).toEqual({ ok: true })
    expect(service.getSnapshot().variables).toEqual([{ id: 1, name: 'StartButton', type: 'BOOL' }])
    expect(service.removeVariable({ id: 1 })).toEqual({ ok: true })
    expect(service.getSnapshot()).toMatchObject({ variables: [], revision: 3, dirty: true })
  })

  it('maps domain violations to contract errors without touching the state', () => {
    const { service } = setup()
    service.addVariable({ name: 'Start', type: 'BOOL' })
    const before = service.getSnapshot()
    expect(service.addVariable({ name: 'start', type: 'INT' })).toEqual({
      ok: false,
      error: { kind: 'duplicate-name', name: 'start' },
    })
    expect(service.addVariable({ name: '', type: 'INT' })).toEqual({
      ok: false,
      error: { kind: 'invalid-name', name: '', reason: 'empty' },
    })
    expect(service.removeVariable({ id: 42 })).toEqual({ ok: false, error: { kind: 'unknown-variable', id: 42 } })
    expect(service.getSnapshot()).toBe(before)
  })

  it('does not create a revision when a rename changes nothing', () => {
    const { service } = setup()
    service.addVariable({ name: 'Start', type: 'BOOL' })
    const before = service.getSnapshot()
    expect(service.renameVariable({ id: 1, name: 'Start' })).toEqual({ ok: true })
    expect(service.getSnapshot()).toBe(before)
  })

  it('returns the same snapshot object until the state changes', () => {
    const { service } = setup()
    const first = service.getSnapshot()
    expect(service.getSnapshot()).toBe(first)
    service.addVariable({ name: 'Start', type: 'BOOL' })
    expect(service.getSnapshot()).not.toBe(first)
  })

  it('save success clears dirty for the captured revision', async () => {
    const { service, saves } = setup()
    service.addVariable({ name: 'Start', type: 'BOOL' })
    const saving = service.save()
    expect(service.getSnapshot().activity).toBe('saving')
    saves[0].reply.resolve({ ok: true })
    expect(await saving).toEqual({ ok: true })
    expect(service.getSnapshot()).toMatchObject({ dirty: false, activity: 'idle', lastFailure: null })
  })

  it('an edit made during save stays dirty after the save succeeds', async () => {
    const { service, saves } = setup()
    service.addVariable({ name: 'Start', type: 'BOOL' })
    const saving = service.save()
    expect(service.addVariable({ name: 'Stop', type: 'BOOL' })).toEqual({ ok: true })
    saves[0].reply.resolve({ ok: true })
    await saving
    expect(saves[0].document.variables.map((variable) => variable.name)).toEqual(['Start'])
    expect(service.getSnapshot().dirty).toBe(true)
  })

  it('a failed save keeps the document dirty and reports the failure', async () => {
    const { service, saves } = setup()
    service.addVariable({ name: 'Start', type: 'BOOL' })
    const saving = service.save()
    saves[0].reply.resolve({ ok: false })
    expect(await saving).toEqual({ ok: false, error: { kind: 'save-failed' } })
    expect(service.getSnapshot()).toMatchObject({ dirty: true, activity: 'idle', lastFailure: 'save-failed' })
  })

  it('treats a throwing adapter as a failed save', async () => {
    const state = createFakeState()
    const service = createVariableListService({
      state,
      persistence: { load: () => Promise.reject(new Error('io')), save: () => Promise.reject(new Error('io')) },
    })
    service.addVariable({ name: 'Start', type: 'BOOL' })
    expect(await service.save()).toEqual({ ok: false, error: { kind: 'save-failed' } })
    expect(await service.load()).toEqual({ ok: false, error: { kind: 'load-failed' } })
  })

  it('refuses a second save while one is running', async () => {
    const { service, saves } = setup()
    service.addVariable({ name: 'Start', type: 'BOOL' })
    const first = service.save()
    expect(await service.save()).toEqual({ ok: false, error: { kind: 'busy' } })
    expect(saves).toHaveLength(1)
    saves[0].reply.resolve({ ok: true })
    await first
  })

  it('loads a stored document as the saved revision', async () => {
    const { service, loads } = setup()
    const loading = service.load()
    expect(service.getSnapshot().activity).toBe('loading')
    expect(service.addVariable({ name: 'Early', type: 'BOOL' })).toEqual({ ok: false, error: { kind: 'busy' } })
    loads[0].resolve({ ok: true, document: { variables: [{ id: 4, name: 'Level', type: 'REAL' }], nextId: 5 } })
    expect(await loading).toEqual({ ok: true })
    expect(service.getSnapshot()).toMatchObject({
      variables: [{ id: 4, name: 'Level', type: 'REAL' }],
      dirty: false,
      activity: 'idle',
    })
  })

  it('starts empty when nothing was stored', async () => {
    const { service, loads } = setup()
    const loading = service.load()
    loads[0].resolve({ ok: true, document: null })
    expect(await loading).toEqual({ ok: true })
    expect(service.getSnapshot()).toMatchObject({ variables: [], dirty: false })
  })

  it('rejects a stored document that breaks the domain invariants', async () => {
    const { service, loads } = setup()
    const loading = service.load()
    loads[0].resolve({
      ok: true,
      document: {
        variables: [
          { id: 1, name: 'Same', type: 'INT' },
          { id: 2, name: 'same', type: 'INT' },
        ],
        nextId: 3,
      },
    })
    expect(await loading).toEqual({ ok: false, error: { kind: 'load-failed' } })
    expect(service.getSnapshot()).toMatchObject({ variables: [], lastFailure: 'load-failed' })
  })

  it('ignores a reply that arrives after dispose and releases its subscriptions', async () => {
    const { service, saves, state } = setup()
    service.subscribe(() => undefined)
    service.subscribe(() => undefined)
    expect(state.listenerCount()).toBe(2)
    service.addVariable({ name: 'Start', type: 'BOOL' })
    const saving = service.save()
    service.dispose()
    expect(state.listenerCount()).toBe(0)
    saves[0].reply.resolve({ ok: true })
    expect(await saving).toEqual({ ok: false, error: { kind: 'disposed' } })
    expect(state.getState().activity).toBe('saving')
    expect(service.addVariable({ name: 'Late', type: 'BOOL' })).toEqual({ ok: false, error: { kind: 'disposed' } })
    expect(await service.load()).toEqual({ ok: false, error: { kind: 'disposed' } })
    expect(await service.save()).toEqual({ ok: false, error: { kind: 'disposed' } })
  })

  it('an unsubscribe called twice releases the listener once', () => {
    const { service, state } = setup()
    const unsubscribe = service.subscribe(() => undefined)
    unsubscribe()
    unsubscribe()
    expect(state.listenerCount()).toBe(0)
  })
})
