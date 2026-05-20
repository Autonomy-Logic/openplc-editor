// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Monaco language provider registrations backed by an LSP
 * `MessageConnection`.  Each provider forwards Monaco's query
 * params to the worker via the matching LSP request type and
 * translates the response back into Monaco's expected shape.
 *
 * Registered for language id `st` only.  IL keeps its hand-written
 * provider in `monaco/index.tsx`; ST is fully LSP-driven.
 */

import type * as monaco from 'monaco-editor'
import {
  CompletionRequest,
  DefinitionRequest,
  DocumentFormattingRequest,
  type DocumentSymbol,
  DocumentSymbolRequest,
  HoverRequest,
  type Location,
  type LocationLink,
  type MessageConnection,
  ReferencesRequest,
  type SemanticTokens,
  SemanticTokensRequest,
  SignatureHelpRequest,
  type SymbolInformation,
} from 'vscode-languageserver-protocol'

import { openPLCStoreBase } from '../../store'
import { getBodyLineOffset } from './body-offsets'
import {
  lspCompletionListToMonaco,
  lspHoverToMonaco,
  lspLocationsToMonaco,
  lspRangeToMonaco,
  lspSignatureHelpToMonaco,
  lspSymbolKindToMonaco,
  lspTextEditToMonaco,
  monacoPositionToLsp,
} from './converters'
import { redirectDefinitionToStore } from './goto-definition-redirect'
import { redirectToGraphicalPou } from './graphical-redirect'
import { parsePouVarsUri, POU_DECLARATION_LINE_COUNT, pouUri, stubUri } from './types'

interface ProviderOptions {
  connection: MessageConnection
  monacoApi: typeof monaco
}

/**
 * Resolve the URI a provider should hand to the LSP, plus the
 * line-offset translation it should apply on the way in and out.
 *
 *   - `pou://<name>.st` (body editor): the model URI IS the LSP URI
 *     and the offset is whatever project-sync registered (preamble
 *     line count).
 *   - `pouvars://<name>.st` (variables text view): the LSP doesn't
 *     index this URI — the variables-code-editor only displays VAR
 *     blocks lifted out of the synthesized doc.  Remap the request
 *     to the live LSP document.  Crucially the LSP URI depends on
 *     the POU's body language: ST POUs live under `pou://` (real
 *     body), graphical / hybrid POUs live under `stub://` (signature
 *     stub).  Without this branching the variables-text view on an
 *     FBD POU would query a `pou://` URI strucpp has no document
 *     for, producing "No definition found" on any in-vars symbol
 *     (FB type names, struct field types, etc.).  Either way the
 *     declaration is a single line at LSP index 0, so the offset is
 *     a constant 1.
 *   - Anything else: pass through unchanged.
 */
function effectiveLspContext(modelUri: string): { lspUri: string; lineOffset: number } {
  const varsPou = parsePouVarsUri(modelUri)
  if (varsPou !== null) {
    // Look the POU up by name to decide which URI scheme its LSP
    // document is registered under.  Falls back to `pou://` when the
    // POU isn't in the store yet (race during boot) — strucpp will
    // simply return empty, no worse than the old behaviour.
    const pou = openPLCStoreBase.getState().project.data.pous.find((p) => p.name === varsPou)
    const isStLanguage = pou?.body.language === 'st'
    const lspUri = isStLanguage ? pouUri(varsPou) : stubUri(varsPou)
    return { lspUri, lineOffset: POU_DECLARATION_LINE_COUNT }
  }
  return { lspUri: modelUri, lineOffset: getBodyLineOffset(modelUri) }
}

