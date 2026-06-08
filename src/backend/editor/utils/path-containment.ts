// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Filesystem path-containment guard for the Electron main process.
 *
 * Why this lives outside `backend/shared`:
 *
 *   The check exists to defend the local filesystem against
 *   manifest-supplied identifiers — e.g. a vendor package or
 *   user-installed library that sets `package.id = '../../etc/passwd'`
 *   and tricks the editor into resolving a path outside its packages
 *   directory.  That's an Electron-only concern; the web edition has
 *   no local filesystem to defend (uploads go through the compile-VM
 *   backend, which runs its own containment checks against its own
 *   storage).  Keeping this in `backend/editor/` means the shared
 *   layer stays free of `node:path` imports.
 *
 *   The companion identifier-shape rule (`checkPathId` /
 *   `validatePathId`) lives in `backend/shared/utils/path-safety.ts`
 *   because that's a pure regex check usable anywhere a string
 *   downstream might land as a path component — including
 *   `backend/shared/library/build-pipeline.ts`, which runs in either
 *   platform's runtime.
 */

import path from 'node:path'

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
    throw new Error(`${fieldName} resolves outside of ${parentResolved} (got ${childResolved})`)
  }
}
