import { checkIdentifier, type IdentifierViolation, sameIdentifier } from './identifier'
import type { Variable, VariableDocument, VariableType } from './variable'

/** Every way an edit can break the document rules. Discriminated by `kind` so callers can switch exhaustively. */
export type VariableRuleViolation =
  | { readonly kind: 'invalid-name'; readonly name: string; readonly reason: IdentifierViolation }
  | { readonly kind: 'duplicate-name'; readonly name: string }
  | { readonly kind: 'unknown-variable'; readonly id: number }

/** Result of an edit: either the next document or the violation. Domain functions never throw for rule errors. */
export type VariableRuleResult =
  | { readonly ok: true; readonly document: VariableDocument }
  | { readonly ok: false; readonly violation: VariableRuleViolation }

// `ignoringId` lets a variable keep its own name, or change only its case, during a rename.
function checkName(document: VariableDocument, name: string, ignoringId?: number): VariableRuleViolation | null {
  const reason = checkIdentifier(name)
  if (reason) return { kind: 'invalid-name', name, reason }
  const taken = document.variables.some((variable) => variable.id !== ignoringId && sameIdentifier(variable.name, name))
  return taken ? { kind: 'duplicate-name', name } : null
}

/** Appends a variable using `nextId`. Returns a new document; the input is never mutated. */
export function addVariable(document: VariableDocument, name: string, type: VariableType): VariableRuleResult {
  const violation = checkName(document, name)
  if (violation) return { ok: false, violation }
  const variable: Variable = { id: document.nextId, name, type }
  return { ok: true, document: { variables: [...document.variables, variable], nextId: document.nextId + 1 } }
}

/**
 * Renames one variable. When the name does not change the same document object is returned, which lets
 * the application skip creating a new revision.
 */
export function renameVariable(document: VariableDocument, id: number, name: string): VariableRuleResult {
  const target = document.variables.find((variable) => variable.id === id)
  if (!target) return { ok: false, violation: { kind: 'unknown-variable', id } }
  const violation = checkName(document, name, id)
  if (violation) return { ok: false, violation }
  if (target.name === name) return { ok: true, document }
  return {
    ok: true,
    document: {
      ...document,
      // Untouched variables keep their object identity, so projections can reuse them.
      variables: document.variables.map((variable) => (variable.id === id ? { ...variable, name } : variable)),
    },
  }
}

/** Removes one variable. `nextId` is kept so the removed id is not handed out again. */
export function removeVariable(document: VariableDocument, id: number): VariableRuleResult {
  if (!document.variables.some((variable) => variable.id === id)) {
    return { ok: false, violation: { kind: 'unknown-variable', id } }
  }
  return { ok: true, document: { ...document, variables: document.variables.filter((variable) => variable.id !== id) } }
}

/**
 * Checks the invariants a document read from outside the domain must satisfy before it is used:
 * positive unique ids below `nextId`, valid identifiers and unique names.
 */
export function isConsistentDocument(document: VariableDocument): boolean {
  const ids = new Set<number>()
  return document.variables.every((variable, index) => {
    const validId = Number.isInteger(variable.id) && variable.id > 0 && variable.id < document.nextId
    const uniqueId = !ids.has(variable.id)
    ids.add(variable.id)
    const others = document.variables.slice(0, index)
    const validName =
      checkIdentifier(variable.name) === null && !others.some((other) => sameIdentifier(other.name, variable.name))
    return validId && uniqueId && validName
  })
}
