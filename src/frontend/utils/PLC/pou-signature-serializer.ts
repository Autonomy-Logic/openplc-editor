// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Serialise a POU to its ST signature stub.
 *
 * The STruC++ language server consumes Structured Text.  For ST and
 * IL POUs that's straightforward — the body is already textual.  For
 * graphical POUs (LD / FBD / SFC) and hybrid POUs (Python / C++)
 * the body has no ST representation, but cross-POU symbol
 * resolution still needs the POU's *signature* (declaration line +
 * VAR blocks) so an ST program calling a Ladder FB can complete
 * the FB's I/O variables, see the return type, etc.
 *
 * This serializer produces the smallest ST chunk that surfaces the
 * signature: declaration, every VAR block, an opaque body placeholder,
 * and the end keyword.  It composes the same atoms
 * `pou-text-serializer` uses for save (`buildDeclaration` style +
 * `generateIecVariablesToString` + `getEndKeyword`) so there's a
 * single source of truth for how VAR blocks render to text.
 *
 *   FUNCTION_BLOCK Foo
 *     VAR_INPUT
 *       in1 : BOOL;
 *     END_VAR
 *     VAR_OUTPUT
 *       out1 : INT;
 *     END_VAR
 *     ; (* graphical body — opaque to LSP *)
 *   END_FUNCTION_BLOCK
 *
 * The semicolon-then-comment placeholder is a syntactically valid
 * empty ST statement that the strucpp parser accepts.  It's the
 * smallest non-empty body that doesn't introduce phantom diagnostics
 * the user can't act on.
 */

import type { PLCPou, PLCVariable } from '../../../middleware/shared/ports/types'
import { resolveLocation } from '../../../middleware/shared/utils/iec-address/registry'
import { generateIecVariablesToString } from '../generate-iec-variables-to-string'
import { getEndKeyword, getStartKeyword } from './pou-file-extensions'

const OPAQUE_BODY_PLACEHOLDER = '; (* graphical body — opaque to LSP *)'

/** Default for callers that have no alias index (tests, boot before the
 *  registry exists).  `resolveLocation` maps every non-literal location to
 *  '' against it, so the emitted ST is always parseable. */
const EMPTY_ALIAS_INDEX: ReadonlyMap<string, string> = new Map()

/**
 * Resolve every variable's `location` from the stored single-field form
 * (alias name OR literal `%addr`) to the literal address strucpp can parse.
 *
 * The LSP is a consumer that must never see aliases, exactly like the
 * compiler — `AT label2` is not valid IEC ST, and strucpp abandons the whole
 * VAR block on it, so every symbol after the first alias-bound variable
 * disappears from the POU's scope (no autocomplete, red graphical boxes).
 * The mapping mirrors `getCompileReadyProjectData()`: a literal passes
 * through verbatim, a live alias becomes its address, an orphaned alias
 * becomes '' (the `AT` clause is dropped).
 *
 * Only the LSP projection is resolved.  The store keeps the alias-name form
 * so the variables table / text view and the saved file all still show
 * `label2`, not `%IW0`.
 *
 * Line-count invariant: this only ever rewrites text *within* a declaration
 * line, so `bodyLineOffset` and the `pouvars://` diagnostics mirror stay
 * correct.
 */
function withResolvedLocations(variables: PLCVariable[], aliasIndex: ReadonlyMap<string, string>): PLCVariable[] {
  return variables.map((variable) =>
    variable.location ? { ...variable, location: resolveLocation(variable.location, aliasIndex) } : variable,
  )
}

function buildDeclarationLine(pou: PLCPou): string {
  const startKeyword = getStartKeyword(pou.pouType)
  if (pou.pouType === 'function' && pou.interface?.returnType) {
    return `${startKeyword} ${pou.name} : ${pou.interface.returnType}`
  }
  return `${startKeyword} ${pou.name}`
}

