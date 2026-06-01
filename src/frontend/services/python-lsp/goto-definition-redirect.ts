// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Go-to-definition redirect for the Python LSP.
 *
 * The user-facing variables panel renders IEC VAR-block syntax —
 * the same `VAR_INPUT…END_VAR` text every other POU language shows.
 * Pyright, meanwhile, only ever sees a synthetic Python preamble
 * (one Python annotation per `input`/`output` variable, prefixed
 * by a header comment) — that preamble never reaches the user's
 * Monaco model, but it's where Pyright reports declarations.
 *
 * So a Pyright Go-to-Definition target at "preamble line N" needs
 * a two-step translation to land where the user actually edits
 * variables:
 *
 *   1. preamble line N → variable name
 *      (`variableNameByPreambleLine` from
 *      `generatePythonLspPreamble`)
 *   2. variable name → IEC line / column
 *      (`getIecVariableLineMap` from
 *      `generate-iec-variables-to-string`)
 *
 * Both maps are computed once per `attachPou` and cached on the
 * service's per-URI entry; this redirect just looks the values up
 * and hands them to `routeToPouPreamble`.
 *
 * Body targets stay simple — Pyright line minus the body offset,
 * 0→1-indexed shift, then `routeToPouBody`.
 *
 * Cross-file navigation isn't supported yet — Python POUs are
 * single-document affairs.  If Pyright ever returns a target with
 * a different URI (typeshed stubs, external imports), we hand off
 * to the caller via `return false`, and the URI-reachability filter
 * in the interceptor suppresses the navigation cleanly.
 */

import type { Location, LocationLink } from 'vscode-languageserver-protocol'

import { getBodyLineOffset } from '../lsp-shared/body-offsets'
import { normaliseLocation, routeToPouBody, routeToPouPreamble } from '../lsp-shared/definition-redirect'

export interface PythonRedirectContext {
  /** The Monaco model URI the user clicked Go to Definition from. */
  sourceUri: string
  /** The POU whose body that URI belongs to. */
  sourcePouName: string
  /** Preamble-line (0-indexed in the Python preamble) → variable name. */
  variableNameByPreambleLine: Map<number, string>
  /** Variable name → 1-indexed Monaco line / column in the IEC VAR-block text. */
  iecVariableLineMap: Map<string, { line: number; column: number }>
}

/**
 * Try to route an LSP Definition target through the Zustand store.
 * Returns true iff navigation was handled here — caller suppresses
 * Monaco's default in that case.  Returns false when the URI is
 * something other than the source (typeshed stubs, external
 * imports, future cross-POU support) or when a preamble target
 * couldn't be translated to an IEC variable (defensive — covers a
 * Pyright response pointing at a preamble line that has no
 * corresponding variable, e.g. a header comment line) so the
 * caller can fall back to the URI-reachability filter.
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
    // Preamble target.  Translate Pyright's preamble line → variable
    // name → IEC variables-code-editor line.  Skip the
    // `target.characterLsp` value entirely — Pyright reports
    // columns in the Python preamble's coordinate space, which
    // doesn't match the IEC VAR-block layout.  Land on the start
    // of the variable name in the IEC text instead.
    const variableName = ctx.variableNameByPreambleLine.get(target.lineLsp)
    if (!variableName) return false
    const iecPosition = ctx.iecVariableLineMap.get(variableName)
    if (!iecPosition) return false
    return routeToPouPreamble(ctx.sourcePouName, iecPosition.line, iecPosition.column)
  }

  // Body target — subtract the body offset to bring the LSP line
  // back into the body-only frame Monaco renders.
  return routeToPouBody(ctx.sourcePouName, target.lineLsp - bodyOffset + 1, target.characterLsp + 1)
}
