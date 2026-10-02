// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * What a folder under `resources/` contributes to the library it holds.
 *
 * The picker is aimed at a checkout, so the folder arrives with `build/`,
 * `.git/`, `test/` and the rest alongside the library. An allow-list rather
 * than an exclusion list, because the allowed set is already fixed by the two
 * consumers: arduino-cli compiles a 1.5-format library from its `src/`, and the
 * Runtime v4 Makefile puts `<folder>/src` on the include path.
 *
 * Shared so the picker and the build walk the folder by the same rule.
 */

/** The file that makes a folder an Arduino library rather than a directory. */
export const LIBRARY_PROPERTIES = 'library.properties'

/** The only directory a library's sources are read from. */
export const LIBRARY_SRC_DIR = 'src'

/** The rule, in one sentence, for a message that has to explain a refusal. */
export const LIBRARY_FOLDER_RULE = `a library folder ships ${LIBRARY_PROPERTIES} and everything under ${LIBRARY_SRC_DIR}/`

/**
 * Whether a path inside a library folder is part of the library.
 *
 * `relPath` is relative to the folder itself and `/`-separated.
 */
export function isLibraryFile(relPath: string): boolean {
  return relPath === LIBRARY_PROPERTIES || relPath.startsWith(`${LIBRARY_SRC_DIR}/`)
}

/**
 * Whether a directory inside a library folder can hold library files, and is
 * therefore worth descending into.
 *
 * `''` is the folder root, which holds `library.properties` and `src` itself.
 */
export function isLibraryDir(relDir: string): boolean {
  return relDir === '' || relDir === LIBRARY_SRC_DIR || relDir.startsWith(`${LIBRARY_SRC_DIR}/`)
}