/**
 * Serialise a POU to an ST signature stub.  Always emits the
 * declaration + every VAR block, regardless of body language.
 *
 *   - ST POUs include their real body verbatim — the LSP sees the
 *     same source the user is editing.
 *
 *   - Every other body language (IL, LD, FBD, SFC, Python, C++)
 *     gets the opaque placeholder.  The LSP needs cross-POU
 *     signatures, not bodies: IL bodies aren't valid ST and would
 *     produce phantom diagnostics; graphical and hybrid bodies have
 *     no textual ST representation at all.  Each of those POU
 *     editors keeps its own native autocomplete / tooling.
 */
export function serializePouSignatureToST(
  pou: PLCPou,
  aliasIndex: ReadonlyMap<string, string> = EMPTY_ALIAS_INDEX,
): string {
  return serializePouSignatureToSTWithBodyOffset(pou, aliasIndex).text
}

/**
 * Same as `serializePouSignatureToST` but also returns the 0-indexed
 * line number where the body starts inside the serialized text.
 *
 * Why: Monaco's ST editor only displays the body (variables go in a
 * separate table), but strucpp parses the whole serialized stub —
 * declaration + VAR blocks + body — to resolve cross-symbol
 * references.  Every position strucpp emits (diagnostics, semantic
 * tokens, definition links) is therefore offset by the preamble's
 * line count.  Providers and the diagnostics bridge subtract this
 * offset to map LSP coordinates back to Monaco's body-only view.
 *
 * Computed as the line count of `${declaration}\n${variables}\n` —
 * the literal prefix the template prepends before `${body}`.  The
 * template guarantees a real offset is always >= 2; `st-lsp`'s
 * `resolveStLspContext` relies on that to tell a synced POU apart from
 * `getBodyLineOffset`'s unknown-URI fallback of 0.
 *
 * `aliasIndex` maps a producer alias to its current IEC address; every
 * variable's `location` is resolved through it so the stub carries literal
 * `%…` addresses only.  See {@link withResolvedLocations}.
 */
export function serializePouSignatureToSTWithBodyOffset(
  pou: PLCPou,
  aliasIndex: ReadonlyMap<string, string> = EMPTY_ALIAS_INDEX,
): {
  text: string
  bodyLineOffset: number
} {
  const declaration = buildDeclarationLine(pou)
  const variables = generateIecVariablesToString(withResolvedLocations(pou.interface?.variables ?? [], aliasIndex))
  const body = pou.body.language === 'st' ? (pou.body.value as string) : OPAQUE_BODY_PLACEHOLDER
  const endKeyword = getEndKeyword(pou.pouType)
  const prefix = `${declaration}\n${variables}\n`
  // `prefix` ends with '\n', so its split count = lines-before-body + 1
  // for the empty terminating slice; the (-1) gives the 0-indexed body
  // start line.
  const bodyLineOffset = prefix.split('\n').length - 1
  return {
    text: `${prefix}${body}\n${endKeyword}`,
    bodyLineOffset,
  }
}

/**
 * Synthesize a self-contained ST document that places `bodyExpr` in the
 * scope of `pou`'s declarations, for driving strucpp completion / type
 * resolution programmatically from the graphical (LD/FBD) editors.
 *
 * The POU is always emitted as a `PROGRAM` under a throwaway name —
 * the POU kind and return type are irrelevant to in-scope variable /
 * member resolution, and a throwaway name avoids colliding with the
 * POU's real stub document (`stub://<name>.st`) which is open at the
 * same time. All the POU's VAR blocks are inlined verbatim so instance
 * members (`TON0.Q`), struct/enum members and array elements resolve
 * exactly as they would inside a real ST POU. `bodyExpr` is the partial
 * expression the user is typing (e.g. `TON0.` or `my_struct.value.`);
 * the returned `position` is the 0-indexed LSP cursor at its end.
 *
 * `bodyExpr` MUST be a single line (no newlines) — the position math
 * assumes the expression occupies one body line.
 *
 * `aliasIndex` resolves alias-bound locations to literal `%…` addresses, as
 * in {@link serializePouSignatureToSTWithBodyOffset} — without it a single
 * alias-bound variable breaks the VAR block and the query returns no
 * candidates at all.
 */
