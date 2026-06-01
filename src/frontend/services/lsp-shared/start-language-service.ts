// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Generic LSP-service orchestrator.
 *
 * `startLanguageService` spawns a worker, performs the LSP
 * `initialize` handshake, registers Monaco providers + diagnostics
 * + (conditional) semantic-tokens, runs an optional caller-supplied
 * post-initialize step (ST uses this to push stlib archives), and
 * returns a service handle the document-sync layer feeds with
 * didOpen / didChange / didClose.
 *
 * Lifetime is the application's lifetime; the service is started
 * once at app boot and disposed only when the app shuts down.  A
 * crash inside the worker pre-initialize rejects the `ready`
 * promise; a crash post-initialize fires the caller's `onCrash`
 * callback so the UI can surface a "service stopped" toast.
 */

import type * as monaco from 'monaco-editor'
import type { TextEdit as LspTextEdit } from 'vscode-languageserver-protocol'
import {
  type ClientCapabilities,
  DidChangeTextDocumentNotification,
  DidCloseTextDocumentNotification,
  DidOpenTextDocumentNotification,
  InitializedNotification,
  type InitializeParams,
  InitializeRequest,
  type InitializeResult,
  type MessageConnection,
  SemanticTokensRefreshRequest,
} from 'vscode-languageserver-protocol'

import { attachDiagnosticsBridge, type DiagnosticsMirror } from './diagnostics'
import { type DefinitionInterceptor, type LspContext, registerLspProviders } from './providers'
import {
  registerLspSemanticTokens,
  type ResolveSemanticTokensViewport,
  type SemanticTokensRegistration,
} from './semantic-tokens'
import { createLspTransport, type LspTransport } from './transport'

/**
 * Default capabilities advertised on `initialize`.  Covers every
 * Monaco-side provider this layer registers.  Callers can override
 * by passing `clientCapabilities` (e.g. to disable a feature their
 * server doesn't support, or to add per-service flags).
 */
export const DEFAULT_CLIENT_CAPABILITIES: ClientCapabilities = {
  textDocument: {
    publishDiagnostics: {},
    completion: { completionItem: { snippetSupport: true } },
    hover: {},
    signatureHelp: {},
    definition: {},
    references: {},
    documentSymbol: { hierarchicalDocumentSymbolSupport: true },
    rename: { prepareSupport: true },
    formatting: {},
    semanticTokens: {
      requests: { full: true },
      tokenTypes: [],
      tokenModifiers: [],
      formats: ['relative'],
    },
  },
  workspace: {
    // Honour server-initiated requests to refresh semantic tokens.
    // Servers send these when background analysis catches up to
    // docs that were didOpen'd before the server was ready —
    // without refreshSupport, the client keeps showing whatever
    // empty result the first query returned.
    semanticTokens: { refreshSupport: true },
  },
}

export interface LanguageService {
  /** Resolves after `initialize` + the post-initialize step.  Rejects if the worker crashes pre-init. */
  ready: Promise<void>
  /** Send `textDocument/didOpen`. */
  openDocument(uri: string, content: string): void
  /** Send `textDocument/didChange` (full-text sync). */
  changeDocument(uri: string, content: string, version?: number): void
  /** Send `textDocument/didClose`. */
  closeDocument(uri: string): void
  /** Tear down providers + transport. */
  dispose(): void
}

export interface StartLanguageServiceOptions {
  /** Monaco language ID (`'st'`, `'python'`, …). */
  languageId: string
  /** Short name for the Worker + log prefix. */
  workerName: string
  /** URL of the worker bundle.  Resolved by the caller (typically a bundler `?url` import). */
  workerUrl: string
  /** Optional Monaco namespace.  Omit on the boot path that runs before Monaco is loaded; the service still wires the protocol-level handlers, providers just won't register. */
  monaco?: typeof monaco

  // Provider configuration --------------------------------------------------
  completionTriggerCharacters?: string[]
  signatureHelpTriggerCharacters?: string[]
  resolveLspContext?: (modelUri: string) => LspContext
  definitionInterceptors?: DefinitionInterceptor[]
  filterFormattingEdits?: (edits: LspTextEdit[], offset: number) => LspTextEdit[]
  resolveSemanticTokensViewport?: ResolveSemanticTokensViewport

  // Diagnostics configuration -----------------------------------------------
  markerOwner: string
  diagnosticSource?: string
  diagnosticsMirror?: DiagnosticsMirror
  /**
   * Translate the LSP URI on an incoming `publishDiagnostics`
   * notification to the Monaco model URI the markers should apply
   * to.  Forwarded to `attachDiagnosticsBridge`.  Used by Python
   * LSP (LSP URI = model URI + `.py`); ST passes none.
   */
  resolveDiagnosticsModelUri?: (lspUri: string) => string

