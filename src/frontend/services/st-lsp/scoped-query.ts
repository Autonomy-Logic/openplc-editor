// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Scoped completion / type-resolution backed by the STruC++ LSP, for the
 * graphical (LD / FBD) editors.
 *
 * Graphical POUs have no ST body the LSP can see (their stub body is
 * opaque), so the graphical variable boxes can't use the normal Monaco
 * completion path. Instead this module drives the LSP directly: it
 * synthesizes a throwaway ST document that puts a partial expression in
 * the scope of the POU's real declarations, asks strucpp for completions
 * at that position, and returns the candidates — each carrying the IEC
 * type strucpp resolved for it. The graphical editors then filter those
 * candidates by the box's expected type and reuse the result for both
 * autocomplete and red/valid validation.
 *
 * The concrete implementation lives in `st-lsp/index.ts` (where the LSP
 * connection + document API are in scope) and registers itself here at
 * service start. Consumers reach it through {@link getScopedQueryApi};
 * when the LSP isn't available (tests, boot races, worker crash) the API
 * is null and callers degrade gracefully (no suggestions / skip
 * validation rather than false-flag).
 */

/** A single completion candidate resolved in a POU's scope. */
export interface ScopedCompletionItem {
  /** Display name of the symbol/member (e.g. `Q`, `MyVar`). */
  label: string
  /** Text to insert when this candidate is chosen. */
  insertText: string
  /**
   * The IEC type strucpp resolved for this candidate (e.g. `BOOL`,
   * `INT`, `TON`, a user struct/enum name), or undefined when strucpp
   * supplied no parseable type (e.g. keywords).
   */
  type?: string
  /** Raw LSP completion-item kind, when present. */
  kind?: number
  /** Raw LSP `detail` string, retained for debugging / fallback. */
  detail?: string
}

export interface ScopedQueryApi {
  /**
   * Completions for `prefix` evaluated in `pouName`'s scope. `prefix` is
   * the partial expression up to the cursor (e.g. `TON0.`, `my_struct.`,
   * or a bare partial like `to`). Returns [] if the LSP can't answer.
   */
  completeInScope(pouName: string, prefix: string): Promise<ScopedCompletionItem[]>
}

let api: ScopedQueryApi | null = null

/** Register (or clear, with null) the scoped-query implementation. Called by the LSP service. */
export function registerScopedQueryApi(next: ScopedQueryApi | null): void {
  api = next
}

/** The active scoped-query API, or null when the LSP isn't available. */
export function getScopedQueryApi(): ScopedQueryApi | null {
  return api
}
