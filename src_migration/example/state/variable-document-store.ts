import { createStore } from 'zustand/vanilla'

import type { VariableDocumentState, VariableDocumentStatePort } from '../application/ports'
import { EMPTY_VARIABLE_DOCUMENT } from '../domain'

const INITIAL_STATE: VariableDocumentState = {
  document: EMPTY_VARIABLE_DOCUMENT,
  revision: 0,
  savedRevision: 0,
  activity: 'idle',
  failure: null,
}

/**
 * State layer: implements the application's state port with a vanilla Zustand store. This is the only
 * place that knows Zustand; the store is never exposed, only the port's transactional methods.
 * Each call creates an independent instance, so two sessions never share state.
 */
export function createVariableDocumentStore(): VariableDocumentStatePort {
  const store = createStore<VariableDocumentState>()(() => INITIAL_STATE)

  return {
    getState: store.getState,
    // Zustand passes (state, previous) to listeners; the port contract only promises a notification.
    subscribe: (listener) => store.subscribe(() => listener()),
    commitEdit: (document) => store.setState((state) => ({ document, revision: state.revision + 1 })),
    replaceLoaded: (document) =>
      store.setState((state) => ({
        document,
        revision: state.revision + 1,
        savedRevision: state.revision + 1,
        activity: 'idle',
        failure: null,
      })),
    beginActivity: (activity) => store.setState({ activity, failure: null }),
    finishSave: (revision) =>
      store.setState((state) => ({
        // Max guards against an older save finishing after a newer one.
        savedRevision: Math.max(state.savedRevision, revision),
        activity: 'idle',
        failure: null,
      })),
    failActivity: (failure) => store.setState({ activity: 'idle', failure }),
  }
}
