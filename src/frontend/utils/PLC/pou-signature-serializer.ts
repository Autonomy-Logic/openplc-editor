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
  const declaration = buildDeclarationLine(pou)
  const variables = generateIecVariablesToString(pou.interface?.variables ?? [])
  const body =
    pou.body.language === 'st'
      ? (pou.body.value as string)
      : OPAQUE_BODY_PLACEHOLDER
  const endKeyword = getEndKeyword(pou.pouType)
  return `${declaration}\n${variables}\n${body}\n${endKeyword}`
}

export { OPAQUE_BODY_PLACEHOLDER }