export function registerStLspProviders({
  connection,
  monacoApi,
}: ProviderOptions): monaco.IDisposable {
  const disposables: monaco.IDisposable[] = []

  // -------------------------------------------------------------------------
  // Completion
  // -------------------------------------------------------------------------

  // Every provider walks the same translation pattern: look up the
  // body-line offset for the current model's URI, add it to outbound
  // positions (so the worker sees the request in its own coordinate
  // space) and subtract it from inbound ranges (so Monaco renders
  // results against the body-only view).  When the offset is 0 (non-ST
  // doc, or registry not yet populated), translation is a no-op.

  disposables.push(
    monacoApi.languages.registerCompletionItemProvider('st', {
      triggerCharacters: ['.', ':'],
      provideCompletionItems: async (model, position) => {
        const offset = getBodyLineOffset(model.uri.toString())
        const word = model.getWordUntilPosition(position)
        const range: monaco.IRange = {
          startLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        }
        const result = await connection.sendRequest(CompletionRequest.type, {
          textDocument: { uri: model.uri.toString() },
          position: monacoPositionToLsp(position, offset),
        })
        return lspCompletionListToMonaco(result, range, monacoApi, offset)
      },
    }),
  )

  // -------------------------------------------------------------------------
  // Hover
  // -------------------------------------------------------------------------

  disposables.push(
    monacoApi.languages.registerHoverProvider('st', {
      provideHover: async (model, position) => {
        const { lspUri, lineOffset: offset } = effectiveLspContext(model.uri.toString())
        const result = await connection.sendRequest(HoverRequest.type, {
          textDocument: { uri: lspUri },
          position: monacoPositionToLsp(position, offset),
        })
        return lspHoverToMonaco(result, offset) ?? undefined
      },
    }),
  )

  // -------------------------------------------------------------------------
  // Signature help
  // -------------------------------------------------------------------------

  disposables.push(
    monacoApi.languages.registerSignatureHelpProvider('st', {
      signatureHelpTriggerCharacters: ['(', ','],
      provideSignatureHelp: async (model, position) => {
        const offset = getBodyLineOffset(model.uri.toString())
        const result = await connection.sendRequest(SignatureHelpRequest.type, {
          textDocument: { uri: model.uri.toString() },
          position: monacoPositionToLsp(position, offset),
        })
        const help = lspSignatureHelpToMonaco(result)
        if (!help) return null
        return { value: help, dispose: () => undefined }
      },
    }),
  )

  // -------------------------------------------------------------------------
  // Go to definition
  // -------------------------------------------------------------------------

  disposables.push(
    monacoApi.languages.registerDefinitionProvider('st', {
      provideDefinition: async (model, position) => {
        const { lspUri, lineOffset: offset } = effectiveLspContext(model.uri.toString())
        const result = await connection.sendRequest(DefinitionRequest.type, {
          textDocument: { uri: lspUri },
          position: monacoPositionToLsp(position, offset),
        })
        // DefinitionRequest may resolve to Location, Location[], or
        // LocationLink[].  Normalise to Location[] first so the
        // downstream handlers see a uniform shape.
        const normalised = normaliseLocationResponse(result)
        if (!normalised) return null

        const locations = Array.isArray(normalised) ? normalised : [normalised]

        // If any returned location is a stub:// URI (graphical POU
        // signature), reroute the user to the graphical editor for
        // that POU and cancel the default Monaco navigation —
        // Monaco has no model for the synthetic stub source, so
        // navigating to it would dead-end.
        const stubLocation = locations.find((l) => redirectToGraphicalPou(l.uri))
        if (stubLocation) return suppressNoDefinitionFound(model, position, monacoApi)

        // Route variable-declaration and cross-POU targets through
        // the Zustand store: open the target POU's tab and either
        // switch the variables panel to text mode (for preamble
        // targets) or place the body cursor.  When the redirect
        // claims a location, return a no-op self-reference so
        // Monaco doesn't render "No definition found for 'X'" on
        // top of our successful redirect — and so it doesn't open
        // the References peek as a fallback either (see
        // `suppressNoDefinitionFound` for both pitfalls).
        const primary = locations[0]
        if (primary && redirectDefinitionToStore(primary)) {
          return suppressNoDefinitionFound(model, position, monacoApi)
        }

        return lspLocationsToMonaco(normalised, monacoApi) ?? null
      },
    }),
  )

  // -------------------------------------------------------------------------
  // References
  // -------------------------------------------------------------------------

  disposables.push(
    monacoApi.languages.registerReferenceProvider('st', {
      provideReferences: async (model, position, context) => {
        const { lspUri, lineOffset: offset } = effectiveLspContext(model.uri.toString())
        const result = await connection.sendRequest(ReferencesRequest.type, {
          textDocument: { uri: lspUri },
          position: monacoPositionToLsp(position, offset),
          context: { includeDeclaration: context.includeDeclaration },
        })
        return (
          (lspLocationsToMonaco(
            result,
            monacoApi,
          ) as monaco.languages.Location[] | null) ?? []
        )
      },
    }),
  )

  // -------------------------------------------------------------------------
  // Document symbols (outline)
  // -------------------------------------------------------------------------

  disposables.push(
    monacoApi.languages.registerDocumentSymbolProvider('st', {
      provideDocumentSymbols: async (model) => {
        const offset = getBodyLineOffset(model.uri.toString())
        const result = await connection.sendRequest(DocumentSymbolRequest.type, {
          textDocument: { uri: model.uri.toString() },
        })
        if (!result) return []
        // The handler can return either DocumentSymbol[] (nested
        // hierarchy) or SymbolInformation[] (flat list with
        // containerName).  Monaco's outline view wants
        // DocumentSymbol[] — flat lists get rewrapped.
        if (result.length === 0) return []
        if ('range' in result[0]) {
          // DocumentSymbol[]
          return (result as DocumentSymbol[]).map((s) =>
            lspDocumentSymbolToMonaco(s, monacoApi, offset),
          )
        }
        return (result as SymbolInformation[]).map((s) =>
          symbolInformationToDocumentSymbol(s, monacoApi, offset),
        )
      },
    }),
  )

  // -------------------------------------------------------------------------
  // Rename — intentionally NOT registered.
  // -------------------------------------------------------------------------
  // Rename via LSP would emit WorkspaceEdits against every POU's full
  // serialized doc, including the synthesized variable-header lines
  // Monaco doesn't own (those live in the variables table).  Applying
  // those edits to Monaco models alone produces inconsistent state —
  // the body editor renames but the table keeps the old name, and the
  // bulk-edit also tries to write to Monaco models for inactive POUs
  // that may not be loaded, which trips StandaloneBulkEditService.
  // The editor already exposes its own search-and-replace via the
  // panel; users get rename through that.  Not registering also
  // disables "Change All Occurrences" (same provider).

  // -------------------------------------------------------------------------
  // Formatting
  // -------------------------------------------------------------------------

  disposables.push(
    monacoApi.languages.registerDocumentFormattingEditProvider('st', {
      provideDocumentFormattingEdits: async (model, options) => {
        const offset = getBodyLineOffset(model.uri.toString())
        const result = await connection.sendRequest(DocumentFormattingRequest.type, {
          textDocument: { uri: model.uri.toString() },
          options: {
            tabSize: options.tabSize,
            insertSpaces: options.insertSpaces,
          },
        })
        if (!result) return []
        // The worker formats the *full* serialized document (declaration
        // + synthesized VAR blocks + body), but Monaco's model only
        // shows the body — the variables panel owns the declarations.
        // Any edit touching the preamble (range.end.line < offset)
        // would land at negative or clamped line numbers in Monaco and
        // overwrite the first body line.  Drop those; keep body-only
        // edits and shift them into Monaco's body-relative frame.
        return result
          .filter((te) => te.range.start.line >= offset && te.range.end.line >= offset)
          .map((te) => lspTextEditToMonaco(te, offset))
      },
    }),
  )

  return {
    dispose() {
      for (const d of disposables) d.dispose()
    },
  }
}

