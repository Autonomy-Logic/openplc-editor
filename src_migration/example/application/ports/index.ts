// Output ports: what the application needs from the outside, declared by the application itself.
// `state` and `infrastructure` implement them; the application never imports those layers.
import type { VariableDocument } from '../../domain'

export type Unsubscribe = () => void

export type DocumentActivity = 'idle' | 'loading' | 'saving'

export type OperationFailure = 'load-failed' | 'save-failed'

/**
 * The document plus its bookkeeping. `revision` grows on every committed change; `savedRevision` is the
 * revision last written successfully. The document is dirty while the two differ.
 */
export interface VariableDocumentState {
  readonly document: VariableDocument
  readonly revision: number
  readonly savedRevision: number
  readonly activity: DocumentActivity
  readonly failure: OperationFailure | null
}

/**
 * Owner of the editable document. Every method is one transaction producing a new immutable state, so
 * document, revision and dirty flag can never be observed out of step. Specific to this feature on purpose:
 * no generic `setState`.
 */
export interface VariableDocumentStatePort {
  readonly getState: () => VariableDocumentState
  readonly subscribe: (listener: () => void) => Unsubscribe
  /** Replaces the document after a successful edit and creates a new revision. */
  readonly commitEdit: (document: VariableDocument) => void
  /** Installs a document read from storage as a new, already saved revision. */
  readonly replaceLoaded: (document: VariableDocument) => void
  readonly beginActivity: (activity: 'loading' | 'saving') => void
  /** Marks `revision` (captured when the save started) as saved; later revisions stay dirty. */
  readonly finishSave: (revision: number) => void
  readonly failActivity: (failure: OperationFailure) => void
}

/** `document: null` means nothing was stored yet; `ok: false` means something was stored but is unusable. */
export type PersistenceLoadResult =
  | { readonly ok: true; readonly document: VariableDocument | null }
  | { readonly ok: false }

export interface PersistenceSaveResult {
  readonly ok: boolean
}

/** Storage of the document. Adapters decide where (localStorage, memory, a file); the application only sees this. */
export interface VariablePersistencePort {
  readonly load: () => Promise<PersistenceLoadResult>
  readonly save: (document: VariableDocument) => Promise<PersistenceSaveResult>
}
