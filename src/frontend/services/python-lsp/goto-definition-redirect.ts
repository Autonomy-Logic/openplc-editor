// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Go-to-definition redirect for the Python LSP.
 *
 * The synthesised preamble Pyright sees (the IEC variables hoisted
 * into Python module scope by `synthesizeVariablesText`) is
 * byte-identical to what the variables-code-editor renders for the
 * same POU.  That makes the coordinate translation trivial — line
 * N in Pyright's preamble IS line N in the variables-code-editor.
 * No `bodyOffset - 1` correction like ST needs, because Python
 * doesn't have an extra synthesised POU-declaration line in front
 * of its variables block.
 *
 * Cross-file navigation isn't supported yet — Python POUs are
 * single-document affairs.  If Pyright ever returns a target with
 * a different URI than the source (e.g. clicking through to a
 * typeshed stub), we hand off to the caller (`return false`),
 * which falls back to the existing URI-not-reachable filter that
 * suppresses the navigation without crashing.
 */

import type { Location, LocationLink } from 'vscode-languageserver-protocol'

import { getBodyLineOffset } from '../lsp-shared/body-offsets'
import { normaliseLocation, routeToPouBody, routeToPouPreamble } from '../lsp-shared/definition-redirect'

export interface PythonRedirectContext {
  /** The Monaco model URI the user clicked Go to Definition from. */
  sourceUri: string
  /** The POU whose body that URI belongs to. */
  sourcePouName: string
}

/**
 * Try to route an LSP Definition target through the Zustand store.
 * Returns true iff navigation was handled here — caller suppresses
 * Monaco's default in that case.  Returns false when the URI is
 * something other than the source (typeshed stubs, external
 * imports, future cross-POU support) so the caller can fall back
 * to the URI-reachability filter.
 */
export function redirectPythonDefinitionToStore(loc: Location | LocationLink, ctx: PythonRedirectContext): boolean {
  const target = normaliseLocation(loc)

  // Cross-file navigation isn't supported yet — every reachable
  // Python definition target lives in the source URI.  Anything
  // else (a typeshed stub click, an external import) falls through
  // to the URI-reachability filter the python-lsp interceptor
  // composes after this redirect.
  if (target.uri !== ctx.sourceUri) return false

  const bodyOffset = getBodyLineOffset(target.uri)

  if (target.lineLsp < bodyOffset) {
    // Preamble target.  The variables-code-editor (in Python mode)
    // renders the exact text Pyright sees, so LSP line N → Monaco
    // line N+1 (0-indexed → 1-indexed) with no preamble-style
    // shift.  Column gets the same shift.
    return routeToPouPreamble(ctx.sourcePouName, target.lineLsp + 1, target.characterLsp + 1)
  }

  // Body target — subtract the body offset to bring the LSP line
  // back into the body-only frame Monaco renders.
  return routeToPouBody(ctx.sourcePouName, target.lineLsp - bodyOffset + 1, target.characterLsp + 1)
}
