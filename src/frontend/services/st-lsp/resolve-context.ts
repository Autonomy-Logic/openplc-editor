// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Model-URI to LSP-context resolution for the ST language service.
 * Lives outside `index.ts` so tests reach it without dragging the
 * worker / jsonrpc import chain along — same reason as
 * `dtview-context.ts`.
 */

import { openPLCStoreBase } from '../../store'
import { getBodyLineOffset } from '../lsp-shared/body-offsets'
import type { LspContext } from '../lsp-shared/providers'
import { dtViewLineOffset, dtViewSpan, dtViewWindow } from './dtview-context'
import { DATA_TYPES_URI, parseDtViewUri, parsePouVarsUri, POU_DECLARATION_LINE_COUNT, pouUri, stubUri } from './types'

/**
 * Resolve a Monaco model URI to the LSP URI + body-line offset:
 *
 *   - `pou://<name>.st` (body editor): URI passes through; offset
 *     is whatever project-sync registered (preamble line count).
 *   - `pouvars://<name>.st` (variables text view): the LSP doesn't
 *     index this URI — remap to the live document.  For ST POUs
 *     that's `pou://`; for graphical/hybrid POUs it's `stub://`.
 *     Either way the declaration is a single line at LSP index 0,
 *     so the offset is a constant 1.
 *   - `dtview://<name>.dt` (per-type code view): remap to the
 *     aggregate datatypes document. Both frames open with a `TYPE`
 *     line, so the shift is the type's span start minus that frame.
 *   - Anything else: pass through unchanged.
 *
 * Both views render a slice of a bigger document, so they also carry a
 * `lineWindow` — without it their frame lines resolve onto the
 * neighbouring slice.
 */
export function resolveStLspContext(modelUri: string): LspContext {
  const varsPou = parsePouVarsUri(modelUri)
  if (varsPou !== null) {
    const pou = openPLCStoreBase.getState().project.data.pous.find((p) => p.name === varsPou)
    const isStLanguage = pou?.body.language === 'st'
    const lspUri = isStLanguage ? pouUri(varsPou) : stubUri(varsPou)
    // Skipped until project-sync registers the body line: an
    // unpopulated registry reads as 0 and would window the view to nothing.
    const bodyLine = getBodyLineOffset(lspUri)
    const varsWindow =
      bodyLine > POU_DECLARATION_LINE_COUNT
        ? { startLine: POU_DECLARATION_LINE_COUNT, endLineExclusive: bodyLine }
        : null
    return {
      lspUri,
      lineOffset: POU_DECLARATION_LINE_COUNT,
      ...(varsWindow ? { lineWindow: varsWindow } : {}),
    }
  }
  const dtName = parseDtViewUri(modelUri)
  if (dtName !== null) {
    const span = dtViewSpan(openPLCStoreBase.getState().project.data.dataTypes, dtName)
    // A name absent from the document (unparseable `.dt` file) has no
    // span to shift by. Pass the view's own URI through: the worker
    // never indexed it, so every provider answers nothing rather than
    // answering for whichever type happens to be first.
    if (!span) return { lspUri: modelUri, lineOffset: 0 }
    return { lspUri: DATA_TYPES_URI, lineOffset: dtViewLineOffset(span), lineWindow: dtViewWindow(span) }
  }
  return { lspUri: modelUri, lineOffset: getBodyLineOffset(modelUri) }
}
