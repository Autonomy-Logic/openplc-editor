// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Generic diagnostics bridge: subscribe to LSP
 * `publishDiagnostics` notifications and feed Monaco's marker
 * service.
 *
 * The primary route always lights up: every diagnostic the worker
 * publishes for a URI Monaco knows about lands on that model under
 * the `markerOwner` namespace (so other diagnostic sources — linter,
 * AI, etc. — stay segregated).  The body-line offset shifts
 * worker-frame line numbers back to Monaco's body-only view;
 * markers that would fall in the preamble end up at negative line
 * numbers and Monaco silently discards them, which is the right
 * outcome (no markers on lines the editor doesn't render).
 *
 * The optional `mirror` hook is for services that want to surface
 * the same diagnostics on auxiliary models — ST mirrors var-block
 * diagnostics to the variables-text editor's `pouvars://` URI so
 * the user sees red squiggles in both the body view and the
 * variables list.  Python LSP doesn't have an analogue, so it
 * leaves the hook unset.
 */

import type * as monaco from 'monaco-editor'
import {
  type MessageConnection,
  PublishDiagnosticsNotification,
  type PublishDiagnosticsParams,
} from 'vscode-languageserver-protocol'

import { getBodyLineOffset } from './body-offsets'
import { lspDiagnosticToMonaco } from './converters'

export interface DiagnosticsBridge {
  dispose(): void
}

/**
 * Hook to mirror diagnostics onto auxiliary Monaco models.  Called
 * once per `publishDiagnostics` notification.  Implementations
 * decide whether to mirror based on the LSP URI shape, and emit
 * additional `setModelMarkers` calls on whatever models they own.
 */
export type DiagnosticsMirror = (
  params: PublishDiagnosticsParams,
  ctx: { monacoApi: typeof monaco; markerOwner: string; bodyOffset: number; defaultSource: string },
) => void

export interface AttachDiagnosticsBridgeOptions {
  /** Marker-owner namespace (e.g. `'strucpp-lsp'`, `'python-lsp'`). */
  markerOwner: string
  /**
   * Fallback `source` on diagnostics that don't carry one — surfaces
   * in Monaco's hover as "from <source>".
   */
  defaultSource?: string
  /** Optional auxiliary-model mirror.  See {@link DiagnosticsMirror}. */
  mirror?: DiagnosticsMirror
  /**
   * Translate the LSP URI on an incoming `publishDiagnostics`
   * notification to the Monaco model URI the markers should apply
   * to.  Default: identity — most services' Monaco model URI is
   * the same string the worker sees.  Python LSP overrides this
   * because it appends `.py` to the URI it hands basedpyright (so
   * basedpyright treats the file as Python and publishes
   * diagnostics) while Monaco's model URI is the extension-less
   * path the rest of the editor uses.  Body-line offsets stay
   * keyed by the LSP URI — the translation only affects the
   * model-lookup step.
   */
  resolveModelUri?: (lspUri: string) => string
}

export function attachDiagnosticsBridge(
  connection: MessageConnection,
  monacoApi: typeof monaco,
  options: AttachDiagnosticsBridgeOptions,
): DiagnosticsBridge {
  const { markerOwner, defaultSource = 'lsp', mirror, resolveModelUri } = options

  const subscription = connection.onNotification(PublishDiagnosticsNotification.type, (params) => {
    const modelUri = resolveModelUri ? resolveModelUri(params.uri) : params.uri
    const bodyModel = monacoApi.editor.getModels().find((m) => m.uri.toString() === modelUri)
    const bodyOffset = getBodyLineOffset(params.uri)

    if (bodyModel) {
      monacoApi.editor.setModelMarkers(
        bodyModel,
        markerOwner,
        params.diagnostics.map((d) => lspDiagnosticToMonaco(d, monacoApi, bodyOffset, defaultSource)),
      )
    }

    mirror?.(params, { monacoApi, markerOwner, bodyOffset, defaultSource })
  })

  return {
    dispose() {
      subscription.dispose()
    },
  }
}
