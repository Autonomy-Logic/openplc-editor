// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Variable resolution for the graphical (LD / FBD) editors, backed by the
 * STruC++ LSP.
 *
 * The graphical variable boxes used to filter a flat list of the POU's
 * local `interface.variables` by a hardcoded type map. That couldn't see
 * instance members (`TON0.Q`), struct/enum members or anything the type
 * system knows. This module replaces it with the same intelligence the ST
 * editor gets: it asks strucpp to complete an expression in the POU's
 * scope (see `st-lsp/scoped-query`), keeps the real variables/members
 * (LSP `Variable` kind, which carry a resolved IEC type), and filters them
 * by the box's expected type via {@link validateVariableType}.
 *
 * Two entry points, sharing the same machinery:
 *   - {@link getScopeCompletions} — autocomplete candidates for a box.
 *   - {@link resolveScopeExpressionType} — the type of a typed-in
 *     expression, for red/valid validation.
 */

import type { PLCVariable } from '../../middleware/shared/ports/types'
import { openPLCStoreBase } from '../store'
import type { BoundBlockPin } from '../utils/PLC/validate-variable-type'
import {
  getVariableRestrictionType,
  resolveNewVariableType,
  validateVariableType,
} from '../utils/PLC/validate-variable-type'
import { collectDeclaredRoots, rootIdentifierOf } from './project-scope-roots'
// The leaf, not the `st-lsp` barrel: the barrel pulls ESM-only LSP packages that Jest cannot transform.
import type { ScopedCompletionItem } from './st-lsp/scoped-query'
import { getScopedQueryApi, isValueCompletionKind, splitExpression } from './st-lsp/scoped-query'

/** Max instance/struct variables to drill into when a type-filtered search has no direct hits. */
const SCOPE_EXPAND_LIMIT = 8

/** True for an instance/struct/enum (non-base) type — i.e. one that may expose dotted members. */
function isDerivedType(type: string): boolean {
  return getVariableRestrictionType(type).definition === 'derived'
}

/** A single autocomplete candidate for a graphical variable box. */
export interface ScopeCompletion {
  /** Symbol/member name as shown in the dropdown (e.g. `Q`, `Moisture`). */
  label: string
  /** Full text to write into the box — the resolved anchor prefix plus the label (e.g. `TON0.Q`). */
  insertText: string
  /** Resolved IEC type, when strucpp provided one. */
  type?: string
}

/**
 * Outcome of resolving an expression's type:
 *   - `unavailable`: the LSP couldn't answer (not ready / no context) —
 *     callers should NOT flag the box invalid (avoids a false red during
 *     boot or while the worker warms).
 *   - `unknown`: the LSP answered but the expression isn't a valid symbol
 *     in scope — the box is invalid.
 *   - `resolved`: the expression resolves to `type`.
 */
export type ScopeTypeResult = { status: 'unavailable' } | { status: 'unknown' } | { status: 'resolved'; type: string }

/**
 * Autocomplete candidates for `value` typed into a box in `pouName`'s
 * scope. `value` is the full current box text (e.g. `TON0.Q`, `mo`).
 * When `expectedType` is given, only candidates whose resolved type is
 * compatible with it are returned. Returns [] when the LSP is unavailable.
 */
export async function getScopeCompletions(
  pouName: string,
  value: string,
  expectedType?: string,
): Promise<ScopeCompletion[]> {
  const api = getScopedQueryApi()
  if (!api) return []

  const { anchor, segment } = splitExpression(value)
  // Library symbols share the scope; only what the project declared may bind.
  const roots = collectDeclaredRoots(openPLCStoreBase.getState().project.data, pouName)
  if (anchor && !roots.has(rootIdentifierOf(anchor))) return []

  const items = await api.completeInScope(pouName, anchor)
  const needle = segment.toLowerCase()
  const matching = items.filter(
    (item) =>
      isValueCompletionKind(item.kind) &&
      item.label.toLowerCase().includes(needle) &&
      // Under an anchor the root was checked above; bare labels are the root.
      (anchor !== '' || roots.has(rootIdentifierOf(item.label))),
  )

  const direct = matching
    .filter((item) => {
      if (!expectedType) return true
      if (!item.type) return false
      return validateVariableType(item.type, expectedType).isValid
    })
    .map((item) => ({
      label: item.label,
      insertText: anchor + item.label,
      ...(item.type ? { type: item.type } : {}),
    }))

  // When a type-filtered search yields no direct hits, the user may be
  // reaching for a member of an instance/struct whose own type doesn't match
  // the box (e.g. `TO` on a BOOL contact: `TON0` is a TON, but `TON0.Q` is
  // BOOL). Drill one level into the matching instance/struct variables and
  // surface their compatible members. Gated on "no direct hits" + capped, so
  // the extra LSP round-trips stay rare and bounded.
  // Only an unanchored empty box names no instance to drill into; `GVL.` names one.
  if (!expectedType || direct.length > 0 || (!anchor && !segment.trim())) return direct

  const expandable = matching.filter((item) => item.type && isDerivedType(item.type)).slice(0, SCOPE_EXPAND_LIMIT)
  const expanded = await Promise.all(
    expandable.map(async (instance) => {
      const memberAnchor = `${anchor}${instance.label}.`
      const members = await api.completeInScope(pouName, memberAnchor)
      return members
        .filter((m) => isValueCompletionKind(m.kind) && m.type && validateVariableType(m.type, expectedType).isValid)
        .map((m) => ({ label: `${instance.label}.${m.label}`, insertText: memberAnchor + m.label, type: m.type }))
    }),
  )
  return expanded.flat()
}

