// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Generic Web-Worker LSP transport.
 *
 * Spawns a Web Worker that hosts an LSP server (the strucpp browser
 * server for ST, browser-basedpyright for Python, etc.) and wraps
 * it in a `vscode-jsonrpc/browser` `MessageConnection` ready for
 * the standard LSP message flow.  The connection isn't `listen()`-ed
 * here — callers start the JSON-RPC pump after registering all
 * handlers, which is the standard pattern to avoid dropping early
 * notifications.
 *
 * Termination semantics: if the worker emits `error` or
 * `messageerror`, the connection's `onError` callback fires.  The
 * orchestrator wraps the worker handle so a crash surfaces as a
 * rejected `ready` promise rather than a silent stall.
 *
 * `workerName` is the Worker constructor's `name` option and the
 * prefix on error logs — keep it short and recognisable so a single
 * console scrollback page can tell two services apart.
 */

import {
  BrowserMessageReader,
  BrowserMessageWriter,
  createMessageConnection,
  type MessageConnection,
  Trace,
  type Tracer,
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

export interface CreateLspTransportOptions {
  /** Short name for the Worker + log prefix.  Required. */
  workerName: string
  /** Post-`initialize` crash callback. */
  onError?: (err: Error) => void
}

/**
 * Spawn a Web Worker at `workerUrl` and wrap it in a
 * `MessageConnection`.  The worker bundle's URL is normally
 * resolved via the bundler's `?url` resource query at the call site
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
export function createLspTransport(workerUrl: string, options: CreateLspTransportOptions): LspTransport {
  const { workerName, onError } = options
  const logPrefix = `[${workerName}]`

  // DEBUG: log worker spawn so we can see whether the URL even
  // resolved.  Remove once the Pyright "Loading…" bug is rooted out.
  console.log(`${logPrefix}[debug] spawning worker at`, workerUrl)
  const worker = new Worker(workerUrl, { name: workerName })

  // Surface worker-level errors as connection errors.  The browser
  // emits `error` for uncaught exceptions inside the worker and
  // `messageerror` for unserialisable messages — both translate to
  // a JSON-RPC stream we should treat as broken.
  const reader = new BrowserMessageReader(worker)
  const writer = new BrowserMessageWriter(worker)
  const connection = createMessageConnection(reader, writer)

  // DEBUG: enable verbose JSON-RPC tracing on every connection so
  // we can see every request/response/notification flowing both
  // directions.  Pair with the provider-side logs in
  // `lsp-shared/providers.ts` to triangulate where a hover hang is
  // happening (provider entry → outbound request → inbound
  // response → provider exit).
  const tracer: Tracer = {
    log(message: string, data?: string) {
      if (data) console.log(`${logPrefix}[rpc] ${message}`, data)
      else console.log(`${logPrefix}[rpc] ${message}`)
    },
  }
  void connection.trace(Trace.Verbose, tracer)

  // DEBUG: also surface generic worker-level message events so we
  // can see if the worker sends anything that isn't getting parsed
  // by vscode-jsonrpc.
  worker.addEventListener('message', (ev) => {
    console.log(`${logPrefix}[worker→host raw]`, ev.data)
  })

  let crashed = false
  const handleError = (ev: Event | ErrorEvent) => {
    // DEBUG: always log the raw event so we can tell `error` from
    // `messageerror` and inspect the payload.
    console.error(`${logPrefix}[debug] worker error event`, ev)
    if (crashed) return
    crashed = true
    const message = ev instanceof ErrorEvent ? ev.message : `${logPrefix} worker reported a non-Error event`
    const error = ev instanceof ErrorEvent && ev.error instanceof Error ? ev.error : new Error(message)
    connection.dispose()
    console.error(message, ev)
    try {
      onError?.(error)
    } catch (callbackErr) {
      // Don't let a user-supplied callback throwing during crash
      // recovery swallow the original failure — log it but keep
      // going so the transport itself ends up in a consistent state.
      console.error(`${logPrefix} onError callback threw:`, callbackErr)
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
