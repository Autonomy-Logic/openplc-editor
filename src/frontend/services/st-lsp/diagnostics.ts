// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Pipe LSP `publishDiagnostics` notifications into Monaco's marker
 * service.  Each ST model receives markers under the owner
 * `'strucpp-lsp'` so other diagnostic sources (linter, AI, etc.)
 * stay segregated.
 */

import type * as monaco from 'monaco-editor'
import {
  type MessageConnection,
  PublishDiagnosticsNotification,
} from 'vscode-languageserver-protocol'

import { getBodyLineOffset } from './body-offsets'
import { lspDiagnosticToMonaco } from './converters'

const MARKER_OWNER = 'strucpp-lsp'

export interface DiagnosticsBridge {
  dispose(): void
}

export function attachDiagnosticsBridge(
  connection: MessageConnection,
  monacoApi: typeof monaco,
): DiagnosticsBridge {
  const subscription = connection.onNotification(
    PublishDiagnosticsNotification.type,
    (params) => {
      const model = monacoApi.editor
        .getModels()
        .find((m) => m.uri.toString() === params.uri)
      if (!model) return
      // Worker emits diagnostics in full-document coordinates; the
      // body-line offset shifts them back to Monaco's body-only view.
      // Diagnostics that fall in the preamble end up with negative
      // line numbers — Monaco's marker service silently discards
      // those, which is the right outcome (we can't show a marker on
      // a line the editor doesn't render).
      const offset = getBodyLineOffset(params.uri)
      monacoApi.editor.setModelMarkers(
        model,
        MARKER_OWNER,
        params.diagnostics.map((d) => lspDiagnosticToMonaco(d, monacoApi, offset)),
      )
    },
  )
  return {
    dispose() {
      subscription.dispose()
    },
  }
}
