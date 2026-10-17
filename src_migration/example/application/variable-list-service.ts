import type {
  CommandResult,
  Unsubscribe,
  VariableListApi,
  VariableListError,
  VariableListSnapshot,
} from '../contracts/application'
import {
  addVariable,
  EMPTY_VARIABLE_DOCUMENT,
  isConsistentDocument,
  removeVariable,
  renameVariable,
  type VariableDocument,
  type VariableRuleResult,
  type VariableRuleViolation,
} from '../domain'
import type { VariableDocumentState, VariableDocumentStatePort, VariablePersistencePort } from './ports'

/** Everything the use cases need, injected as ports. Tests pass fakes; `composition` passes the real ones. */
export interface VariableListServiceDependencies {
  readonly state: VariableDocumentStatePort
  readonly persistence: VariablePersistencePort
}

/** The public API plus `dispose`, which only the composition that created the service should call. */
export interface VariableListService extends VariableListApi {
  readonly dispose: () => void
}

const OK: CommandResult = { ok: true }

function failed(error: VariableListError): CommandResult {
  return { ok: false, error }
}

// Domain violations are translated into contract errors here, so callers never depend on domain types.
function toError(violation: VariableRuleViolation): VariableListError {
  switch (violation.kind) {
    case 'invalid-name':
      return { kind: 'invalid-name', name: violation.name, reason: violation.reason }
    case 'duplicate-name':
      return { kind: 'duplicate-name', name: violation.name }
    case 'unknown-variable':
      return { kind: 'unknown-variable', id: violation.id }
    default: {
      const unreachable: never = violation
      return unreachable
    }
  }
}

function toSnapshot(state: VariableDocumentState): VariableListSnapshot {
  return {
    variables: state.document.variables,
    revision: state.revision,
    dirty: state.revision !== state.savedRevision,
    activity: state.activity,
    lastFailure: state.failure,
  }
}

// Turns a rejected adapter promise into a regular failure, so the public API never rejects.
async function settle<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run()
  } catch {
    return fallback
  }
}

/**
 * Application layer: the use cases of the variable list. It applies domain rules, coordinates the state
 * port and the persistence port, and exposes the result through the public `VariableListApi`.
 */
export function createVariableListService({
  state,
  persistence,
}: VariableListServiceDependencies): VariableListService {
  let disposed = false
  let projectedFrom: VariableDocumentState | null = null
  let projection: VariableListSnapshot | null = null
  const subscriptions = new Set<Unsubscribe>()

  // Rebuilds the snapshot only when the underlying state object changed, so callers get a stable reference.
  const getSnapshot = (): VariableListSnapshot => {
    const current = state.getState()
    if (current !== projectedFrom || projection === null) {
      projectedFrom = current
      projection = toSnapshot(current)
    }
    return projection
  }

  // Every subscription is tracked so `dispose` can release the ones callers forgot.
  const subscribe = (listener: () => void): Unsubscribe => {
    if (disposed) return () => undefined
    const unsubscribe = state.subscribe(listener)
    subscriptions.add(unsubscribe)
    return () => {
      if (subscriptions.delete(unsubscribe)) unsubscribe()
    }
  }

  // Shared path of the three edit commands: guard, apply the domain rule, commit one revision.
  const edit = (apply: (document: VariableDocument) => VariableRuleResult): CommandResult => {
    if (disposed) return failed({ kind: 'disposed' })
    const current = state.getState()
    // Edits during a load would be overwritten by the loaded document; edits during a save are allowed.
    if (current.activity === 'loading') return failed({ kind: 'busy' })
    const result = apply(current.document)
    if (!result.ok) return failed(toError(result.violation))
    if (result.document !== current.document) state.commitEdit(result.document)
    return OK
  }

  const load = async (): Promise<CommandResult> => {
    if (disposed) return failed({ kind: 'disposed' })
    if (state.getState().activity !== 'idle') return failed({ kind: 'busy' })
    state.beginActivity('loading')
    const result = await settle(() => persistence.load(), { ok: false })
    // A reply that arrives after dispose belongs to a session that no longer exists.
    if (disposed) return failed({ kind: 'disposed' })
    // The adapter checks the shape; the domain decides whether the content is acceptable.
    if (!result.ok || (result.document !== null && !isConsistentDocument(result.document))) {
      state.failActivity('load-failed')
      return failed({ kind: 'load-failed' })
    }
    state.replaceLoaded(result.document ?? EMPTY_VARIABLE_DOCUMENT)
    return OK
  }

  const save = async (): Promise<CommandResult> => {
    if (disposed) return failed({ kind: 'disposed' })
    // The document and revision are captured now; edits made while saving belong to a later revision.
    const current = state.getState()
    if (current.activity !== 'idle') return failed({ kind: 'busy' })
    state.beginActivity('saving')
    const result = await settle(() => persistence.save(current.document), { ok: false })
    if (disposed) return failed({ kind: 'disposed' })
    if (!result.ok) {
      state.failActivity('save-failed')
      return failed({ kind: 'save-failed' })
    }
    state.finishSave(current.revision)
    return OK
  }

  return {
    getSnapshot,
    subscribe,
    load,
    save,
    addVariable: ({ name, type }) => edit((document) => addVariable(document, name, type)),
    renameVariable: ({ id, name }) => edit((document) => renameVariable(document, id, name)),
    removeVariable: ({ id }) => edit((document) => removeVariable(document, id)),
    dispose: () => {
      disposed = true
      subscriptions.forEach((unsubscribe) => unsubscribe())
      subscriptions.clear()
    },
  }
}
