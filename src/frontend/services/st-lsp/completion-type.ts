// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Extract the IEC type of a strucpp completion item.
 *
 * strucpp surfaces a symbol's type through the LSP completion item's
 * `detail` field. The exact shape is confirmed empirically against the
 * worker (see the scoped-query probe); this parser is intentionally
 * tolerant of the common renderings so a format tweak in the worker
 * degrades to "type unknown" rather than a wrong type.
 */

/**
 * Pull the type token out of a completion item's `detail`.
 *
 * Handles the shapes strucpp emits, e.g.:
 *   - `BOOL`                         → `BOOL`
 *   - `Q : BOOL`                     → `BOOL`
 *   - `VAR_OUTPUT Q : BOOL`          → `BOOL`
 *   - `my_struct : MyStruct`         → `MyStruct`
 *   - `(variable) TON0 : TON`        → `TON`
 *
 * Returns undefined when no plausible type can be recovered.
 */
export function parseScopedCompletionType(detail: string | undefined): string | undefined {
  if (!detail) return undefined
  const trimmed = detail.trim()
  if (!trimmed) return undefined

  // Prefer the segment after the last ` : ` — that's where ST renders a
  // declaration's type (`name : TYPE`). Fall back to the whole string.
  const colonIdx = trimmed.lastIndexOf(':')
  const candidate = (colonIdx >= 0 ? trimmed.slice(colonIdx + 1) : trimmed).trim()
  if (!candidate) return undefined

  // The type may be followed by array/length qualifiers (`ARRAY[..]`,
  // `STRING[80]`) — keep the leading identifier, which is what we match
  // for type compatibility.
  const match = candidate.match(/^[A-Za-z_][A-Za-z0-9_]*/)
  return match ? match[0] : undefined
}
