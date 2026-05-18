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
  PrepareRenameRequest,
  type Range as LspRange,
  ReferencesRequest,
  RenameRequest,
  type SemanticTokens,
  SemanticTokensRequest,
  SignatureHelpRequest,
  type SymbolInformation,
  type TextEdit as LspTextEdit,
  type WorkspaceEdit,
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
import { redirectToGraphicalPou } from './graphical-redirect'

interface ProviderOptions {
  connection: MessageConnection
  monacoApi: typeof monaco
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
        const offset = getBodyLineOffset(model.uri.toString())
        const result = await connection.sendRequest(HoverRequest.type, {
          textDocument: { uri: model.uri.toString() },
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
        const offset = getBodyLineOffset(model.uri.toString())
        const result = await connection.sendRequest(DefinitionRequest.type, {
          textDocument: { uri: model.uri.toString() },
          position: monacoPositionToLsp(position, offset),
        })
        // DefinitionRequest may resolve to Location, Location[], or
        // LocationLink[].  Normalise to LocationLink[] first so the
        // converter sees a uniform shape.  `lspLocationsToMonaco` looks
        // up each location's URI in the offsets registry so the target
        // POU's preamble is subtracted even when it differs from the
        // source POU's.
        const normalised = normaliseLocationResponse(result)
        if (!normalised) return null

        // If any returned location is a stub:// URI (graphical POU
        // signature), reroute the user to the graphical editor for
        // that POU and cancel the default Monaco navigation —
        // Monaco has no model for the synthetic stub source, so
        // navigating to it would dead-end.
        const locations = Array.isArray(normalised) ? normalised : [normalised]
        const stubLocation = locations.find((l) => redirectToGraphicalPou(l.uri))
        if (stubLocation) return null

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
        const offset = getBodyLineOffset(model.uri.toString())
        const result = await connection.sendRequest(ReferencesRequest.type, {
          textDocument: { uri: model.uri.toString() },
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
  // Rename
  // -------------------------------------------------------------------------

  disposables.push(
    monacoApi.languages.registerRenameProvider('st', {
      async resolveRenameLocation(model, position) {
        const offset = getBodyLineOffset(model.uri.toString())
        const result = await connection.sendRequest(PrepareRenameRequest.type, {
          textDocument: { uri: model.uri.toString() },
          position: monacoPositionToLsp(position, offset),
        })
        if (!result) {
          return {
            range: zeroRange(model, position),
            text: '',
            rejectReason: 'No symbol at cursor',
          }
        }
        // PrepareRename can return either a Range or `{range, placeholder}`.
        if ('range' in result) {
          return {
            range: lspRangeToMonaco(result.range, offset),
            text: result.placeholder,
          }
        }
        return { range: lspRangeToMonaco(result as LspRange, offset), text: '' }
      },
      async provideRenameEdits(model, position, newName) {
        const offset = getBodyLineOffset(model.uri.toString())
        const result = await connection.sendRequest(RenameRequest.type, {
          textDocument: { uri: model.uri.toString() },
          position: monacoPositionToLsp(position, offset),
          newName,
        })
        return workspaceEditToMonaco(result, monacoApi)
      },
    }),
  )

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
        return result.map((te) => lspTextEditToMonaco(te, offset))
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

function zeroRange(
  model: monaco.editor.ITextModel,
  position: monaco.IPosition,
): monaco.IRange {
  return {
    startLineNumber: position.lineNumber,
    startColumn: position.column,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
    // Touch model so TS knows it's used (no-op).
    ...(model ? {} : {}),
  }
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

function workspaceEditToMonaco(
  edit: WorkspaceEdit | null,
  monacoApi: typeof monaco,
): monaco.languages.WorkspaceEdit {
  const empty: monaco.languages.WorkspaceEdit = { edits: [] }
  if (!edit) return empty
  const edits: monaco.languages.WorkspaceEdit['edits'] = []
  if (edit.changes) {
    for (const [uri, textEdits] of Object.entries(edit.changes)) {
      const offset = getBodyLineOffset(uri)
      for (const te of textEdits) {
        edits.push({
          resource: monacoApi.Uri.parse(uri),
          versionId: undefined,
          textEdit: lspTextEditToMonaco(te, offset),
        })
      }
    }
  }
  if (edit.documentChanges) {
    for (const change of edit.documentChanges) {
      if (!('textDocument' in change)) continue // skip create/rename/delete file ops
      const offset = getBodyLineOffset(change.textDocument.uri)
      for (const te of change.edits) {
        edits.push({
          resource: monacoApi.Uri.parse(change.textDocument.uri),
          versionId: change.textDocument.version ?? undefined,
          textEdit: lspTextEditToMonaco(te as LspTextEdit, offset),
        })
      }
    }
  }
  return { edits }
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