/**
 * Register the semantic-tokens provider for ST.  Separate from the
 * other providers because Monaco's `IDocumentSemanticTokensProvider`
 * needs the legend (token-type / modifier names) synchronously from
 * `getLegend()`, but the legend is only known after the LSP
 * `initialize` handshake resolves with the server's capabilities.
 * The boot path captures the result and calls this once.
 *
 * `releaseDocumentSemanticTokens` is a no-op: strucpp's worker
 * answers `textDocument/semanticTokens/full` (no delta protocol), so
 * there's no per-result state to free.
 */
export function registerStLspSemanticTokens({
  connection,
  monacoApi,
  legend,
}: {
  connection: MessageConnection
  monacoApi: typeof monaco
  legend: monaco.languages.SemanticTokensLegend
}): monaco.IDisposable {
  return monacoApi.languages.registerDocumentSemanticTokensProvider('st', {
    getLegend() {
      return legend
    },
    async provideDocumentSemanticTokens(model): Promise<monaco.languages.SemanticTokens | null> {
      const { lspUri, lineOffset } = effectiveLspContext(model.uri.toString())
      const result: SemanticTokens | null = await connection.sendRequest(
        SemanticTokensRequest.type,
        { textDocument: { uri: lspUri } },
      )
      if (!result) return null
      // For body editors: keep tokens at LSP line >= lineOffset (skip
      // the synthesized declaration + VAR preamble) and shift down.
      // For the variables-text view: ALSO drop tokens beyond the VAR
      // blocks (i.e. tokens in the body) — the editor only renders
      // the variable section.  The end-line cutoff is the underlying
      // synthesized doc's bodyLineOffset.
      const isVarsView = parsePouVarsUri(model.uri.toString()) !== null
      const endLineExclusive = isVarsView ? getBodyLineOffset(lspUri) : Number.POSITIVE_INFINITY
      return {
        ...(result.resultId ? { resultId: result.resultId } : {}),
        data: shiftSemanticTokensToBody(result.data, lineOffset, endLineExclusive),
      }
    },
    releaseDocumentSemanticTokens() {
      /* no-op */
    },
  })
}

// ---------------------------------------------------------------------------
// Helpers private to this module
// ---------------------------------------------------------------------------

