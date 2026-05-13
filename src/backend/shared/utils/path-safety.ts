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
 * Validate that an identifier (manifest name, package id, …) is safe
 * to use as a filesystem path component.  Returns `null` on success,
 * or a human-readable error message on failure.  Non-throwing so
 * callers that need to accumulate multiple errors (manifest parsing,
 * batch validation) can collect them without try/catch around every
 * call — see `validatePathId` for the throwing form.
 *
 * The single source of truth for what "safe path id" means:
 *   1. Must be a non-empty string.
 *   2. Must not start with `.` (would shadow `.` / `..` traversal).
 *   3. Must match `SAFE_ID_RE`: `[a-zA-Z0-9._-]+`.
 */
export function checkPathId(id: unknown, fieldName: string): string | null {
  if (typeof id !== 'string' || id.length === 0) {
    return `${fieldName} is required and must be a non-empty string`
  }
  if (id.startsWith('.')) {
    return `${fieldName} must not start with '.' (got ${JSON.stringify(id)})`
  }
  if (!SAFE_ID_RE.test(id)) {
    return `${fieldName} contains disallowed characters; only [a-zA-Z0-9._-] are permitted (got ${JSON.stringify(id)})`
  }
  return null
}

/**
 * Validate a manifest-supplied identifier and throw on failure.
 * Thin wrapper around `checkPathId` so the throwing call sites
 * (`library-manager-module`, `package-manager-module`, the
 * compiler's path-id checks) share a single set of rules with the
 * non-throwing call sites (manifest parsing in `build-pipeline`).
 * Editing either form will break the other if the rules diverge.
 */
export function validatePathId(id: string, fieldName: string): void {
  const error = checkPathId(id, fieldName)
  if (error !== null) throw new Error(error)
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
