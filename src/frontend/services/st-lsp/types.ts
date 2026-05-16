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
}

/** Make a synthetic in-memory URI for a POU source. */
export function pouUri(name: string): string {
  return `${POU_URI_SCHEME}://${POU_URI_AUTHORITY}/${encodeURIComponent(name)}.st`
}

/** Make a synthetic in-memory URI for a graphical-POU signature stub. */
export function stubUri(name: string): string {
  return `${POU_URI_SCHEME}://${STUB_URI_AUTHORITY}/${encodeURIComponent(name)}.st`
}

/**
 * Returns the POU name encoded in a URI minted by `pouUri` or
 * `stubUri`, or `null` if the URI doesn't match one of those
 * patterns.  Callers use this to map LSP definition / reference
 * URIs back to project entities.
 */
export function parsePouUri(
  uri: string,
): { kind: 'pou' | 'stub'; name: string } | null {
  const match = new RegExp(
    `^${POU_URI_SCHEME}://(${POU_URI_AUTHORITY}|${STUB_URI_AUTHORITY})/(.+)\\.st$`,
  ).exec(uri)
  if (!match) return null
  return {
    kind: match[1] === POU_URI_AUTHORITY ? 'pou' : 'stub',
    name: decodeURIComponent(match[2]),
  }
}