/**
 * Translate the worker's delta-encoded semantic tokens (in
 * full-document coordinates) into Monaco's view-frame.
 *
 *   1. Decode deltas to absolute (line, col) positions.
 *   2. Keep tokens whose line is in `[offset, endLineExclusive)`.
 *      Both ends are LSP coordinates.
 *   3. Subtract `offset` from each surviving token's line so the
 *      output is Monaco-relative.
 *   4. Re-encode as a delta stream Monaco can consume directly.
 *
 * Used in two modes:
 *   - **Body view**: `offset = bodyLineOffset` (preamble line count),
 *     `endLineExclusive = ∞` — drop the preamble, keep everything
 *     from the body onwards.
 *   - **Variables-text view**: `offset = 1` (declaration line count),
 *     `endLineExclusive = bodyLineOffset` of the underlying synthesized
 *     doc — keep only the VAR block region.
 *
 * When `offset === 0` and `endLineExclusive === ∞` (e.g. early boot
 * before the registry is populated) the function is a copy; cheap
 * enough that the dead branch isn't worth special-casing.
 */
function shiftSemanticTokensToBody(
  data: number[],
  offset: number,
  endLineExclusive: number = Number.POSITIVE_INFINITY,
): Uint32Array {
  // Decode to absolute positions.
  const abs: Array<{ line: number; col: number; len: number; type: number; mods: number }> = []
  let absLine = 0
  let absCol = 0
  for (let i = 0; i + 4 < data.length; i += 5) {
    const dLine = data[i]
    const dStart = data[i + 1]
    if (dLine === 0) absCol += dStart
    else {
      absLine += dLine
      absCol = dStart
    }
    abs.push({ line: absLine, col: absCol, len: data[i + 2], type: data[i + 3], mods: data[i + 4] })
  }
  // Re-encode in-range tokens with shifted line numbers.
  const out: number[] = []
  let prevLine = 0
  let prevCol = 0
  for (const t of abs) {
    if (t.line < offset) continue
    if (t.line >= endLineExclusive) continue
    const shiftedLine = t.line - offset
    const dLine = shiftedLine - prevLine
    const dStart = dLine === 0 ? t.col - prevCol : t.col
    out.push(dLine, dStart, t.len, t.type, t.mods)
    prevLine = shiftedLine
    prevCol = t.col
  }
  return new Uint32Array(out)
}

/**
 * Build a Location whose target is *just off* the source cursor, so
 * the caller's `provideDefinition` can claim "definition found"
 * without either of Monaco's two unwanted fallbacks firing.
 *
 * Two pitfalls had to be avoided here:
 *
 *   1. Returning `null` / `[]` makes Monaco render an inline
 *      "No definition found for 'X'" badge on top of our successful
 *      store redirect.
 *   2. Returning a Location whose range CONTAINS the cursor position
 *      makes Monaco's `revealDefinition` action take its
 *      "already-at-target" branch and open the References peek
 *      widget inline instead of navigating — also undesirable on
 *      top of the redirect.
 *
 * Picking a zero-width range one column off the cursor satisfies
 * Monaco's "definition found" check but fails its `containsPosition`
 * test, so it falls through to the silent navigation branch.  The
 * cursor shifts by one character, which is imperceptible at typical
 * font sizes; we accept that cost.
 */
function suppressNoDefinitionFound(
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

function normaliseLocationResponse(
  result: Location | Location[] | LocationLink[] | null,
): Location | Location[] | null {
  if (!result) return null
  if (Array.isArray(result) && result.length > 0 && 'targetUri' in result[0]) {
    // LocationLink[] → Location[]
    return (result as LocationLink[]).map((link) => ({
      uri: link.targetUri,
      range: link.targetSelectionRange ?? link.targetRange,
    }))
  }
  return result as Location | Location[]
}

function lspDocumentSymbolToMonaco(
  sym: DocumentSymbol,
  monacoApi: typeof monaco,
  lineOffset = 0,
): monaco.languages.DocumentSymbol {
  return {
    name: sym.name,
    detail: sym.detail ?? '',
    kind: lspSymbolKindToMonaco(sym.kind),
    range: lspRangeToMonaco(sym.range, lineOffset),
    selectionRange: lspRangeToMonaco(sym.selectionRange, lineOffset),
    tags: [],
    children: (sym.children ?? []).map((c) =>
      lspDocumentSymbolToMonaco(c, monacoApi, lineOffset),
    ),
  }
}

function symbolInformationToDocumentSymbol(
  sym: SymbolInformation,
  monacoApi: typeof monaco,
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
    ...(monacoApi ? {} : {}),
  }
}
