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
 * Worker error events dispose the connection and surface to the
 * optional `onError` callback.  The connection's pending requests
 * reject as part of the dispose, which is how a crash *before*
 * `initialize` resolves rejects `ready` cleanly without extra
 * plumbing — `vscode-jsonrpc` already rejects every in-flight
 * request when `connection.dispose()` runs.
 *
 * `onError` exists for the *after*-init case: by the time the
 * worker crashes mid-session the `ready` promise has already
 * resolved, so callers gated on `ready` would otherwise sit waiting
 * on requests that never resolve.  The orchestrator forwards the
 * error to whoever owns the user-facing UI.
 */
export function createLspTransport(
  workerUrl: string,
  options: { onError?: (err: Error) => void } = {},
): LspTransport {
  const worker = new Worker(workerUrl, { name: 'strucpp-lsp' })

  // Surface worker-level errors as connection errors.  The browser
  // emits `error` for uncaught exceptions inside the worker and
  // `messageerror` for unserialisable messages — both translate to
  // a JSON-RPC stream we should treat as broken.
  const reader = new BrowserMessageReader(worker)
  const writer = new BrowserMessageWriter(worker)
  const connection = createMessageConnection(reader, writer)

  let crashed = false
  const handleError = (ev: Event | ErrorEvent) => {
    if (crashed) return
    crashed = true
    const message =
      ev instanceof ErrorEvent
        ? ev.message
        : '[strucpp LSP worker] worker reported a non-Error event'
    const error = ev instanceof ErrorEvent && ev.error instanceof Error ? ev.error : new Error(message)
    connection.dispose()
    console.error(message, ev)
    try {
      options.onError?.(error)
    } catch (callbackErr) {
      // Don't let a user-supplied callback throwing during crash
      // recovery swallow the original failure — log it but keep
      // going so the transport itself ends up in a consistent state.
      console.error('[strucpp LSP worker] onError callback threw:', callbackErr)
    }
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
