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

import type { PLCPou } from '../../../middleware/shared/ports/types'
import { generateIecVariablesToString } from '../generate-iec-variables-to-string'
import { getEndKeyword, getStartKeyword } from './pou-file-extensions'

const OPAQUE_BODY_PLACEHOLDER = '; (* graphical body — opaque to LSP *)'

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
export function serializePouSignatureToST(pou: PLCPou): string {
  return serializePouSignatureToSTWithBodyOffset(pou).text
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
 * the literal prefix the template prepends before `${body}`.
 */
export function serializePouSignatureToSTWithBodyOffset(pou: PLCPou): {
  text: string
  bodyLineOffset: number
} {
  const declaration = buildDeclarationLine(pou)
  const variables = generateIecVariablesToString(pou.interface?.variables ?? [])
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
 */
const SCOPE_QUERY_POU_NAME = '__openplc_scope_query__'

export function serializePouScopeForQuery(
  pou: PLCPou,
  bodyExpr: string,
  uniqueId?: number | string,
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
  const variables = generateIecVariablesToString(pou.interface?.variables ?? [])
  const prefix = `${declaration}\n${variables}\n`
  // `prefix` ends with '\n', so split length - 1 is the 0-indexed line
  // the body expression sits on.
  const bodyLine = prefix.split('\n').length - 1
  const text = `${prefix}${bodyExpr}\n${endKeyword}`
  return { text, position: { line: bodyLine, character: bodyExpr.length } }
}

export { OPAQUE_BODY_PLACEHOLDER, SCOPE_QUERY_POU_NAME }
