// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Internal helpers shared by every LSP service's provider
 * registrations.  Pure functions, no Monaco UI side-effects.
 */

import type * as monaco from 'monaco-editor'
import type {
  DocumentSymbol as LspDocumentSymbol,
  Location as LspLocation,
  LocationLink as LspLocationLink,
  SymbolInformation as LspSymbolInformation,
} from 'vscode-languageserver-protocol'

import { lspRangeToMonaco, lspSymbolKindToMonaco } from '../converters'

/**
 * Build a Monaco `Location` whose target is *just off* the source
 * cursor.  Used by a provider that needs to claim "definition found"
 * (so Monaco doesn't render an inline "No definition found" badge
 * or open References as a fallback) while a higher-level redirect
 * actually handles the navigation out-of-band.
 *
 * Two Monaco pitfalls this avoids:
 *
 *   1. Returning `null` / `[]` → Monaco renders an inline "No
 *      definition found for 'X'" badge on top of the successful
 *      redirect.
 *   2. Returning a Location whose range CONTAINS the cursor position
 *      → Monaco's `revealDefinition` takes its "already-at-target"
 *      branch and opens the References peek widget inline instead
 *      of navigating.
 *
 * A zero-width range one column off the cursor satisfies the
 * "definition found" check but fails `containsPosition`, so Monaco
 * falls through to the silent navigation branch.  The cursor shifts
 * by one character, which is imperceptible at typical font sizes.
 */
export function suppressNoDefinitionFound(
  model: monaco.editor.ITextModel,
  position: monaco.IPosition,
  monacoApi: typeof monaco,
): monaco.languages.Location[] {
  const offsetCol = position.column > 1 ? position.column - 1 : position.column + 1
  return [
    {
      uri: model.uri,
      range: new monacoApi.Range(position.lineNumber, offsetCol, position.lineNumber, offsetCol),
    },
  ]
}

/**
 * Normalise the polymorphic `DefinitionRequest` response shape.  LSP
 * permits any of `Location`, `Location[]`, or `LocationLink[]`; the
 * caller is easier to read when it sees a uniform `Location[]`.
 */
export function normaliseLocationResponse(
  result: LspLocation | LspLocation[] | LspLocationLink[] | null,
): LspLocation | LspLocation[] | null {
  if (!result) return null
  if (Array.isArray(result) && result.length > 0 && 'targetUri' in result[0]) {
    return (result as LspLocationLink[]).map((link) => ({
      uri: link.targetUri,
      range: link.targetSelectionRange ?? link.targetRange,
    }))
  }
  return result as LspLocation | LspLocation[]
}

/**
 * Translate an LSP `DocumentSymbol` (nested) into Monaco's
 * `DocumentSymbol` shape.  Body offset shifts every range to
 * Monaco's body-only view.
 */
export function lspDocumentSymbolToMonaco(sym: LspDocumentSymbol, lineOffset = 0): monaco.languages.DocumentSymbol {
  return {
    name: sym.name,
    detail: sym.detail ?? '',
    kind: lspSymbolKindToMonaco(sym.kind),
    range: lspRangeToMonaco(sym.range, lineOffset),
    selectionRange: lspRangeToMonaco(sym.selectionRange, lineOffset),
    tags: [],
    children: (sym.children ?? []).map((c) => lspDocumentSymbolToMonaco(c, lineOffset)),
  }
}

/**
 * Translate a flat `SymbolInformation` into Monaco's `DocumentSymbol`
 * shape.  Monaco's outline view wants `DocumentSymbol[]` — flat
 * lists from older servers get rewrapped this way.
 */
export function symbolInformationToDocumentSymbol(
  sym: LspSymbolInformation,
  lineOffset = 0,
): monaco.languages.DocumentSymbol {
  return {
    name: sym.name,
    detail: sym.containerName ?? '',
    kind: lspSymbolKindToMonaco(sym.kind),
    range: lspRangeToMonaco(sym.location.range, lineOffset),
    selectionRange: lspRangeToMonaco(sym.location.range, lineOffset),
    tags: [],
    children: [],
  }
}
