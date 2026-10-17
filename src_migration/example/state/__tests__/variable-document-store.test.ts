// State tests: the Zustand implementation honours the port's transactions and keeps instances isolated.
import { createVariableDocumentStore } from '..'

const DOCUMENT = { variables: [{ id: 1, name: 'Start', type: 'BOOL' as const }], nextId: 2 }

describe('variable document store', () => {
  it('starts with an empty, clean document', () => {
    const store = createVariableDocumentStore()
    expect(store.getState()).toEqual({
      document: { variables: [], nextId: 1 },
      revision: 0,
      savedRevision: 0,
      activity: 'idle',
      failure: null,
    })
  })

  it('commits an edit as a new revision and notifies', () => {
    const store = createVariableDocumentStore()
    let notified = 0
    store.subscribe(() => notified++)
    store.commitEdit(DOCUMENT)
    expect(store.getState()).toMatchObject({ document: DOCUMENT, revision: 1, savedRevision: 0 })
    expect(notified).toBe(1)
  })

  it('replaces a loaded document as already saved', () => {
    const store = createVariableDocumentStore()
    store.beginActivity('loading')
    store.replaceLoaded(DOCUMENT)
    expect(store.getState()).toMatchObject({ revision: 1, savedRevision: 1, activity: 'idle', failure: null })
  })

  it('never moves the saved revision backwards', () => {
    const store = createVariableDocumentStore()
    store.commitEdit(DOCUMENT)
    store.commitEdit(DOCUMENT)
    store.finishSave(2)
    store.finishSave(1)
    expect(store.getState().savedRevision).toBe(2)
  })

  it('records a failure and returns to idle', () => {
    const store = createVariableDocumentStore()
    store.beginActivity('saving')
    store.failActivity('save-failed')
    expect(store.getState()).toMatchObject({ activity: 'idle', failure: 'save-failed' })
    store.beginActivity('saving')
    expect(store.getState().failure).toBeNull()
  })

  it('stops notifying after unsubscribe', () => {
    const store = createVariableDocumentStore()
    let notified = 0
    const unsubscribe = store.subscribe(() => notified++)
    unsubscribe()
    store.commitEdit(DOCUMENT)
    expect(notified).toBe(0)
  })

  it('keeps instances isolated', () => {
    const first = createVariableDocumentStore()
    const second = createVariableDocumentStore()
    first.commitEdit(DOCUMENT)
    expect(second.getState().revision).toBe(0)
  })
})