  // Lifecycle hooks ---------------------------------------------------------
  /**
   * Register custom RPC handlers on the connection before `listen()`
   * is called.  Use for service-specific request types (e.g. ST's
   * `strucpp/loadStlibBuffer`).  Don't perform I/O here — the
   * connection isn't listening yet.
   */
  beforeListen?: (connection: MessageConnection) => void
  /**
   * Run after `initialize` + `initialized`.  Awaited before `ready`
   * resolves.  Throwing here counts as crash-during-init and
   * propagates through the rejected `ready` promise.  Used by ST to
   * push stlib archives; Python LSP has no analogue.
   */
  postInitialize?: (ctx: { connection: MessageConnection; initResult: InitializeResult }) => Promise<void>
  /** Override the default LSP client capabilities. */
  clientCapabilities?: ClientCapabilities
  /**
   * Workspace root URI advertised on `initialize`.  Defaults to
   * `null` (no workspace).  Pyright requires a workspace folder
   * to load `pyrightconfig.json`, which is in turn how we
   * override its typeshed search path.
   */
  rootUri?: string
  /**
   * Workspace folders advertised on `initialize`.  Defaults to
   * `null`.  Mirrors `rootUri` in semantics; LSP servers
   * generally treat the workspaceFolders array as the source of
   * truth and use `rootUri` only as a fallback for single-folder
   * workspaces.
   */
  workspaceFolders?: { name: string; uri: string }[]
  /**
   * Free-form `initializationOptions` payload to send with the LSP
   * `initialize` request.  Pyright derivatives crash their
   * initialize handler if this is missing (they destructure it
   * unconditionally); strucpp ignores it.  Shape is server-
   * specific — see the consumer's docs.
   */
  initializationOptions?: unknown
  /** Post-`initialize` worker crash. */
  onCrash?: (err: Error) => void
  /**
   * Service-specific worker bootstrap.  Forwarded to
   * `createLspTransport`; see its docs.  Use for non-LSP boot
   * messages (e.g., browser-basedpyright's `browser/boot`
   * handshake) and for `message` listeners that handle
   * worker-specific commands (e.g., basedpyright's
   * `browser/newWorker` requests).
   */
  setupWorker?: (worker: Worker, workerUrl: string) => void
}