/**
 * Resolve the IEC type of `expression` in `pouName`'s scope. Handles bare
 * identifiers, member chains (`TON0.Q`, `s.a.b`) and array element access
 * (`arr[3]`, `grid[1,2]`). See {@link ScopeTypeResult} for the tri-state result.
 *
 * Array elements need no special casing: strucpp lists each in-bounds element
 * as its own symbol typed as the element type, so `arr[3]` matches by label
 * like any other. That also makes the bounds authoritative — `arr[99]` simply
 * isn't a symbol, so it resolves `unknown` and the box is flagged, which a
 * client-side subscript-stripping heuristic could never detect.
 */
export async function resolveScopeExpressionType(pouName: string, expression: string): Promise<ScopeTypeResult> {
  const api = getScopedQueryApi()
  if (!api) return { status: 'unavailable' }

  const expr = expression.trim()
  if (!expr) return { status: 'unknown' }

  const { anchor, segment } = splitExpression(expr)
  const items = await api.completeInScope(pouName, anchor)
  // Empty even after the service's warm-up retries means the worker has no
  // context yet — treat as unavailable rather than flag a false invalid.
  if (items.length === 0) return { status: 'unavailable' }

  const match = items.find(
    (item) => isValueCompletionKind(item.kind) && item.label.toLowerCase() === segment.toLowerCase(),
  )
  if (match && match.type) return { status: 'resolved', type: match.type }

  // No symbol by that name. One case is still legal and has to be resolved
  // here rather than by the language server: a subscript that is a VARIABLE.
  return resolveVariableSubscript(pouName, segment, items)
}

/** `base` and the subscript expressions of `base[a, b]`, or undefined. */
function splitSubscripts(segment: string): { base: string; subscripts: string[] } | undefined {
  const open = segment.indexOf('[')
  if (open <= 0 || !segment.trimEnd().endsWith(']')) return undefined
  const base = segment.slice(0, open)
  const inner = segment.slice(open + 1, segment.lastIndexOf(']'))
  if (inner.includes('[')) return undefined // nested subscripts are out of scope
  const subscripts = inner.split(',').map((x) => x.trim())
  if (subscripts.some((x) => x.length === 0)) return undefined
  return { base, subscripts }
}

const INTEGER_LITERAL = /^[+-]?\d+$/

/**
 * `arr[i]` — an array element whose subscript is a variable.
 *
 * IEC 61131-3 Ed 3 §6.4.4.5.1 restricts a subscript in the graphical languages
 * to "single-element variables or integer literals", and §8.1.2 shows exactly
 * this on a contact: `Xs[i]`, *"as an array element with variable subscript"*.
 * So it is legal and the box must not be flagged.
 *
 * The language server cannot answer it. It publishes one symbol per in-bounds
 * element — `arr[0]`, `arr[1]`, … — which is what makes a LITERAL subscript
 * bounds-checked for free, and deliberately so: `arr[99]` is not a symbol and
 * stays flagged. A variable subscript has no such symbol and never could, and
 * the standard agrees it cannot be checked here — §6.4.4.5.1 note: *"This
 * error can be detected only at runtime for a computed index."*
 *
 * So resolve it from the element symbols instead, and check what can be
 * checked: the base is an array in scope, the subscript count matches its
 * dimensions, and every variable subscript is an integer. A REAL subscript
 * stays unknown — the standard does not allow one.
 */
