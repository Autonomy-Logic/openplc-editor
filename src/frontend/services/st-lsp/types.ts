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
 * URI scheme for the per-type `.dt` code view. Like `pouvars://`, the
 * LSP never indexes it — requests remap onto `DATA_TYPES_URI` with the
 * type's line span as the offset.
 */
export const DTVIEW_URI_AUTHORITY = 'dtview'

/**
 * URI for the synthesized `TYPE…END_TYPE` document carrying every
 * user-defined `PLCDataType` (structures, enumerations, arrays).
 * Strucpp parses this once at sync time so any POU that references
 * a user data type resolves it.  Single fixed URI per session — the
 * project's data-type set is global, not per-POU.
 */
export const DATA_TYPES_URI = 'inmemory://datatypes/__project__.st'

/**
 * URI for the synthesized SoftMotion axis globals document — a
 * `VAR_GLOBAL <axis> : AXIS_REF_SM3` per recognized CiA 402 drive, so editor
 * code referencing an axis (`MC_Power(Axis := X_Axis)`) resolves against the
 * same public axis the compiler generates, without the user declaring it.
 * Single fixed URI per session; the axis set is project-global.
 */
export const SOFTMOTION_GLOBALS_URI = 'inmemory://softmotion/__axes__.st'

/**
 * URI for the synthesized resource-globals document — the project's
 * configuration-level `VAR_GLOBAL`s wrapped in a `CONFIGURATION` block, so a
 * POU's `VAR_EXTERNAL` resolves against a matching global (strucpp requires a
 * configuration-scoped global for that). Single fixed URI per session.
 */
export const RESOURCE_GLOBALS_URI = 'inmemory://globals/__resource__.st'

/**
 * URI for the synthesized Global-Variable-List document — one STRUCT type per list plus a
 * global instance of each, which is exactly what the compiler generates for them.
 *
 * Emitted as a **bare top-level `VAR_GLOBAL` block**, the same way the SoftMotion axes are:
 * strucpp puts top-level globals in the ambient scope, so `GVL.Output1` resolves from any POU
 * without a `VAR_EXTERNAL` — and the user's own documents stay byte-for-byte what they wrote.
 * (The compiler needs those externals because it puts the instances inside a CONFIGURATION;
 * here they are ambient, so it does not.)
 *
 * Single fixed URI per session; the lists are project-global.
 */
export const GLOBAL_VARIABLE_LISTS_URI = 'inmemory://globals/__lists__.st'

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

  /**
   * Notify the worker of a content change in an already-open doc.
   *
   * `version` is optional and usually better omitted: `openDocument` sets
   * version 1, so a caller-side counter starting at 1 collides on the first
   * edit and the worker drops it. Omitting it lets the service advance its own
   * per-URI counter. Pass one only with a genuinely monotonic project-wide
   * counter, as `project-sync` has.
   */
  changeDocument(uri: string, content: string, version?: number): void

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
  return decodeUriSegment(match[1])
}

/** Make a synthetic in-memory URI for a data type's `.dt` code view. */
export function dtViewUri(name: string): string {
  return `${POU_URI_SCHEME}://${DTVIEW_URI_AUTHORITY}/${encodeURIComponent(name)}.dt`
}

/** If `uri` is a `dtview://` URI, return the data type name; otherwise null. */
export function parseDtViewUri(uri: string): string | null {
  const match = new RegExp(`^${POU_URI_SCHEME}://${DTVIEW_URI_AUTHORITY}/(.+)\\.dt$`).exec(uri)
  if (!match) return null
  return decodeUriSegment(match[1])
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
 * Lines the `.dt` code view renders before the type's own declaration —
 * its local `TYPE` frame line. The aggregate document has the same
 * frame, so a type's shift between the two is `span.start - DT_VIEW_FRAME_LINE_COUNT`.
 */
export const DT_VIEW_FRAME_LINE_COUNT = 1

/**
 * Decode a name segment out of a synthetic URI, or `null` when the
 * encoding is malformed. These parsers run on every model URI the LSP
 * providers see, so a bare `decodeURIComponent` would turn a stray
 * `%ZZ` into a thrown `URIError` and take hover / completion down with
 * it for that model.
 */
function decodeUriSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

/**
 * Returns the POU name encoded in a URI minted by `pouUri` or
 * `stubUri`, or `null` if the URI doesn't match one of those
 * patterns.  Callers use this to map LSP definition / reference
 * URIs back to project entities.
 */
export function parsePouUri(uri: string): { kind: 'pou' | 'stub'; name: string } | null {
  const match = new RegExp(`^${POU_URI_SCHEME}://(${POU_URI_AUTHORITY}|${STUB_URI_AUTHORITY})/(.+)\\.st$`).exec(uri)
  if (!match) return null
  const name = decodeUriSegment(match[2])
  if (name === null) return null
  return { kind: match[1] === POU_URI_AUTHORITY ? 'pou' : 'stub', name }
}
