// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Generic Monaco language-provider registrations backed by an LSP
 * `MessageConnection`.  Each provider forwards Monaco's query params
 * to the worker via the matching LSP request type and translates
 * the response back into Monaco's expected shape.
 *
 * The shape parameters (`languageId`, trigger characters, optional
 * URI/offset resolver, definition-target mapping and outline routing)
 * come from the caller — see {@link RegisterLspProvidersOptions} below.
 * Anything language-specific (ST's `pouvars://` URI rewriting, where a
 * definition target is shown, where an activation navigates) plugs in
 * via hooks rather than living here. The providers themselves only
 * answer questions; navigation runs from `navigation.ts` on activation.
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
  lspRangeToMonaco,
  lspSignatureHelpToMonaco,
  lspSymbolKindToMonaco,
  lspTextEditToMonaco,
  monacoPositionToLsp,
} from './converters'
import {
  clipEditsToWindow,
  clipSymbolsToWindow,
  lspLineInWindow,
  type LspLineWindow,
  modelMatchesDocumentWindow,
  symbolsBeforeWindow,
} from './internal/line-window'
import {
  lspDocumentSymbolToMonaco,
  normaliseLocationResponse,
  suppressNoDefinitionFound,
} from './internal/symbol-helpers'
import { attachOutlineActivation, bindOutlineTarget, type NavigateToTarget, resetOutlineTargets } from './navigation'

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
 * Where a definition target is shown before it is activated: the URI
 * Monaco resolves for its hover preview and hands to the editor opener,
 * and the range in that model's own frame. Null drops a target the
 * editor cannot reach.
 */
export type MappedLocation = { uri: string; range: monaco.IRange } | null

export type DefinitionLocationMapper = (loc: LspLocation, source: LspContext & { modelUri: string }) => MappedLocation

export interface ProviderHooks {
  /**
   * Resolve a Monaco model URI to the LSP URI to request against
   * and the body-line offset to use for coordinate translation.
   * Default: identity URI + `getBodyLineOffset(modelUri)`.
   */
  resolveLspContext?: (modelUri: string) => LspContext
  /**
   * Map each LSP definition target to the location Monaco shows.
   * Default: the target as-is, shifted to its model's body view.
   */
  mapDefinitionLocation?: DefinitionLocationMapper
  /**
   * Route for outline entries that sit before the model's slice — a body
   * editor's VAR declarations. When set they are listed and bound to it;
   * when absent they are dropped, as a windowed view's are.
   */
  navigateOutline?: NavigateToTarget
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

const isDocumentSymbols = (result: DocumentSymbol[] | SymbolInformation[]): result is DocumentSymbol[] =>
  result.length === 0 || 'range' in result[0]

// Location URIs may refer to any document, so the offset is the target's own.
const defaultMapDefinitionLocation: DefinitionLocationMapper = (loc) => ({
  uri: loc.uri,
  range: lspRangeToMonaco(loc.range, getBodyLineOffset(loc.uri)),
})

export function registerLspProviders(opts: RegisterLspProvidersOptions): monaco.IDisposable {
  const { connection, monacoApi, languageId } = opts
  const resolveLspContext = opts.hooks?.resolveLspContext ?? defaultResolveLspContext
  const mapDefinitionLocation = opts.hooks?.mapDefinitionLocation ?? defaultMapDefinitionLocation
  const navigateOutline = opts.hooks?.navigateOutline
  const filterFormattingEdits = opts.hooks?.filterFormattingEdits ?? defaultFilterFormattingEdits
  const getLspDocumentText = opts.hooks?.getLspDocumentText
  const completionTriggerCharacters = opts.completionTriggerCharacters ?? []
  const signatureHelpTriggerCharacters = opts.signatureHelpTriggerCharacters ?? []

  const disposables: monaco.IDisposable[] = []
  if (navigateOutline) attachOutlineActivation(monacoApi)

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
        const modelUri = model.uri.toString()
        const context = resolveLspContext(modelUri)
        const lspPosition = monacoPositionToLsp(position, context.lineOffset)
        if (!lspLineInWindow(lspPosition.line, context.lineWindow)) return null
        const result = await connection.sendRequest(DefinitionRequest.type, {
          textDocument: { uri: context.lspUri },
          position: lspPosition,
        })
        // DefinitionRequest may resolve to Location, Location[], or
        // LocationLink[].  Normalise to Location[] first so the mapper
        // sees a uniform shape.
        const normalised = normaliseLocationResponse(result as LspLocation | LspLocation[] | LocationLink[] | null)
        if (!normalised) return null

        const locations = Array.isArray(normalised) ? normalised : [normalised]
        const mapped: monaco.languages.Location[] = []
        for (const loc of locations) {
          const shown = mapDefinitionLocation(loc, { ...context, modelUri })
          if (shown) mapped.push({ uri: monacoApi.Uri.parse(shown.uri), range: shown.range })
        }
        // Every target unreachable (a typeshed stub, say): still claim the
        // definition, or Monaco shows its banner and peeks references.
        if (mapped.length === 0) return suppressNoDefinitionFound(model, position, monacoApi)
        return mapped
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
        const modelUri = model.uri.toString()
        const { lspUri, lineOffset, lineWindow } = resolveLspContext(modelUri)
        resetOutlineTargets(modelUri)
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
        const symbols: DocumentSymbol[] = isDocumentSymbols(result)
          ? result
          : result.map((s) => ({
              name: s.name,
              detail: s.containerName,
              kind: s.kind,
              range: s.location.range,
              selectionRange: s.location.range,
            }))
        const shown = clipSymbolsToWindow(symbols, visible).map((s) => lspDocumentSymbolToMonaco(s, lineOffset))
        // A body editor's declarations live before its slice. Listed anyway,
        // each bound to where it really points, so accepting one navigates
        // there instead of selecting a line this editor does not have.
        if (!navigateOutline || lineWindow) return shown
        const line =
          monacoApi.editor
            .getEditors()
            .find((e) => e.getModel() === model)
            ?.getPosition()?.lineNumber ?? 1
        const bound = symbolsBeforeWindow(symbols, visible).map((s): monaco.languages.DocumentSymbol => {
          const target = {
            uri: lspUri,
            lineLsp: s.selectionRange.start.line,
            characterLsp: s.selectionRange.start.character,
          }
          const range = bindOutlineTarget(modelUri, line, target, navigateOutline)
          return {
            name: s.name,
            detail: s.detail ?? '',
            kind: lspSymbolKindToMonaco(s.kind),
            range,
            selectionRange: range,
            tags: [],
            children: [],
          }
        })
        return [...bound, ...shown]
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