async function resolveVariableSubscript(
  pouName: string,
  segment: string,
  items: ScopedCompletionItem[],
): Promise<ScopeTypeResult> {
  const parts = splitSubscripts(segment)
  if (!parts) return { status: 'unknown' }

  // All-literal subscripts already had their chance above. Reaching here means
  // the element is out of bounds, which is a real fault worth showing.
  if (parts.subscripts.every((x) => INTEGER_LITERAL.test(x))) return { status: 'unknown' }

  // Any element symbol of this array carries the element type, and its own
  // subscript count is the array's dimensionality. Taking it from the symbol
  // rather than parsing the rendered `ARRAY [0..3] OF BOOL` keeps the language
  // server the authority on both.
  const prefix = `${parts.base.toLowerCase()}[`
  const element = items.find((item) => isValueCompletionKind(item.kind) && item.label.toLowerCase().startsWith(prefix))
  if (!element || !element.type) return { status: 'unknown' }

  const elementParts = splitSubscripts(element.label)
  if (!elementParts || elementParts.subscripts.length !== parts.subscripts.length) {
    return { status: 'unknown' }
  }

  for (const subscript of parts.subscripts) {
    if (INTEGER_LITERAL.test(subscript)) continue
    // Resolved from the POU's own scope, NOT from the array's anchor. The `i`
    // in `NET.bits[i]` is a variable of the POU, not a member of `NET` — and a
    // subscript that really is a list member is written out in full as
    // `NET.bits[NET.idx]`, which resolves here just the same.
    const subscriptType = await resolveScopeExpressionType(pouName, subscript)
    if (subscriptType.status === 'unavailable') return { status: 'unavailable' }
    if (subscriptType.status !== 'resolved') return { status: 'unknown' }
    if (!validateVariableType(subscriptType.type, 'ANY_INT').isValid) return { status: 'unknown' }
  }

  return { status: 'resolved', type: element.type }
}

/**
 * Convenience for validation: does `expression` resolve to a type
 * compatible with `expectedType`? `unavailable` resolves to `true` so the
 * caller doesn't paint a false invalid while the LSP is warming.
 */
export async function isExpressionValidForType(
  pouName: string,
  expression: string,
  expectedType: string,
): Promise<boolean> {
  const result = await resolveScopeExpressionType(pouName, expression)
  if (result.status === 'unavailable') return true
  if (result.status === 'unknown') return false
  return validateVariableType(result.type, expectedType).isValid
}

/**
 * Is `name` an instance of function-block type `blockType` in this POU's scope?
 *
 * A block element resolves its instance name against the POU's own
 * `interface.variables`, which structurally cannot see a **global variable
 * list** member: `NET.node` is not in that list under any spelling, so the
 * block painted itself as an error while compiling perfectly. This asks the
 * LSP instead, the way the contacts, coils and variable boxes already do.
 *
 * Returns `undefined` when the LSP cannot answer, so the caller leaves the
 * block alone rather than flashing red while the worker warms up — the same
 * contract `isExpressionValidForType` keeps for its own `unavailable`.
 */
export async function isBlockInstanceInScope(
  pouName: string,
  name: string,
  blockType: string,
): Promise<boolean | undefined> {
  const result = await resolveScopeExpressionType(pouName, name)
  if (result.status === 'unavailable') return undefined
  if (result.status === 'unknown') return false
  return result.type.toLowerCase() === blockType.toLowerCase()
}

/**
 * Concrete `{definition, value}` to type a brand-new variable created from a
 * box's expected type. `boundSiblings` are the pins of the same block instance
 * that already have a variable on them — a generic pin (`ANY`, `ANY_NUM`, …)
 * adopts the concrete type the block resolved to instead of guessing (#479).
 * Decision logic lives in {@link resolveNewVariableType} so it stays testable.
 */
export function newVariableTypeForExpected(
  expectedType: string | undefined,
  boundSiblings: BoundBlockPin[] = [],
): {
  definition: PLCVariable['type']['definition']
  value: string
} {
  const resolved = resolveNewVariableType(expectedType, boundSiblings)
  return {
    definition: (resolved.definition as PLCVariable['type']['definition']) ?? 'base-type',
    value: resolved.value,
  }
}

/** Build the variable reference a graphical node stores when an LSP completion is chosen. */
export function scopeCompletionToVariable(candidate: ScopeCompletion): PLCVariable {
  const restriction = candidate.type ? getVariableRestrictionType(candidate.type) : undefined
  const value = restriction?.values
    ? Array.isArray(restriction.values)
      ? restriction.values[0]
      : restriction.values
    : (candidate.type ?? '')
  return {
    id: '',
    name: candidate.insertText,
    type: {
      definition: (restriction?.definition as PLCVariable['type']['definition']) ?? 'base-type',
      value,
    },
    class: 'local',
    location: '',
    documentation: '',
    debug: false,
  } as PLCVariable
}