export function startLanguageService(opts: StartLanguageServiceOptions): LanguageService {
  const {
    languageId,
    workerName,
    workerUrl,
    monaco: monacoApi,
    completionTriggerCharacters,
    signatureHelpTriggerCharacters,
    resolveLspContext,
    definitionInterceptors,
    filterFormattingEdits,
    resolveSemanticTokensViewport,
    markerOwner,
    diagnosticSource,
    diagnosticsMirror,
    resolveDiagnosticsModelUri,
    beforeListen,
    postInitialize,
    clientCapabilities = DEFAULT_CLIENT_CAPABILITIES,
    rootUri,
    workspaceFolders,
    initializationOptions,
    onCrash,
    setupWorker,
  } = opts

  let disposed = false
  let initialised = false

  // Forward worker crashes to the renderer's callback ONLY after
  // `initialize` has resolved.  Pre-init crashes reject `ready`
  // through the natural in-flight-request rejection that
  // `connection.dispose()` triggers, so calling `onCrash` then
  // would surface a redundant toast.
  const handleWorkerCrash = (err: Error) => {
    if (!initialised) return
    if (disposed) return
    try {
      onCrash?.(err)
    } catch (callbackErr) {
      console.error(`[${workerName}] onCrash callback threw:`, callbackErr)
    }
  }

  let transport: LspTransport
  try {
    transport = createLspTransport(workerUrl, {
      workerName,
      onError: handleWorkerCrash,
      ...(setupWorker ? { setupWorker } : {}),
    })
  } catch (err) {
    // No worker support (jsdom, missing URL, etc.) — return a
    // service that never resolves `ready` so callers gate on it.
    console.warn(`[${workerName}] worker failed to start:`, err)
    const stalled = new Promise<void>(() => undefined)
    return {
      ready: stalled,
      openDocument: () => undefined,
      changeDocument: () => undefined,
      closeDocument: () => undefined,
      dispose: () => undefined,
    }
  }

  const { connection } = transport
  const documents = new Map<string, { uri: string; version: number }>()

  const providerDisposable = monacoApi
    ? registerLspProviders({
        connection,
        monacoApi,
        languageId,
        ...(completionTriggerCharacters ? { completionTriggerCharacters } : {}),
        ...(signatureHelpTriggerCharacters ? { signatureHelpTriggerCharacters } : {}),
        hooks: {
          ...(resolveLspContext ? { resolveLspContext } : {}),
          ...(definitionInterceptors ? { definitionInterceptors } : {}),
          ...(filterFormattingEdits ? { filterFormattingEdits } : {}),
        },
      })
    : null

  const diagnosticsDisposable = monacoApi
    ? attachDiagnosticsBridge(connection, monacoApi, {
        markerOwner,
        ...(diagnosticSource ? { defaultSource: diagnosticSource } : {}),
        ...(diagnosticsMirror ? { mirror: diagnosticsMirror } : {}),
        ...(resolveDiagnosticsModelUri ? { resolveModelUri: resolveDiagnosticsModelUri } : {}),
      })
    : null

  // Semantic-tokens provider needs the legend from the worker's
  // `initialize` result, so it can't be registered synchronously
  // alongside the others.  Filled in inside the ready promise below.
  let semanticTokensRegistration: SemanticTokensRegistration | null = null

  // Handler for `workspace/semanticTokens/refresh` — servers send
  // this when their background analysis catches up to docs that
  // were didOpen'd before they were ready, and ask the client to
  // re-query all semantic tokens.  Registered immediately (not
  // inside the ready promise) so the handler is in place even for
  // refreshes the server sends mid-handshake.
  connection.onRequest(SemanticTokensRefreshRequest.type, () => {
    semanticTokensRegistration?.refresh()
    return null
  })

  beforeListen?.(connection)

  // ---------------------------------------------------------------------------
  // LSP handshake — initialize, initialized, post-init hook
  // ---------------------------------------------------------------------------
  const ready = (async () => {
    connection.listen()

    const initParams: InitializeParams = {
      processId: null,
      rootUri: rootUri ?? null,
      capabilities: clientCapabilities,
      workspaceFolders: workspaceFolders ?? null,
      ...(initializationOptions !== undefined ? { initializationOptions } : {}),
    }
    const initResult = await connection.sendRequest(InitializeRequest.type, initParams)
    await connection.sendNotification(InitializedNotification.type, {})

    // Wire semantic tokens once we know the worker's legend.  If
    // the server didn't advertise the capability, we silently skip
    // registration so the language still renders, with the other
    // providers unaffected.
    const provider = initResult.capabilities.semanticTokensProvider
    if (monacoApi && provider && 'legend' in provider && provider.legend) {
      semanticTokensRegistration = registerLspSemanticTokens({
        connection,
        monacoApi,
        languageId,
        legend: {
          tokenTypes: [...provider.legend.tokenTypes],
          tokenModifiers: [...provider.legend.tokenModifiers],
        },
        ...(resolveLspContext ? { resolveLspContext } : {}),
        ...(resolveSemanticTokensViewport ? { resolveViewport: resolveSemanticTokensViewport } : {}),
      })
    }

    if (postInitialize) {
      await postInitialize({ connection, initResult })
    }
    // Mark the service initialised AFTER the post-init hook — any
    // failure up to this point counts as crash-during-init and goes
    // through the rejected `ready` promise, not the post-init crash
    // callback.  This is the exact boundary where the rest of the
    // app starts trusting the service is alive.
    initialised = true
  })().catch((err) => {
    console.error(`[${workerName}] initialize failed:`, err)
    throw err
  })

  return {
    ready,

    openDocument(uri, content) {
      if (disposed) return
      const existing = documents.get(uri)
      const version = (existing?.version ?? 0) + 1
      documents.set(uri, { uri, version })
      void connection.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: { uri, languageId, version, text: content },
      })
    },

    changeDocument(uri, content, externalVersion) {
      if (disposed) return
      // LSP requires document versions to be monotonically
      // increasing.  If the caller supplies one we honour it (ST's
      // project-sync ties its versions to the project store's
      // change counter); otherwise we advance the shared per-URI
      // counter started by `openDocument`.  Callers that mix the
      // two — e.g. `openDocument(uri, …)` then
      // `changeDocument(uri, …, /* external */ 1)` — would collide
      // on version 1 and Pyright would silently drop every
      // change; auto-incrementing here prevents that whole class
      // of bug.
      const existing = documents.get(uri)
      const version = externalVersion ?? (existing?.version ?? 0) + 1
      documents.set(uri, { uri, version })
      void connection.sendNotification(DidChangeTextDocumentNotification.type, {
        textDocument: { uri, version },
        contentChanges: [{ text: content }],
      })
    },

    closeDocument(uri) {
      if (disposed) return
      documents.delete(uri)
      void connection.sendNotification(DidCloseTextDocumentNotification.type, {
        textDocument: { uri },
      })
    },

    dispose() {
      if (disposed) return
      disposed = true
      providerDisposable?.dispose()
      diagnosticsDisposable?.dispose()
      semanticTokensRegistration?.dispose()
      transport.dispose()
    },
  }
}
