// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * One entry in a composed build bundle.
 *
 * Text is the common case, so a plain `string` stays it. The exception is a
 * `precompiled=true` library shipping a `.a`, whose bytes must reach the
 * compiler intact.
 *
 * A union rather than "a string that might be base64", so the compiler finds
 * every site that writes a bundle to disk: a missed one writes the base64 text
 * as the file's contents.
 */
export type BundleFile = string | { base64: string }

/** Whether this entry carries bytes rather than text. */
export function isBinaryBundleFile(file: BundleFile): file is { base64: string } {
  return typeof file !== 'string'
}
