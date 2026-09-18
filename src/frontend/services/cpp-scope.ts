// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Member resolution for the C++ editor, backed by the STruC++ LSP.
 *
 * C++ is the only body language with no language service of its own: ST talks
 * to strucpp's LSP directly and Python to Pyright (through a generated
 * preamble), but a C++ block's completion is hand-assembled in the Monaco
 * provider. Until now that meant a flat list of the POU's own variable names —
 * typing `motor.` re-offered the same top-level names, because
 * `getWordUntilPosition` stops at the `.` and nothing downstream knew what a
 * `Motor` was.
 *
 * It does not need to. Every POU — C++ ones included — is already published to
 * the LSP as a signature stub (`st-lsp/project-sync`), alongside the project's
 * data types, so strucpp can already answer "what lives under `m.Gear.` in the
 * scope of POU X" for a C++ block. That is exactly the question
 * {@link ScopedQueryApi.completeInScope} takes, and exactly what the graphical
 * editors ask through `graphical-scope`. This module is the second consumer of
 * the same API rather than a second implementation of the same idea: no type
 * walker, no `dataTypes` traversal, no notion here of what a STRUCT is.
 *
 * What is C++-specific — and all this module really adds — is the *spelling*.
 * strucpp answers in IEC terms (`speed`, typed `INT`); the C++ the block
 * compiles against declares `SPEED`, and sometimes `GEAR_`. That translation
 * is {@link cppMemberSpelling}, which defers to strucpp's own rule.
 */

import type { PLCDataType, PLCPou } from '../../middleware/shared/ports/types'
import type { LibraryState } from '../store/slices/library'
import { cppMemberSpelling } from '../utils/cpp/member-spelling'
// Imported from the module itself rather than the `st-lsp` barrel: the barrel
// also pulls in the LSP client, and with it `vscode-languageserver-protocol`,
// which nothing here needs and which a plain unit test cannot load.
import { getScopedQueryApi, isValueCompletionKind, type ScopedQueryApi } from './st-lsp/scoped-query'

/** One member candidate, already spelled the way the C++ body must write it. */
export interface CppScopeCompletion {
  /** The C++ member name — what is inserted, e.g. `SPEED`, `GEAR_`. */
  label: string
  /** The IEC name as authored, shown alongside so the two are never confused. */
  iecName: string
  /** Resolved IEC type, when strucpp provided one. */
  type?: string
}

/**
 * Every type name the project defines: data types, its own function blocks,
 * and the function blocks any enabled library ships.
 *
 * This is the input to the collision half of strucpp's member-mangling rule —
 * a member is only at risk of the trailing underscore when its declared type
 * is one of these. Built per query from the same store slices the rest of the
 * editor reads, so a type added in the variables table is visible to the next
 * keystroke without any cache to invalidate.
 */
export function projectTypeNamePredicate(
  pous: readonly PLCPou[],
  dataTypes: readonly PLCDataType[],
  libraries: LibraryState['libraries'],
): (typeName: string) => boolean {
  const names = new Set<string>()
  for (const dataType of dataTypes) {
    if (typeof dataType.name === 'string') names.add(dataType.name.toUpperCase())
  }
  for (const pou of pous) {
    if (pou.pouType === 'function-block') names.add(pou.name.toUpperCase())
  }
  for (const library of libraries.system) {
    for (const pou of library.pous ?? []) {
      if (pou?.type === 'function-block' && typeof pou.name === 'string') names.add(pou.name.toUpperCase())
    }
  }
  return (typeName: string) => names.has(typeName.toUpperCase())
}

/**
 * Translate a chain the user typed in C++ back into the IEC names the LSP
 * knows, one segment at a time.
 *
 * This is what makes the second level work. Having accepted `GEAR_` from this
 * very module, the user types `.` — and `m.GEAR_.` means nothing to strucpp,
 * whose member is `Gear`. The upper-casing alone would survive (IEC names are
 * matched case-insensitively, so `m.GEAR.` resolves), but the mangling
 * underscore does not, and a completion that leads its user into a dead end on
 * the next keystroke is worse than none.
 *
 * The inverse of the mangling rule cannot be computed — stripping a trailing
 * `_` would corrupt a member genuinely named that way — so each segment is
 * resolved instead: ask what lives under the chain so far, and find the
 * candidate whose *C++ spelling* is what the user typed. One round trip per
 * level, and chains are short.
 *
 * The root segment is passed through untouched. It names a variable rather
 * than a member, so it is never mangled, and the `#define` a C++ block reaches
 * it through carries the casing the user authored.
 *
 * @returns the IEC anchor, or `null` when a segment doesn't resolve — a typo,
 *   or a chain through something with no members.
 */
/**
 * Split a chain segment into the member name and any array subscript.
 *
 * `items[0]` is one segment but two things: the member is `items`, and `[0]`
 * selects an element of it. Only the name half has a C++ spelling to match
 * against; the subscript is carried through to the LSP untouched, since
 * strucpp is what decides whether an element is addressable.
 */
function splitSubscript(segment: string): { name: string; subscript: string } {
  const bracket = segment.indexOf('[')
  if (bracket < 0) return { name: segment, subscript: '' }
  return { name: segment.slice(0, bracket), subscript: segment.slice(bracket) }
}

async function toIecAnchor(
  api: ScopedQueryApi,
  pouName: string,
  cppAnchor: string,
  isUserDefinedType: (typeName: string) => boolean,
): Promise<string | null> {
  const segments = cppAnchor.slice(0, -1).split('.')
  let iecAnchor = `${segments[0] ?? ''}.`

  for (const segment of segments.slice(1)) {
    const { name, subscript } = splitSubscript(segment)
    const candidates = await api.completeInScope(pouName, iecAnchor)
    const match = candidates
      .filter((item) => isValueCompletionKind(item.kind))
      .find((item) => cppMemberSpelling(item.label, item.type, { isUserDefinedType }) === name)
    if (!match) return null
    iecAnchor += `${match.label}${subscript}.`
  }

  return iecAnchor
}

/**
 * The members reachable under `cppAnchor` in `pouName`'s scope, spelled for C++.
 *
 * `cppAnchor` is the expression up to and including the trailing `.` — `m.`,
 * `m.GEAR_.`, `ctl.` — exactly as it appears in the C++ body, so it is
 * translated to IEC names before the LSP sees it (see {@link toIecAnchor}).
 * Filtering by whatever the user has typed after it is left to Monaco, which
 * already does it against the completion range and does it case-insensitively
 * (so a lower-case `s` still matches `SPEED`).
 *
 * Returns [] when the LSP is unavailable — during boot, in tests, or after a
 * worker crash — so the caller falls back to its flat list rather than
 * offering nothing.
 */
export async function getCppMemberCompletions(
  pouName: string,
  cppAnchor: string,
  isUserDefinedType: (typeName: string) => boolean,
): Promise<CppScopeCompletion[]> {
  const api = getScopedQueryApi()
  if (!api || cppAnchor === '') return []

  const iecAnchor = await toIecAnchor(api, pouName, cppAnchor, isUserDefinedType)
  if (iecAnchor === null) return []

  const items = await api.completeInScope(pouName, iecAnchor)
  return items
    .filter((item) => isValueCompletionKind(item.kind))
    .map((item) => ({
      label: cppMemberSpelling(item.label, item.type, { isUserDefinedType }),
      iecName: item.label,
      ...(item.type ? { type: item.type } : {}),
    }))
}
