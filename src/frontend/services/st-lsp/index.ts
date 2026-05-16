// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * STruC++ LSP service orchestrator.
 *
 * `startStLsp` spawns the worker, performs the LSP `initialize`
 * handshake, registers Monaco providers, pushes initial stlib
 * archives, and returns a service handle the document-sync layer
 * (Phase 5) feeds with didOpen / didChange / didClose.
 *
 * Lifetime is the application's lifetime; the service is started
 * once at app boot and disposed only when the app shuts down.  A
 * crash inside the worker is logged and the `ready` promise stays
 * unresolved — the rest of the app continues to function with no
 * ST tooling rather than tripping over an undefined service.
 */

import {
  DidChangeTextDocumentNotification,
  DidCloseTextDocumentNotification,
  DidOpenTextDocumentNotification,
  InitializedNotification,
  type InitializeParams,
  InitializeRequest,
} from 'vscode-languageserver-protocol'

import { attachDiagnosticsBridge } from './diagnostics'
import { registerStLspProviders } from './providers'
import { createLspTransport, type LspTransport } from './transport'
import type { StLspService, StLspStartOptions } from './types'

const ST_LANGUAGE_ID = 'st'

/**
 * Custom RPC matching `LoadStlibBufferRequestType` in
 * strucpp/vscode-extension/server/src/server-browser.ts.
 */
const LOAD_STLIB_BUFFER = 'strucpp/loadStlibBuffer'

interface LoadStlibBufferParams {
  sourceLabel: string
  payload: string | { type: 'buffer'; bytes: number[] }
}

interface DocumentState {
  uri: string
  version: number
}

export function startStLsp(opts: StLspStartOptions): StLspService {
  const { stlibSource, monaco, workerUrlOverride } = opts

  let disposed = false
  let workerUrl = workerUrlOverride
  if (!workerUrl) {
    // Webpack rewrites this `?url` import to the emitted asset URL.
    // The require lives inside the function so the bundler probe
    // never runs under test (jsdom test envs don't ship the asset).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const moduleExports = require('strucpp/dist/browser-server.js?url') as
      | { default: string }
      | string
    workerUrl =
      typeof moduleExports === 'string' ? moduleExports : moduleExports.default
  }

  let transport: LspTransport
  try {
    transport = createLspTransport(workerUrl)
  } catch (err) {
    // No worker support (jsdom, missing URL, etc.) — return a
    // service that never resolves `ready` so callers gate on it.
    console.warn('[strucpp-lsp] worker failed to start:', err)
    const stalled = new Promise<void>(() => undefined)
    return {
      ready: stalled,
      refreshStlibs: () => Promise.resolve(),
      openDocument: () => undefined,
      changeDocument: () => undefined,
      closeDocument: () => undefined,
      dispose: () => undefined,
    }
  }

  const { connection } = transport
  const documents = new Map<string, DocumentState>()

  const providerDisposable = monaco
    ? registerStLspProviders({ connection, monacoApi: monaco })
    : null
  const diagnosticsDisposable = monaco
    ? attachDiagnosticsBridge(connection, monaco)
    : null

  // ---------------------------------------------------------------------------
  // LSP handshake — initialize, initialized, push stlibs
  // ---------------------------------------------------------------------------
  const ready = (async () => {
    connection.listen()

    const initParams: InitializeParams = {
      processId: null,
      rootUri: null,
      capabilities: {
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
        },
        workspace: {},
      },
      workspaceFolders: null,
    }
    // We don't currently use anything from the InitializeResult's
    // capabilities; a runtime check would belong here when we
    // start advertising capabilities the worker may not support.
    await connection.sendRequest(InitializeRequest.type, initParams)
    await connection.sendNotification(InitializedNotification.type, {})
    await pushAllStlibs()
  })().catch((err) => {
    console.error('[strucpp-lsp] initialize failed:', err)
    throw err
  })

  async function pushAllStlibs(): Promise<void> {
    const sources = await stlibSource.listStlibs()
    for (const source of sources) {
      try {
        const payload = await stlibSource.readStlib(source.sourceLabel)
        await connection.sendRequest(LOAD_STLIB_BUFFER, {
          sourceLabel: source.sourceLabel,
          payload,
        } as LoadStlibBufferParams)
      } catch (err) {
        // One bad archive shouldn't starve the rest.  Surface
        // diagnostically — completion still works for the libraries
        // that did load.
        console.warn(
          `[strucpp-lsp] failed to load stlib "${source.sourceLabel}":`,
          err,
        )
      }
    }
  }

  return {
    ready,

    refreshStlibs: async () => {
      // Best-effort: if ready hasn't resolved, queue behind it.
      try {
        await ready
      } catch {
        return
      }
      // Clear-then-repush so the worker's cache reflects the
      // current stlib set exactly.  Cheaper than diffing, and the
      // worker's per-archive parse is fast.
      try {
        await connection.sendRequest('strucpp/clearStlibCache')
      } catch {
        // Older worker bundles may not have this RPC yet — silent
        // fallback to "additive" semantics is acceptable.
      }
      await pushAllStlibs()
    },

    openDocument(uri, content) {
      if (disposed) return
      const existing = documents.get(uri)
      const version = (existing?.version ?? 0) + 1
      documents.set(uri, { uri, version })
      void connection.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: {
          uri,
          languageId: ST_LANGUAGE_ID,
          version,
          text: content,
        },
      })
    },

    changeDocument(uri, content, externalVersion) {
      if (disposed) return
      const next = { uri, version: externalVersion }
      documents.set(uri, next)
      void connection.sendNotification(DidChangeTextDocumentNotification.type, {
        textDocument: { uri, version: externalVersion },
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
      transport.dispose()
    },
  }
}

export type { StLspService, StLspStartOptions } from './types'
export { parsePouUri, POU_URI_SCHEME, pouUri, stubUri } from './types'
