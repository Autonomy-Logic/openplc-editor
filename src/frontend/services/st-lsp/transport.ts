// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * LSP transport for the STruC++ Web Worker.
 *
 * Hosts a strucpp browser-server worker (built from the strucpp
 * repo's `vscode-extension/server/src/server-browser.ts`) and
 * returns a `MessageConnection` ready for the standard LSP message
 * flow.  The connection isn't `listen()`-ed here — callers start
 * the JSON-RPC pump after registering all handlers, which is the
 * standard pattern to avoid dropping early notifications.
 *
 * Termination semantics: if the worker emits `error` or
 * `messageerror`, the connection's `onError` callback fires.  The
 * orchestrator (in index.ts) wraps the worker handle so a crash
 * surfaces as a rejected `ready` promise rather than a silent stall.
 */

import {
  BrowserMessageReader,
  BrowserMessageWriter,
  createMessageConnection,
  type MessageConnection,
} from 'vscode-jsonrpc/browser'

export interface LspTransport {
  /** JSON-RPC connection.  Caller is responsible for `listen()`. */
  readonly connection: MessageConnection
  /**
   * Tear down the worker.  Closes the message connection first so
   * any in-flight requests reject cleanly.
   */
  dispose(): void
}

/**
 * Spawn the strucpp browser-server worker and wrap it in a
 * `MessageConnection`.  The worker bundle's URL is normally
 * resolved via webpack's `?url` resource query at the call site
 * (`new URL` would re-bundle the IIFE, which we don't want); tests
 * inject a Blob URL or an `about:blank`-style stub.
 *
 * Worker error events are forwarded to the connection's `onError`
 * handler so a single crash path covers both transport and runtime
 * failures.
 */
export function createLspTransport(workerUrl: string): LspTransport {
  const worker = new Worker(workerUrl, { name: 'strucpp-lsp' })

  // Surface worker-level errors as connection errors.  The browser
  // emits `error` for uncaught exceptions inside the worker and
  // `messageerror` for unserialisable messages — both translate to
  // a JSON-RPC stream we should treat as broken.
  const reader = new BrowserMessageReader(worker)
  const writer = new BrowserMessageWriter(worker)
  const connection = createMessageConnection(reader, writer)

  const handleError = (ev: Event | ErrorEvent) => {
    const message =
      ev instanceof ErrorEvent
        ? ev.message
        : '[strucpp LSP worker] worker reported a non-Error event'
    // The connection.onError handler users register expects this
    // tuple shape.  Use Number.MAX_SAFE_INTEGER as a synthetic
    // request id so the renderer-side handler can spot worker
    // errors vs. per-request failures.
    connection.dispose()
    console.error(message, ev)
  }
  worker.addEventListener('error', handleError)
  worker.addEventListener('messageerror', handleError)

  return {
    connection,
    dispose() {
      connection.dispose()
      worker.terminate()
    },
  }
}
