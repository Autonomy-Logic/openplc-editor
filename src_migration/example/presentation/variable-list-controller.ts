import type { VariableItem, VariableListApi, VariableListSnapshot } from '../contracts/application'
import type {
  RenameDraftModel,
  VariableListController,
  VariableListModel,
  VariableRowModel,
  VariableTypeOption,
} from '../contracts/presentation'
import { describeError, describeStatus } from './messages'

const TYPE_OPTIONS: readonly VariableTypeOption[] = ['BOOL', 'INT', 'REAL']

// Presentation-only state: form drafts and messages. It never reaches the document or the persistence port.
interface LocalState {
  readonly newName: string
  readonly newType: VariableTypeOption
  readonly newError: string | null
  readonly rename: { readonly id: number; readonly model: RenameDraftModel } | null
  readonly notice: string | null
}

const INITIAL_LOCAL: LocalState = { newName: '', newType: 'BOOL', newError: null, rename: null, notice: null }

/** The controller plus `dispose`, which only the composition that created it should call. */
export interface VariableListPresenter extends VariableListController {
  readonly dispose: () => void
}

function sameRow(row: VariableRowModel, variable: VariableItem, rename: RenameDraftModel | null): boolean {
  return row.name === variable.name && row.type === variable.type && row.rename === rename
}

/**
 * Presentation layer: a headless controller with no React and no Zustand. It reads the application
 * snapshot, combines it with local form state, and exposes one immutable `VariableListModel` plus intents
 * that call the application API. It is testable with a plain fake API.
 */
export function createVariableListController(api: VariableListApi): VariableListPresenter {
  let local = INITIAL_LOCAL
  let disposed = false
  let builtFrom: { snapshot: VariableListSnapshot; local: LocalState } | null = null
  let model: VariableListModel | null = null
  let rows = new Map<number, VariableRowModel>()
  const listeners = new Set<() => void>()

  // One subscription to the application, fanned out to every view listener; released by `dispose`.
  const notify = () => listeners.forEach((listener) => listener())
  const unsubscribeApi = api.subscribe(notify)

  const update = (next: Partial<LocalState>) => {
    if (disposed) return
    local = { ...local, ...next }
    notify()
  }

  // Reuses the previous row object when nothing in it changed, so memoized row components skip re-rendering.
  const buildRows = (snapshot: VariableListSnapshot): readonly VariableRowModel[] => {
    const nextRows = new Map<number, VariableRowModel>()
    const list = snapshot.variables.map((variable) => {
      const rename = local.rename?.id === variable.id ? local.rename.model : null
      const previous = rows.get(variable.id)
      const row =
        previous && sameRow(previous, variable, rename)
          ? previous
          : { id: variable.id, name: variable.name, type: variable.type, rename }
      nextRows.set(variable.id, row)
      return row
    })
    rows = nextRows
    return list
  }

  // Lazily rebuilt: a new model object exists only when the snapshot or the local state actually changed.
  const getSnapshot = (): VariableListModel => {
    const snapshot = api.getSnapshot()
    if (model && builtFrom?.snapshot === snapshot && builtFrom.local === local) return model
    const editable = snapshot.activity !== 'loading'
    model = {
      rows: buildRows(snapshot),
      emptyMessage: snapshot.activity === 'loading' ? 'Loading…' : 'No variables yet.',
      newVariable: { name: local.newName, type: local.newType, error: local.newError },
      typeOptions: TYPE_OPTIONS,
      status: describeStatus(snapshot, local.notice),
      editable,
      canSave: snapshot.dirty && snapshot.activity === 'idle',
    }
    builtFrom = { snapshot, local }
    return model
  }

  const subscribe = (listener: () => void) => {
    if (disposed) return () => undefined
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  // Intents are arrow functions so a view can pass them straight to event handlers.
  return {
    model: { getSnapshot, subscribe },
    changeNewName: (value) => update({ newName: value, newError: null }),
    changeNewType: (value) => update({ newType: value }),
    submitNew: () => {
      // Trimming is input handling, so it happens here; the domain validates exactly what it receives.
      const result = api.addVariable({ name: local.newName.trim(), type: local.newType })
      update(result.ok ? { newName: '', newError: null, notice: null } : { newError: describeError(result.error) })
    },
    startRename: (id) => {
      const variable = api.getSnapshot().variables.find((item) => item.id === id)
      if (variable) update({ rename: { id, model: { draft: variable.name, error: null } } })
    },
    changeRename: (value) => {
      if (local.rename) update({ rename: { id: local.rename.id, model: { draft: value, error: null } } })
    },
    commitRename: () => {
      const rename = local.rename
      if (!rename) return
      const result = api.renameVariable({ id: rename.id, name: rename.model.draft.trim() })
      if (result.ok) {
        update({ rename: null, notice: null })
      } else {
        update({ rename: { id: rename.id, model: { ...rename.model, error: describeError(result.error) } } })
      }
    },
    cancelRename: () => update({ rename: null }),
    remove: (id) => {
      const result = api.removeVariable({ id })
      const rename = local.rename?.id === id ? null : local.rename
      update(result.ok ? { rename, notice: null } : { notice: describeError(result.error) })
    },
    requestSave: () => {
      // The API never rejects; save failures reach the view through the snapshot, only `busy` needs a notice.
      void api.save().then((result) => {
        if (!result.ok && result.error.kind === 'busy') update({ notice: describeError(result.error) })
      })
    },
    dispose: () => {
      disposed = true
      unsubscribeApi()
      listeners.clear()
    },
  }
}
