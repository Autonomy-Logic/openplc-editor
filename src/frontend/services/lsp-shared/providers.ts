// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Generic Monaco language-provider registrations backed by an LSP
 * `MessageConnection`.  Each provider forwards Monaco's query params
 * to the worker via the matching LSP request type and translates
 * the response back into Monaco's expected shape.
 *
 * The shape parameters (`languageId`, trigger characters, optional
 * URI/offset resolver and definition interceptors) come from the
 * caller — see {@link RegisterLspProvidersOptions} below.  Anything
 * language-specific (ST's `pouvars://` URI rewriting, store-driven
 * definition redirects) plugs in via hooks rather than living here.
 *
 * Every provider walks the same translation pattern:
 *
 *   - Resolve the model URI to `(lspUri, lineOffset)`.
 *   - Translate Monaco's outbound position by adding `lineOffset`
 *     so the worker sees the request in its own coordinate space.
 *   - Translate the worker's inbound ranges by subtracting
 *     `lineOffset` so Monaco renders results against the body-only
 *     view.
 *
 * When the offset is 0 (no preamble, or registry not yet populated),
 * the translation is a no-op.
 */

import type * as monaco from 'monaco-editor'
import {
  CompletionRequest,
  DefinitionRequest,
  DocumentFormattingRequest,
  type DocumentSymbol,
  DocumentSymbolRequest,
  HoverRequest,
  type Location as LspLocation,
  type LocationLink,
  type MessageConnection,
  ReferencesRequest,
  SignatureHelpRequest,
  type SymbolInformation,
  type TextEdit as LspTextEdit,
} from 'vscode-languageserver-protocol'

import { getBodyLineOffset } from './body-offsets'
import {
  lspCompletionListToMonaco,
  lspHoverToMonaco,
  lspLocationsToMonaco,
  lspSignatureHelpToMonaco,
  lspTextEditToMonaco,
  monacoPositionToLsp,
} from './converters'
import {
  clipEditsToWindow,
  clipSymbolsToWindow,
  lspLineInWindow,
  type LspLineWindow,
  modelMatchesDocumentWindow,
} from './internal/line-window'
import {
  lspDocumentSymbolToMonaco,
  normaliseLocationResponse,
  symbolInformationToDocumentSymbol,
} from './internal/symbol-helpers'

/**
 * Resolved LSP context for a given Monaco model URI.  Default
 * implementation passes the model URI through unchanged and reads
 * the body-line offset from the shared registry.  Override when the
 * service uses synthetic URIs that need rewriting (ST's
 * `pouvars://` view targets a different LSP document than the
 * variables-text editor's model URI).
 *
 * `lineWindow` marks a model that renders only a slice of the resolved
 * document, so requests landing outside it answer nothing instead of
 * resolving onto the neighbouring slice.
 */
export interface LspContext {
  lspUri: string
  lineOffset: number
  lineWindow?: LspLineWindow
}

/**
 * Definition redirect.  Run in registration order; the first hook
 * to return a non-`undefined` value wins and the LSP response is
 * never converted.  Returning `null` claims the navigation
 * (Monaco's "no definition found" banner is suppressed but no
 * navigation happens here — the redirect does its own thing).
 * Returning `undefined` lets the next hook (or the default LSP
 * conversion) handle the result.
 */
export type DefinitionInterceptor = (
  locations: LspLocation[],
  model: monaco.editor.ITextModel,
  position: monaco.IPosition,
  monacoApi: typeof monaco,
) => monaco.languages.Definition | null | undefined

export interface ProviderHooks {
  /**
   * Resolve a Monaco model URI to the LSP URI to request against
   * and the body-line offset to use for coordinate translation.
   * Default: identity URI + `getBodyLineOffset(modelUri)`.
   */
  resolveLspContext?: (modelUri: string) => LspContext
  /**
   * Hooks called for each `provideDefinition` result before the
   * default LSP-to-Monaco conversion runs.  Run in array order.
   */
  definitionInterceptors?: DefinitionInterceptor[]
  /**
   * Filter the formatting edits returned by the worker before they
   * reach Monaco.  Default: keep edits whose entire range sits at
   * or past `offset` (so preamble edits are dropped — they'd land
   * at negative lines or clobber body content).  One-sided by design:
   * the result is clipped to the context's `lineWindow` afterwards, so
   * a custom hook cannot let a windowed view receive foreign edits.
   */
  filterFormattingEdits?: (edits: LspTextEdit[], offset: number) => LspTextEdit[]
  /**
   * The LSP-side text of `lspUri`, as last sent to the worker.
   * Required for formatting in a windowed view: edit columns are
   * computed against this text, so a buffer that no longer matches
   * its window slice must not apply them. Windowed formatting is a
   * no-op when the hook is absent or the texts have drifted.
   */
  getLspDocumentText?: (lspUri: string) => string | undefined
}

