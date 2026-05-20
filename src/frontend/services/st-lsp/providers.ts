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
import { parsePouVarsUri, POU_DECLARATION_LINE_COUNT, pouUri } from './types'

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
 *     to the live `pou://` document and use the declaration's
 *     single-line offset so Monaco line 1 (= first VAR block line)
 *     maps to LSP line 1 (= first VAR line in the synthesized doc).
 *   - Anything else: pass through unchanged.
 */
function effectiveLspContext(modelUri: string): { lspUri: string; lineOffset: number } {
  const varsPou = parsePouVarsUri(modelUri)
  if (varsPou !== null) {
    return { lspUri: pouUri(varsPou), lineOffset: POU_DECLARATION_LINE_COUNT }
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
        if (stubLocation) return null

        // Route variable-declaration and cross-POU targets through
        // the Zustand store: open the target POU's tab and either
        // switch the variables panel to text mode (for preamble
        // targets) or place the body cursor.  When the redirect
        // claims a location, return null so Monaco doesn't try to
        // navigate on top of it.
        const primary = locations[0]
        if (primary && redirectDefinitionToStore(primary)) {
          return null
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
      const uri = model.uri.toString()
      const offset = getBodyLineOffset(uri)
      const result: SemanticTokens | null = await connection.sendRequest(
        SemanticTokensRequest.type,
        { textDocument: { uri } },
      )
      if (!result) return null
      return {
        ...(result.resultId ? { resultId: result.resultId } : {}),
        data: shiftSemanticTokensToBody(result.data, offset),
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
 * full-document coordinates) into Monaco's body-only frame.
 *
 *   1. Decode deltas to absolute (line, col) positions.
 *   2. Drop tokens that fall inside the preamble (`line < offset`) —
 *      those describe the synthesized declaration and VAR blocks
 *      Monaco never displays.
 *   3. Subtract `offset` from each surviving token's line.
 *   4. Re-encode as a delta stream Monaco can consume directly.
 *
 * When `offset === 0` (non-ST doc, or registry not populated yet),
 * step 2 is a no-op and step 3 leaves lines unchanged — the function
 * still does decode/re-encode, but the output is bitwise-equivalent
 * to a `new Uint32Array(data)` copy.  Cheap enough that special-
 * casing it isn't worth the branch.
 */
function shiftSemanticTokensToBody(data: number[], offset: number): Uint32Array {
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
  // Re-encode body-only tokens with shifted line numbers.
  const out: number[] = []
  let prevLine = 0
  let prevCol = 0
  for (const t of abs) {
    if (t.line < offset) continue
    const shiftedLine = t.line - offset
    const dLine = shiftedLine - prevLine
    const dStart = dLine === 0 ? t.col - prevCol : t.col
    out.push(dLine, dStart, t.len, t.type, t.mods)
    prevLine = shiftedLine
    prevCol = t.col
  }
  return new Uint32Array(out)
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
