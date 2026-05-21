// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Per-URI body-line offset registry for the STruC++ LSP.
 *
 * The serializer feeding the worker prepends a preamble — the POU's
 * declaration line and every VAR block — before the body the user
 * actually edits.  Monaco's ST editor displays only that body, so
 * every line number the worker speaks (diagnostics, semantic tokens,
 * definition links, completion text edits, …) is N lines ahead of
 * Monaco's view, where N is the preamble's line count.
 *
 * This module is the canonical place where N lives per URI.  The
 * project-sync layer writes it on each serialize; providers and the
 * diagnostics bridge read it to shift LSP coordinates back into
 * Monaco's body-only frame.  Non-ST POUs (graphical, IL, hybrid)
 * also have a preamble but Monaco doesn't open their bodies, so the
 * offset is irrelevant — they still register, just never get read.
 */

const offsets = new Map<string, number>()

/** Record the body-line offset for an LSP document URI. */
export function setBodyLineOffset(uri: string, offset: number): void {
  offsets.set(uri, offset)
}

/**
 * Look up the body-line offset for an LSP document URI.  Returns 0
 * when the URI is unknown — the conservative default that leaves
 * line numbers unchanged, so providers don't crash if a stale
 * Monaco model queries before project-sync registers the POU.
 */
export function getBodyLineOffset(uri: string): number {
  return offsets.get(uri) ?? 0
}

/** Drop the offset for a URI (called on document close). */
export function deleteBodyLineOffset(uri: string): void {
  offsets.delete(uri)
}

/** Test-only — clears the entire map between runs. */
export function __clearBodyLineOffsetsForTests(): void {
  offsets.clear()
}
