// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Generic semantic-tokens provider registration.
 *
 * Split from the rest of the providers because Monaco's
 * `IDocumentSemanticTokensProvider` needs the legend (token-type /
 * modifier names) synchronously from `getLegend()`, but the legend
 * is only known after the LSP `initialize` handshake resolves with
 * the server's capabilities.  The orchestrator captures the result
 * and calls this once it has the legend in hand.
 *
 * `releaseDocumentSemanticTokens` is a no-op: today's workers (the
 * strucpp browser server, browser-basedpyright) only answer
 * `textDocument/semanticTokens/full` — no delta protocol, no
 * per-result state to free.
 */

import type * as monaco from 'monaco-editor'
import { type MessageConnection, type SemanticTokens, SemanticTokensRequest } from 'vscode-languageserver-protocol'

import { getBodyLineOffset } from './body-offsets'
import { shiftSemanticTokensToBody } from './internal/semantic-tokens-shift'
import type { LspContext } from './providers'

export interface SemanticTokensRegistration extends monaco.IDisposable {
  /**
   * Tell Monaco to re-query semantic tokens for every model in the
   * language.  Used by the boot path after initial registration (so
   * already-mounted models get tokens once the provider is alive)
   * and by the LSP refresh request handler when the server finishes
   * background analysis.
   */
  refresh(): void
}

/**
 * Resolve the LSP-coordinate window the body view should keep.  The
 * default keeps everything from `[lineOffset, +∞)` — drop the
 * preamble, keep the rest.  ST's variables-text view overrides this
 * to clip the end at the body line so only VAR-block tokens render.
 */
export type ResolveSemanticTokensViewport = (
  lspUri: string,
  modelUri: string,
  lineOffset: number,
) => { startLine: number; endLineExclusive: number }

const defaultViewport: ResolveSemanticTokensViewport = (_lspUri, _modelUri, lineOffset) => ({
  startLine: lineOffset,
  endLineExclusive: Number.POSITIVE_INFINITY,
})

export interface RegisterLspSemanticTokensOptions {
  connection: MessageConnection
  monacoApi: typeof monaco
  languageId: string
  legend: monaco.languages.SemanticTokensLegend
  /** Resolve the URI + offset for a given model URI.  Same hook as in providers. */
  resolveLspContext?: (modelUri: string) => LspContext
  /** Window the body view keeps — defaults to `[lineOffset, +∞)`. */
  resolveViewport?: ResolveSemanticTokensViewport
}

const defaultResolveLspContext = (modelUri: string): LspContext => ({
  lspUri: modelUri,
  lineOffset: getBodyLineOffset(modelUri),
})

export function registerLspSemanticTokens(opts: RegisterLspSemanticTokensOptions): SemanticTokensRegistration {
  const { connection, monacoApi, languageId, legend } = opts
  const resolveLspContext = opts.resolveLspContext ?? defaultResolveLspContext
  const resolveViewport = opts.resolveViewport ?? defaultViewport

  // Emitter Monaco subscribes to via `onDidChange` to know when to
  // re-tokenise every model in this language.
  const changeEmitter = new monacoApi.Emitter<void>()
  const providerDisposable = monacoApi.languages.registerDocumentSemanticTokensProvider(languageId, {
    getLegend() {
      return legend
    },
    onDidChange: changeEmitter.event,
    async provideDocumentSemanticTokens(model): Promise<monaco.languages.SemanticTokens | null> {
      const modelUri = model.uri.toString()
      const { lspUri, lineOffset } = resolveLspContext(modelUri)
      const result: SemanticTokens | null = await connection.sendRequest(SemanticTokensRequest.type, {
        textDocument: { uri: lspUri },
      })
      if (!result) return null
      const { startLine, endLineExclusive } = resolveViewport(lspUri, modelUri, lineOffset)
      return {
        ...(result.resultId ? { resultId: result.resultId } : {}),
        data: shiftSemanticTokensToBody(result.data, startLine, endLineExclusive),
      }
    },
    releaseDocumentSemanticTokens() {
      /* no-op */
    },
  })
  // Microtask defer so the registration has fully propagated into
  // Monaco's internal language-features registry before we tell it
  // to refresh.
  queueMicrotask(() => changeEmitter.fire())
  return {
    refresh() {
      changeEmitter.fire()
    },
    dispose() {
      providerDisposable.dispose()
      changeEmitter.dispose()
    },
  }
}
