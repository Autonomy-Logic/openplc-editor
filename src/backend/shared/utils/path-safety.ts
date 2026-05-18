// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Identifier-shape validation at the boundary where untrusted input
 * (e.g. fields from a `.vpp` package's manifest, a library archive
 * manifest, an IPC payload) is combined with filesystem paths.
 *
 * Lives in `backend/shared/` because the library-build pipeline
 * (`backend/shared/library/build-pipeline.ts`) runs in either
 * platform's runtime and needs the same validation rule.  The pure
 * regex check has no Node dependency.
 *
 * The companion path-containment check (`assertPathContained`)
 * lives in `backend/editor/utils/path-containment.ts` — it's
 * Electron-only because the web edition has no local filesystem
 * to defend.
 *
 * Closes one failure mode at the entry point:
 *
 *   Identifier injection — a manifest sets `package.id` to
 *   `"../../something"` and downstream code resolves it under its
 *   packages directory; a later `rm -rf` then deletes whatever
 *   sits at the resolved path.
 */

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
