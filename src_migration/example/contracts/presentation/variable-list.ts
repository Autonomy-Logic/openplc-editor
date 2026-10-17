import type { ReadModel } from './read-model'

// Presentation contract: what a view receives (model) and what it may emit (intents). No domain or store types.

export type VariableTypeOption = 'BOOL' | 'INT' | 'REAL'

export type StatusTone = 'neutral' | 'busy' | 'warning' | 'error'

/** Draft of an in-progress rename. The error is ready-to-show text. */
export interface RenameDraftModel {
  readonly draft: string
  readonly error: string | null
}

/** One list row. `rename` is set only on the row being renamed. */
export interface VariableRowModel {
  readonly id: number
  readonly name: string
  readonly type: VariableTypeOption
  readonly rename: RenameDraftModel | null
}

/** The "add variable" form. Its values live in the controller, so the view stays stateless. */
export interface NewVariableModel {
  readonly name: string
  readonly type: VariableTypeOption
  readonly error: string | null
}

export interface VariableListStatusModel {
  readonly tone: StatusTone
  readonly text: string
}

/** Everything the list view renders, already decided: texts, enabled flags and rows. The view adds no logic. */
export interface VariableListModel {
  readonly rows: readonly VariableRowModel[]
  readonly emptyMessage: string
  readonly newVariable: NewVariableModel
  readonly typeOptions: readonly VariableTypeOption[]
  readonly status: VariableListStatusModel
  readonly editable: boolean
  readonly canSave: boolean
}

/** What the user can ask for. Fire-and-forget: results come back through the model, not return values. */
export interface VariableListIntents {
  readonly changeNewName: (value: string) => void
  readonly changeNewType: (value: VariableTypeOption) => void
  readonly submitNew: () => void
  readonly startRename: (id: number) => void
  readonly changeRename: (value: string) => void
  readonly commitRename: () => void
  readonly cancelRename: () => void
  readonly remove: (id: number) => void
  readonly requestSave: () => void
}

/** Implemented by the real controller and by fixtures alike, which is why the same view runs with either. */
export interface VariableListController extends VariableListIntents {
  readonly model: ReadModel<VariableListModel>
}
