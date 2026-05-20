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
  type Diagnostic,
  type MessageConnection,
  PublishDiagnosticsNotification,
} from 'vscode-languageserver-protocol'

import { getBodyLineOffset } from './body-offsets'
import { lspDiagnosticToMonaco } from './converters'
import { parsePouUri, POU_DECLARATION_LINE_COUNT, pouVarsUri } from './types'

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
      const bodyModel = monacoApi.editor
        .getModels()
        .find((m) => m.uri.toString() === params.uri)
      const bodyOffset = getBodyLineOffset(params.uri)

      if (bodyModel) {
        // Worker emits diagnostics in full-document coordinates; the
        // body-line offset shifts them back to Monaco's body-only view.
        // Diagnostics that fall in the preamble end up with negative
        // line numbers — Monaco's marker service silently discards
        // those, which is the right outcome (we can't show a marker on
        // a line the editor doesn't render).
        monacoApi.editor.setModelMarkers(
          bodyModel,
          MARKER_OWNER,
          params.diagnostics.map((d) => lspDiagnosticToMonaco(d, monacoApi, bodyOffset)),
        )
      }

      // Mirror diagnostics that fall inside the VAR block range to
      // the variables-text editor for the same POU (if one is
      // mounted).  The variables-code-editor uses a separate Monaco
      // model under `pouvars://<name>.st` and would otherwise show
      // no markers — strucpp never publishes against that URI.  We
      // shift by the declaration's line count (1) so the VAR_INPUT
      // line aligns with Monaco line 1 of the variables editor.
      const parsed = parsePouUri(params.uri)
      if (parsed) {
        const varsModel = monacoApi.editor
          .getModels()
          .find((m) => m.uri.toString() === pouVarsUri(parsed.name))
        if (varsModel) {
          const varDiagnostics: Diagnostic[] = params.diagnostics.filter(
            (d) => d.range.start.line >= POU_DECLARATION_LINE_COUNT && d.range.start.line < bodyOffset,
          )
          monacoApi.editor.setModelMarkers(
            varsModel,
            MARKER_OWNER,
            varDiagnostics.map((d) => lspDiagnosticToMonaco(d, monacoApi, POU_DECLARATION_LINE_COUNT)),
          )
        }
      }
    },
  )
  return {
    dispose() {
      subscription.dispose()
    },
  }
}