export interface RegisterLspProvidersOptions {
  connection: MessageConnection
  monacoApi: typeof monaco
  /** Monaco language ID (`'st'`, `'python'`, …). */
  languageId: string
  /** Completion `triggerCharacters`.  Empty array disables triggered completion. */
  completionTriggerCharacters?: string[]
  /** Signature-help `signatureHelpTriggerCharacters`.  Empty array disables triggered help. */
  signatureHelpTriggerCharacters?: string[]
  hooks?: ProviderHooks
}

const defaultResolveLspContext = (modelUri: string): LspContext => ({
  lspUri: modelUri,
  lineOffset: getBodyLineOffset(modelUri),
})

const defaultFilterFormattingEdits = (edits: LspTextEdit[], offset: number): LspTextEdit[] =>
  edits.filter((e) => e.range.start.line >= offset && e.range.end.line >= offset)

export function registerLspProviders(opts: RegisterLspProvidersOptions): monaco.IDisposable {
  const { connection, monacoApi, languageId } = opts
  const resolveLspContext = opts.hooks?.resolveLspContext ?? defaultResolveLspContext
  const definitionInterceptors = opts.hooks?.definitionInterceptors ?? []
  const filterFormattingEdits = opts.hooks?.filterFormattingEdits ?? defaultFilterFormattingEdits
  const getLspDocumentText = opts.hooks?.getLspDocumentText
  const completionTriggerCharacters = opts.completionTriggerCharacters ?? []
  const signatureHelpTriggerCharacters = opts.signatureHelpTriggerCharacters ?? []

  const disposables: monaco.IDisposable[] = []

  // -------------------------------------------------------------------------
  // Completion
  // -------------------------------------------------------------------------

  disposables.push(
    monacoApi.languages.registerCompletionItemProvider(languageId, {
      triggerCharacters: completionTriggerCharacters,
      provideCompletionItems: async (model, position) => {
        const { lspUri, lineOffset, lineWindow } = resolveLspContext(model.uri.toString())
        const lspPosition = monacoPositionToLsp(position, lineOffset)
        if (!lspLineInWindow(lspPosition.line, lineWindow)) return { suggestions: [] }
        const word = model.getWordUntilPosition(position)
        const defaultRange: monaco.IRange = {
          startLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        }
        const result = await connection.sendRequest(CompletionRequest.type, {
          textDocument: { uri: lspUri },
          position: lspPosition,
        })
        return lspCompletionListToMonaco(result, defaultRange, monacoApi, lineOffset)
      },
    }),
  )

  // -------------------------------------------------------------------------
  // Hover
  // -------------------------------------------------------------------------

  disposables.push(
    monacoApi.languages.registerHoverProvider(languageId, {
      provideHover: async (model, position) => {
        const { lspUri, lineOffset, lineWindow } = resolveLspContext(model.uri.toString())
        const lspPosition = monacoPositionToLsp(position, lineOffset)
        if (!lspLineInWindow(lspPosition.line, lineWindow)) return undefined
        const result = await connection.sendRequest(HoverRequest.type, {
          textDocument: { uri: lspUri },
          position: lspPosition,
        })
        return lspHoverToMonaco(result, lineOffset) ?? undefined
      },
    }),
  )

  // -------------------------------------------------------------------------
  // Signature help
  // -------------------------------------------------------------------------

  disposables.push(
    monacoApi.languages.registerSignatureHelpProvider(languageId, {
      signatureHelpTriggerCharacters,
      provideSignatureHelp: async (model, position) => {
        const { lspUri, lineOffset, lineWindow } = resolveLspContext(model.uri.toString())
        const lspPosition = monacoPositionToLsp(position, lineOffset)
        if (!lspLineInWindow(lspPosition.line, lineWindow)) return null
        const result = await connection.sendRequest(SignatureHelpRequest.type, {
          textDocument: { uri: lspUri },
          position: lspPosition,
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
    monacoApi.languages.registerDefinitionProvider(languageId, {
      provideDefinition: async (model, position) => {
        const { lspUri, lineOffset, lineWindow } = resolveLspContext(model.uri.toString())
        const lspPosition = monacoPositionToLsp(position, lineOffset)
        if (!lspLineInWindow(lspPosition.line, lineWindow)) return null
        const result = await connection.sendRequest(DefinitionRequest.type, {
          textDocument: { uri: lspUri },
          position: lspPosition,
        })
        // DefinitionRequest may resolve to Location, Location[], or
        // LocationLink[].  Normalise to Location[] first so the
        // interceptors see a uniform shape.
        const normalised = normaliseLocationResponse(result as LspLocation | LspLocation[] | LocationLink[] | null)
        if (!normalised) return null

        const locations = Array.isArray(normalised) ? normalised : [normalised]
        for (const intercept of definitionInterceptors) {
          const claimed = intercept(locations, model, position, monacoApi)
          if (claimed !== undefined) return claimed
        }
        return lspLocationsToMonaco(normalised, monacoApi) ?? null
      },
    }),
  )

  // -------------------------------------------------------------------------
  // References
  // -------------------------------------------------------------------------

  disposables.push(
    monacoApi.languages.registerReferenceProvider(languageId, {
      provideReferences: async (model, position, context) => {
        const { lspUri, lineOffset, lineWindow } = resolveLspContext(model.uri.toString())
        const lspPosition = monacoPositionToLsp(position, lineOffset)
        if (!lspLineInWindow(lspPosition.line, lineWindow)) return []
        const result = await connection.sendRequest(ReferencesRequest.type, {
          textDocument: { uri: lspUri },
          position: lspPosition,
          context: { includeDeclaration: context.includeDeclaration },
        })
        return (lspLocationsToMonaco(result, monacoApi) as monaco.languages.Location[] | null) ?? []
      },
    }),
  )

  // -------------------------------------------------------------------------
  // Document symbols (outline)
  // -------------------------------------------------------------------------

  disposables.push(
    monacoApi.languages.registerDocumentSymbolProvider(languageId, {
      provideDocumentSymbols: async (model) => {
        const { lspUri, lineOffset, lineWindow } = resolveLspContext(model.uri.toString())
        const result = await connection.sendRequest(DocumentSymbolRequest.type, {
          textDocument: { uri: lspUri },
        })
        if (!result) return []
        if (result.length === 0) return []
        // A body editor renders the document from `lineOffset` down, so a
        // preamble symbol converts to a line Monaco rejects the moment the
        // outline navigates to it.
        const visible = lineWindow ?? { startLine: lineOffset, endLineExclusive: Number.MAX_SAFE_INTEGER }
        // The handler can return either DocumentSymbol[] (nested
        // hierarchy) or SymbolInformation[] (flat list with
        // containerName).  Monaco's outline view wants
        // DocumentSymbol[] — flat lists get rewrapped.
        if ('range' in result[0]) {
          return clipSymbolsToWindow(result as DocumentSymbol[], visible).map((s) =>
            lspDocumentSymbolToMonaco(s, lineOffset),
          )
        }
        return (result as SymbolInformation[])
          .filter((s) => lspLineInWindow(s.location.range.start.line, visible))
          .map((s) => symbolInformationToDocumentSymbol(s, lineOffset))
      },
    }),
  )

  // -------------------------------------------------------------------------
  // Formatting
  // -------------------------------------------------------------------------

  disposables.push(
    monacoApi.languages.registerDocumentFormattingEditProvider(languageId, {
      provideDocumentFormattingEdits: async (model, options) => {
        const { lspUri, lineOffset, lineWindow } = resolveLspContext(model.uri.toString())
        if (lineWindow) {
          const documentText = getLspDocumentText?.(lspUri)
          if (
            documentText === undefined ||
            !modelMatchesDocumentWindow(model.getValue(), documentText, lineOffset, lineWindow)
          ) {
            // Distinguishes "nothing to format" from "guard tripped" in a bug report.
            console.debug(`[lsp] Format Document skipped: windowed view drifted from ${lspUri}`)
            return []
          }
        }
        const result = await connection.sendRequest(DocumentFormattingRequest.type, {
          textDocument: { uri: lspUri },
          options: {
            tabSize: options.tabSize,
            insertSpaces: options.insertSpaces,
          },
        })
        if (!result) return []
        const edits = clipEditsToWindow(filterFormattingEdits(result, lineOffset), lineWindow)
        return edits.map((te) => lspTextEditToMonaco(te, lineOffset))
      },
    }),
  )

  return {
    dispose() {
      for (const d of disposables) d.dispose()
    },
  }
}
