// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Per-URI body-line offset registry, shared by every LSP service.
 *
 * A "body offset" is the number of lines a language service prepends
 * to a document before handing it to its worker, but that the user
 * never sees in Monaco.  The two production cases today are:
 *
 *   - **ST LSP**: the serializer prepends the POU's declaration line
 *     and every VAR block before the body the user edits in the
 *     Monaco code editor.  The worker sees the full synthesized doc;
 *     Monaco shows only the body slice.
 *   - **Python LSP**: a synthetic preamble declares the project's
 *     IEC `input` / `output` variables as Python globals so Pyright
 *     doesn't surface them as "undefined" — same idea, different
 *     content.
 *
 * Both services route every LSP coordinate through this registry to
 * translate between the worker's full-document frame and Monaco's
 * body-only view.  When a URI is unknown the offset is 0, which
 * leaves the coordinate untouched — the conservative default for
 * documents that simply don't have a preamble.
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
 * Monaco model queries before the document is registered.
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
