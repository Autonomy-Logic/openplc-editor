// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Path-safety helpers used at the boundary where untrusted input
 * (e.g. fields from a `.vpp` package's manifest, IPC payloads) is
 * combined with filesystem paths.
 *
 * Two failure modes to close:
 *
 *   1. Identifier injection — a manifest sets `package.id` to
 *      `"../../something"` and the editor resolves it under its
 *      packages directory; a downstream `rm -rf` then deletes
 *      whatever sits at the resolved path.
 *
 *   2. Path traversal — a manifest sets `image: "../../etc/passwd"`
 *      or similar and a `readFile` call hands the file contents back
 *      across the IPC boundary.
 *
 * The two helpers below reject both at the entry point. Both throw
 * on rejection rather than returning a boolean — boolean callers tend
 * to forget the negation and use the value anyway.
 */

import path from 'node:path'

/** Allowed shape for identifiers used as filesystem path components.
 *  Conservative on purpose: alphanumerics, dot, underscore, hyphen.
 *  Disallows `/`, `\`, leading dots (`.`/`..`), and any control chars. */
const SAFE_ID_RE = /^[a-zA-Z0-9._-]+$/

/**
 * Validate a manifest-supplied identifier that will be used as a
 * filesystem path component. Throws if the value violates the regex,
 * is empty, or starts with a dot (which would shadow `.` / `..`).
 */
export function validatePathId(id: string, fieldName: string): void {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`${fieldName} is required and must be a non-empty string`)
  }
  if (id.startsWith('.')) {
    throw new Error(`${fieldName} must not start with '.' (got ${JSON.stringify(id)})`)
  }
  if (!SAFE_ID_RE.test(id)) {
    throw new Error(
      `${fieldName} contains disallowed characters; only [a-zA-Z0-9._-] are permitted (got ${JSON.stringify(id)})`,
    )
  }
}

/**
 * Assert that `child` resolves to a path inside `parent`. Both inputs
 * are normalised through `path.resolve` before comparison so symlinks
 * in `parent` itself won't trick the check (the contract here is
 * "deny lexical traversal", not "deny TOCTOU symlink races").
 *
 * Throws with the expected vs actual paths so callers can surface a
 * useful error.
 */
export function assertPathContained(parent: string, child: string, fieldName: string): void {
  const parentResolved = path.resolve(parent)
  const childResolved = path.resolve(child)
  const rel = path.relative(parentResolved, childResolved)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(
      `${fieldName} resolves outside of ${parentResolved} (got ${childResolved})`,
    )
  }
}
