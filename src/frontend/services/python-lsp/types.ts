// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Public type surface for the Python LSP service.
 */

import type * as monaco from 'monaco-editor'

import type { PLCVariable } from '../../../middleware/shared/ports/types'

export interface PythonLspStartOptions {
  /**
   * URL of basedpyright's worker bundle.  Required — there is no
   * in-module fallback: a bare `require('…/pyright.worker.js?url')`
   * works under webpack's resource-loader rule but Vite emits the
   * literal `require` call into the bundle, which crashes at
   * runtime with `Can't find variable: require`.  Each host
   * resolves the URL with its own bundler (`?url` import on Vite,
   * the same on webpack 5 with `asset/resource`) and passes the
   * resolved string in.  Tests pass `'about:blank'` (or any other
   * placeholder) to bypass worker creation entirely.
   */
  workerUrl: string
  /**
   * Monaco namespace.  Required for any provider registration to
   * happen.  Omit from the boot path that runs before Monaco loads
   * — the service still wires the protocol-level handlers, just
   * with no UI surface.
   */
  monaco?: typeof monaco
  /**
   * Post-`initialize` worker crash callback.  Surfaces in the UI
   * as a one-shot toast.  Pre-init crashes don't go through this
   * — they reject the service's `ready` promise instead.
   */
  onCrash?: (err: Error) => void
}

export interface PythonLspService {
  /** Resolves after `initialize`.  Rejects if the worker fails before then. */
  ready: Promise<void>

  /**
   * Attach a Python POU.  Generates a preamble from the POU's
   * variables and pushes the augmented document (preamble + body)
   * to Pyright.  Re-records the body-line offset in the shared
   * registry so every coordinate the providers see is already in
   * Monaco's body-only frame.
   *
   * `pouName` is recorded alongside the preamble so the
   * definition-redirect interceptor can hand it to
   * `routeToPouPreamble` / `routeToPouBody` when a Go to Definition
   * target lands in this URI.  Without it, the redirect can't open
   * the right POU tab.
   */
  attachPou(uri: string, pouName: string, variables: PLCVariable[], bodyText: string): void

  /**
   * Push a new body version for an already-attached POU.  Preamble
   * stays the same — only the body content changed.
   */
  notifyBodyChange(uri: string, bodyText: string): void

  /**
   * Variables list changed: regenerate the preamble, update the
   * shared offset registry, and push the new augmented document.
   * Bumps the LSP document version.
   */
  notifyVariablesChange(uri: string, variables: PLCVariable[], bodyText: string): void

  /** Send `textDocument/didClose` and drop the preamble entry. */
  detachPou(uri: string): void

  /** Tear down the worker + providers. */
  dispose(): void
}
