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
import { getVariableRestrictionType, validateVariableType } from '../utils/PLC/validate-variable-type'
import { getScopedQueryApi } from './st-lsp'

/**
 * LSP `CompletionItemKind`s that denote a value symbol bindable to a box.
 * strucpp emits `Variable` (6) for in-scope variables and FUNCTION_BLOCK
 * instance members (`TON0.Q`), but `Field` (5) for STRUCT members
 * (`my_struct.field`). Both must be accepted, or struct-member access never
 * autocompletes or validates.
 */
const LSP_KIND_VARIABLE = 6
const LSP_KIND_FIELD = 5
const isValueCompletionKind = (kind: number | undefined): boolean =>
  kind === LSP_KIND_VARIABLE || kind === LSP_KIND_FIELD

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

/** Split `value` into the completion anchor (up to and including the last `.`) and the trailing segment. */
function splitExpression(value: string): { anchor: string; segment: string } {
  const lastDot = value.lastIndexOf('.')
  if (lastDot < 0) return { anchor: '', segment: value }
  return { anchor: value.slice(0, lastDot + 1), segment: value.slice(lastDot + 1) }
}

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
  const items = await api.completeInScope(pouName, anchor)
  const needle = segment.toLowerCase()
  const matching = items.filter((item) => isValueCompletionKind(item.kind) && item.label.toLowerCase().includes(needle))

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
  if (!expectedType || direct.length > 0) return direct

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
  if (!match || !match.type) return { status: 'unknown' }

  return { status: 'resolved', type: match.type }
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

/** Concrete `{definition, value}` to type a brand-new variable created from a box's expected type. */
export function newVariableTypeForExpected(expectedType: string | undefined): {
  definition: PLCVariable['type']['definition']
  value: string
} {
  if (!expectedType) return { definition: 'base-type', value: 'dint' }
  const restriction = getVariableRestrictionType(expectedType)
  const value = restriction.values
    ? Array.isArray(restriction.values)
      ? restriction.values[0]
      : restriction.values
    : 'dint'
  return { definition: (restriction.definition as PLCVariable['type']['definition']) ?? 'base-type', value }
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
