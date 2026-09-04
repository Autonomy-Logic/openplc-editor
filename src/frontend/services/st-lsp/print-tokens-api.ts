// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Body-relative ST semantic tokens for an arbitrary POU, for the
 * export-to-PDF text renderer.
 *
 * ST has no Monarch tokenizer (see `st.register.ts`) — the LSP semantic-
 * tokens response is the *only* source of ST colorisation, live editor
 * included. The print export needs this for POUs that may not have a
 * mounted Monaco model (the user can print a POU without ever opening its
 * tab), so it can't ride the `IDocumentSemanticTokensProvider` Monaco
 * queries for a live model — it asks the LSP connection directly.
 *
 * Same reach-the-boot-time-singleton problem `scoped-query.ts` solves for
 * completions; same fix — the concrete implementation lives in
 * `st-lsp/index.ts` (where the LSP connection is in scope) and registers
 * itself here at service start. Consumers reach it through
 * {@link getPrintSemanticTokensApi}; null when the LSP isn't available
 * (tests, boot races, worker crash, or the server never advertised the
 * capability) — callers degrade to uncolored text rather than false-flag.
 */

import type * as monaco from 'monaco-editor'

export type PrintSemanticTokens = {
  legend: monaco.languages.SemanticTokensLegend
  /** Delta-encoded, already shifted to the POU body's line frame (declaration preamble dropped). */
  data: Uint32Array
}

export interface PrintSemanticTokensApi {
  /** Body-relative semantic tokens for `pouName`'s ST source, or null if unavailable. */
  requestBodySemanticTokens(pouName: string): Promise<PrintSemanticTokens | null>
}

let api: PrintSemanticTokensApi | null = null

/** Register (or clear, with null) the implementation. Called by the ST LSP service. */
export function registerPrintSemanticTokensApi(next: PrintSemanticTokensApi | null): void {
  api = next
}

/** The active API, or null when the ST LSP isn't available. */
export function getPrintSemanticTokensApi(): PrintSemanticTokensApi | null {
  return api
}
