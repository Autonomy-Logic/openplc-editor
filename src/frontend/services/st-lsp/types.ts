// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Internal types for the STruC++ LSP service.
 *
 * Why a custom URI scheme: Monaco editor models are keyed by URI.
 * Real ST POU sources live in Zustand, not on disk, so we mint
 * synthetic URIs of the form `inmemory://pou/<name>.st`.  The LSP
 * worker treats these as workspace files and refers back to them
 * in diagnostics, definition results, etc.  Graphical POUs that
 * feed the worker as opaque-body stubs use `inmemory://stub/<name>.st`
 * so go-to-definition can recognise them and reroute to the
 * graphical editor instead of opening a useless synthetic source.
 */

import type { StlibSourcePort } from '../../../middleware/shared/ports/stlib-source-port'

/** URI scheme for live ST POU sources (real bodies). */
export const POU_URI_SCHEME = 'inmemory'
export const POU_URI_AUTHORITY = 'pou'

/** URI scheme for graphical-POU signature stubs. */
export const STUB_URI_AUTHORITY = 'stub'

/**
 * URI scheme for the variables-code-editor surface.  This Monaco
 * model only shows the VAR blocks of a POU — declarations live in
 * the body editor or get synthesized when the LSP doc is sent over.
 * Used so the LSP providers can recognise the vars-text view and
 * remap requests to the corresponding `pou://` document.
 */
export const POUVARS_URI_AUTHORITY = 'pouvars'

/**
 * URI for the synthesized `TYPE…END_TYPE` document carrying every
 * user-defined `PLCDataType` (structures, enumerations, arrays).
 * Strucpp parses this once at sync time so any POU that references
 * a user data type resolves it.  Single fixed URI per session — the
 * project's data-type set is global, not per-POU.
 */
export const DATA_TYPES_URI = 'inmemory://datatypes/__project__.st'

/** Public service the rest of the renderer talks to. */
export interface StLspService {
  /**
   * True once `initialize` has resolved and the worker is ready to
   * accept document notifications and queries.  Components that
   * depend on diagnostics being live should await `ready`.
   */
  readonly ready: Promise<void>

  /** Push (or refresh) the stlib archives the worker should see. */
  refreshStlibs(): Promise<void>

  /**
   * Notify the worker that a document is open.  Sends
   * `textDocument/didOpen`.  Subsequent edits flow through
   * `didChange`; close via `closeDocument`.
   */
  openDocument(uri: string, content: string): void

  /** Notify the worker of a content change in an already-open doc. */
  changeDocument(uri: string, content: string, version: number): void

  /** Notify the worker the document is no longer open. */
  closeDocument(uri: string): void

  /**
   * Tear the worker down.  After dispose the service rejects all
   * subsequent calls — start a new service if you need one.
   */
  dispose(): void
}

export interface StLspStartOptions {
  /** Source of .stlib archive payloads.  Worker fetches via RPC. */
  stlibSource: StlibSourcePort
  /**
   * Optional Monaco namespace.  In runtime this is `import('monaco-editor')`;
   * tests pass a stub so the registration calls become observable.
   * Leaving it `null` skips provider registration entirely — useful
   * for headless smoke tests of the transport layer.
   */
  monaco?: typeof import('monaco-editor') | null
  /**
   * Override the URL where the worker bundle lives.  Defaults to
   * the strucpp npm package's `dist/browser-server.js` resolved via
   * webpack's `?url` resource query.  Tests can pass a Blob URL.
   */
  workerUrlOverride?: string
  /**
   * Called when the worker emits an `error` or `messageerror` event
   * after initialize has resolved.  The transport disposes the
   * connection on its own — this callback exists so the renderer can
   * react (toast, sentry, etc.) instead of silently hanging on
   * subsequent requests.  Crashes during init reject `ready` and
   * don't reach this callback.
   */
  onCrash?: (err: Error) => void
}

/** Make a synthetic in-memory URI for a POU source. */
export function pouUri(name: string): string {
  return `${POU_URI_SCHEME}://${POU_URI_AUTHORITY}/${encodeURIComponent(name)}.st`
}

/** Make a synthetic in-memory URI for a graphical-POU signature stub. */
export function stubUri(name: string): string {
  return `${POU_URI_SCHEME}://${STUB_URI_AUTHORITY}/${encodeURIComponent(name)}.st`
}

/** Make a synthetic in-memory URI for a POU's variables-text view. */
export function pouVarsUri(name: string): string {
  return `${POU_URI_SCHEME}://${POUVARS_URI_AUTHORITY}/${encodeURIComponent(name)}.st`
}

/**
 * If `uri` is a `pouvars://` URI, return the POU name; otherwise null.
 * Used by the LSP providers to detect the variables-text surface and
 * route queries to the corresponding live `pou://` document.
 */
export function parsePouVarsUri(uri: string): string | null {
  const match = new RegExp(`^${POU_URI_SCHEME}://${POUVARS_URI_AUTHORITY}/(.+)\\.st$`).exec(uri)
  if (!match) return null
  return decodeURIComponent(match[1])
}

/**
 * Number of lines the synthesized declaration occupies before the
 * VAR blocks.  Currently always 1 ("PROGRAM main", "FUNCTION foo :
 * INT", etc.) — kept as a named constant so the providers and the
 * variables-code-editor share a single source of truth for the
 * Monaco-line → LSP-line shift.
 */
export const POU_DECLARATION_LINE_COUNT = 1

/**
 * Returns the POU name encoded in a URI minted by `pouUri` or
 * `stubUri`, or `null` if the URI doesn't match one of those
 * patterns.  Callers use this to map LSP definition / reference
 * URIs back to project entities.
 */
export function parsePouUri(uri: string): { kind: 'pou' | 'stub'; name: string } | null {
  const match = new RegExp(`^${POU_URI_SCHEME}://(${POU_URI_AUTHORITY}|${STUB_URI_AUTHORITY})/(.+)\\.st$`).exec(uri)
  if (!match) return null
  return {
    kind: match[1] === POU_URI_AUTHORITY ? 'pou' : 'stub',
    name: decodeURIComponent(match[2]),
  }
}