const SCOPE_QUERY_POU_NAME = '__openplc_scope_query__'

export function serializePouScopeForQuery(
  pou: PLCPou,
  bodyExpr: string,
  uniqueId?: number | string,
  aliasIndex: ReadonlyMap<string, string> = EMPTY_ALIAS_INDEX,
): { text: string; position: { line: number; character: number } } {
  // Emit with the POU's REAL kind + return type so the VAR sections stay
  // legal (e.g. VAR_IN_OUT is only valid in FUNCTION_BLOCK/FUNCTION — a
  // PROGRAM wrapper makes strucpp choke). The name is swapped to a
  // throwaway so it can't collide with the POU's real stub document; a
  // per-query `uniqueId` further guarantees no two in-flight query docs
  // ever declare the same symbol (a duplicate definition stalls the
  // worker if an open laps the previous doc's close).
  const name = uniqueId === undefined ? SCOPE_QUERY_POU_NAME : `${SCOPE_QUERY_POU_NAME}${uniqueId}__`
  const startKeyword = getStartKeyword(pou.pouType)
  const endKeyword = getEndKeyword(pou.pouType)
  const declaration =
    pou.pouType === 'function' && pou.interface?.returnType
      ? `${startKeyword} ${name} : ${pou.interface.returnType}`
      : `${startKeyword} ${name}`
  // External variables (`VAR_EXTERNAL`) reference resource globals declared in a
  // separate CONFIGURATION document. This throwaway query doc isn't part of that
  // configuration, so strucpp can't resolve a bare `VAR_EXTERNAL` here — the
  // global and its struct/array members would come back unknown (the box shows
  // yellow, no autocomplete). Re-emit externals as plain `VAR`: they carry their
  // real type inline, so the symbol and its members resolve self-containedly.
  // Scope-query-only — the POU's real stub keeps `VAR_EXTERNAL`.
  const scopeVariables = withResolvedLocations(pou.interface?.variables ?? [], aliasIndex).map((variable) =>
    variable.class === 'external' ? { ...variable, class: 'local' as const } : variable,
  )
  const variables = generateIecVariablesToString(scopeVariables)
  const prefix = `${declaration}\n${variables}\n`
  // `prefix` ends with '\n', so split length - 1 is the 0-indexed line
  // the body expression sits on.
  const bodyLine = prefix.split('\n').length - 1
  const text = `${prefix}${bodyExpr}\n${endKeyword}`
  return { text, position: { line: bodyLine, character: bodyExpr.length } }
}

/**
 * Synthesize a self-contained ST document placing a MULTI-LINE body in
 * `pou`'s scope, for diagnostics on an Execute ("ST Block") snippet.
 *
 * Thin wrapper over {@link serializePouScopeForQuery} — the shell it
 * builds (real POU kind so `VAR_IN_OUT` stays legal, throwaway name so
 * it can't collide with the POU's own `stub://` document, externals
 * re-emitted as locals so they resolve without the CONFIGURATION, alias
 * locations resolved to literal addresses) is exactly what a snippet
 * needs too. The only difference is what the caller wants back: a
 * completion query needs a cursor position, this needs the preamble's
 * line count so `setBodyLineOffset` can shift the worker's diagnostics
 * back onto the lines the user can actually see.
 *
 * `serializePouScopeForQuery` documents `bodyExpr` as single-line, and
 * that constraint is real — but it applies only to the `character` half
 * of the position it returns. `text` and the line count are correct for
 * any body, which is why this wrapper takes the line and drops the rest
 * rather than reimplementing the shell.
 */
export function serializePouScopeForBody(
  pou: PLCPou,
  body: string,
  uniqueId?: number | string,
  aliasIndex: ReadonlyMap<string, string> = EMPTY_ALIAS_INDEX,
): { text: string; bodyLineOffset: number } {
  const { text, position } = serializePouScopeForQuery(pou, body, uniqueId, aliasIndex)
  return { text, bodyLineOffset: position.line }
}

export { OPAQUE_BODY_PLACEHOLDER, SCOPE_QUERY_POU_NAME }
