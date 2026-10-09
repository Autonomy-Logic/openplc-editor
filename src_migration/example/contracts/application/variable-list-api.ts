// Public application contract. It depends on nothing, so callers never see domain, state or adapter types.

export type Unsubscribe = () => void

/** Mirrors the domain's variable types; the application maps between them, so neither side imports the other. */
export type VariableTypeName = 'BOOL' | 'INT' | 'REAL'

/** A variable as callers see it. Read-only data, not the domain entity. */
export interface VariableItem {
  readonly id: number
  readonly name: string
  readonly type: VariableTypeName
}

/** The operation currently running, if any. Only one load or save runs at a time. */
export type VariableListActivity = 'idle' | 'loading' | 'saving'

/** The last operation that failed; cleared when the next load or save starts. */
export type VariableListFailure = 'load-failed' | 'save-failed'

/** Everything a caller can observe. `dirty` means the current revision differs from the last saved one. */
export interface VariableListSnapshot {
  readonly variables: readonly VariableItem[]
  readonly revision: number
  readonly dirty: boolean
  readonly activity: VariableListActivity
  readonly lastFailure: VariableListFailure | null
}

/** Why a command was refused. Data, not text: presentation decides the wording. */
export type VariableListError =
  | { readonly kind: 'invalid-name'; readonly name: string; readonly reason: 'empty' | 'invalid-format' }
  | { readonly kind: 'duplicate-name'; readonly name: string }
  | { readonly kind: 'unknown-variable'; readonly id: number }
  | { readonly kind: 'busy' }
  | { readonly kind: 'disposed' }
  | { readonly kind: VariableListFailure }

export type CommandResult = { readonly ok: true } | { readonly ok: false; readonly error: VariableListError }

export interface AddVariableCommand {
  readonly name: string
  readonly type: VariableTypeName
}

export interface RenameVariableCommand {
  readonly id: number
  readonly name: string
}

export interface RemoveVariableCommand {
  readonly id: number
}

/**
 * Public application API of the variable list, shared by every caller (UI, shortcuts, tools).
 * `getSnapshot` returns the same object until the state changes. Asynchronous methods never reject.
 * Members are function properties, not methods, so they can be passed around without losing `this`.
 */
export interface VariableListApi {
  readonly getSnapshot: () => VariableListSnapshot
  readonly subscribe: (listener: () => void) => Unsubscribe
  readonly load: () => Promise<CommandResult>
  readonly addVariable: (command: AddVariableCommand) => CommandResult
  readonly renameVariable: (command: RenameVariableCommand) => CommandResult
  readonly removeVariable: (command: RemoveVariableCommand) => CommandResult
  readonly save: () => Promise<CommandResult>
}
