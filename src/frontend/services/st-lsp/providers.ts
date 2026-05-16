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
  SignatureHelpRequest,
  type SymbolInformation,
  type TextEdit as LspTextEdit,
  type WorkspaceEdit,
} from 'vscode-languageserver-protocol'

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

  disposables.push(
    monacoApi.languages.registerCompletionItemProvider('st', {
      triggerCharacters: ['.', ':'],
      provideCompletionItems: async (model, position) => {
        const word = model.getWordUntilPosition(position)
        const range: monaco.IRange = {
          startLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        }
        const result = await connection.sendRequest(CompletionRequest.type, {
          textDocument: { uri: model.uri.toString() },
          position: monacoPositionToLsp(position),
        })
        return lspCompletionListToMonaco(result, range, monacoApi)
      },
    }),
  )

  // -------------------------------------------------------------------------
  // Hover
  // -------------------------------------------------------------------------

  disposables.push(
    monacoApi.languages.registerHoverProvider('st', {
      provideHover: async (model, position) => {
        const result = await connection.sendRequest(HoverRequest.type, {
          textDocument: { uri: model.uri.toString() },
          position: monacoPositionToLsp(position),
        })
        return lspHoverToMonaco(result) ?? undefined
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
        const result = await connection.sendRequest(SignatureHelpRequest.type, {
          textDocument: { uri: model.uri.toString() },
          position: monacoPositionToLsp(position),
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
        const result = await connection.sendRequest(DefinitionRequest.type, {
          textDocument: { uri: model.uri.toString() },
          position: monacoPositionToLsp(position),
        })
        // DefinitionRequest may resolve to Location, Location[], or
        // LocationLink[].  Normalise to LocationLink[] first so the
        // converter sees a uniform shape.
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
        const result = await connection.sendRequest(ReferencesRequest.type, {
          textDocument: { uri: model.uri.toString() },
          position: monacoPositionToLsp(position),
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
            lspDocumentSymbolToMonaco(s, monacoApi),
          )
        }
        return (result as SymbolInformation[]).map((s) =>
          symbolInformationToDocumentSymbol(s, monacoApi),
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
        const result = await connection.sendRequest(PrepareRenameRequest.type, {
          textDocument: { uri: model.uri.toString() },
          position: monacoPositionToLsp(position),
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
            range: lspRangeToMonaco(result.range),
            text: result.placeholder,
          }
        }
        return { range: lspRangeToMonaco(result as LspRange), text: '' }
      },
      async provideRenameEdits(model, position, newName) {
        const result = await connection.sendRequest(RenameRequest.type, {
          textDocument: { uri: model.uri.toString() },
          position: monacoPositionToLsp(position),
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
        const result = await connection.sendRequest(DocumentFormattingRequest.type, {
          textDocument: { uri: model.uri.toString() },
          options: {
            tabSize: options.tabSize,
            insertSpaces: options.insertSpaces,
          },
        })
        if (!result) return []
        return (result).map(lspTextEditToMonaco)
      },
    }),
  )

  return {
    dispose() {
      for (const d of disposables) d.dispose()
    },
  }
}

// ---------------------------------------------------------------------------
// Helpers private to this module
// ---------------------------------------------------------------------------

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
      for (const te of textEdits) {
        edits.push({
          resource: monacoApi.Uri.parse(uri),
          versionId: undefined,
          textEdit: lspTextEditToMonaco(te),
        })
      }
    }
  }
  if (edit.documentChanges) {
    for (const change of edit.documentChanges) {
      if (!('textDocument' in change)) continue // skip create/rename/delete file ops
      for (const te of change.edits) {
        edits.push({
          resource: monacoApi.Uri.parse(change.textDocument.uri),
          versionId: change.textDocument.version ?? undefined,
          textEdit: lspTextEditToMonaco(te as LspTextEdit),
        })
      }
    }
  }
  return { edits }
}

function lspDocumentSymbolToMonaco(
  sym: DocumentSymbol,
  monacoApi: typeof monaco,
): monaco.languages.DocumentSymbol {
  return {
    name: sym.name,
    detail: sym.detail ?? '',
    kind: lspSymbolKindToMonaco(sym.kind),
    range: lspRangeToMonaco(sym.range),
    selectionRange: lspRangeToMonaco(sym.selectionRange),
    tags: [],
    children: (sym.children ?? []).map((c) =>
      lspDocumentSymbolToMonaco(c, monacoApi),
    ),
  }
}

function symbolInformationToDocumentSymbol(
  sym: SymbolInformation,
  monacoApi: typeof monaco,
): monaco.languages.DocumentSymbol {
  return {
    name: sym.name,
    detail: sym.containerName ?? '',
    kind: lspSymbolKindToMonaco(sym.kind),
    range: lspRangeToMonaco(sym.location.range),
    selectionRange: lspRangeToMonaco(sym.location.range),
    tags: [],
    children: [],
    ...(monacoApi ? {} : {}),
  }
}
