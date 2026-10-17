/** IEC 61131-3 elementary types offered by the example. The domain owns this list; outer layers mirror it. */
export const VARIABLE_TYPES = ['BOOL', 'INT', 'REAL'] as const

export type VariableType = (typeof VARIABLE_TYPES)[number]

/** Domain entity. Plain immutable data: no methods, no framework types, safe to share by reference. */
export interface Variable {
  readonly id: number
  readonly name: string
  readonly type: VariableType
}

/**
 * The editable document: the canonical representation that is validated, versioned and persisted.
 * `nextId` only grows, so an id is never reused after a variable is removed.
 */
export interface VariableDocument {
  readonly variables: readonly Variable[]
  readonly nextId: number
}

export const EMPTY_VARIABLE_DOCUMENT: VariableDocument = { variables: [], nextId: 1 }

/** Type guard used by adapters to narrow untrusted input (for example parsed JSON) into a `VariableType`. */
export function isVariableType(value: unknown): value is VariableType {
  return VARIABLE_TYPES.some((type) => type === value)
}
