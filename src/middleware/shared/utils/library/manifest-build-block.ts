// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * The `build` block in a library project's `library.json`.
 *
 * Authoring-side settings — which toolchain the library is verified with —
 * kept in the manifest because a library project has no device screen to hang
 * them on.  They stay out of the `.stlib`: `decorateArchive` copies named
 * fields onto the archive and this is not one of them, so a consumer never
 * sees the author's verify target.
 *
 * One implementation, two readers: the build reads it through
 * `parseVerifyTarget` (errors fail the build) and the Build Settings dialog
 * both reads and writes it through `withVerifyTarget`.
 */

import type { LibraryVerifyTarget } from '../../ports/library-build-port'

/** Manifest key the dialog writes. */
export const BUILD_KEY = 'build'

/** Modes the dialog offers, in the order it lists them. */
export const VERIFY_MODES = ['arduino', 'runtime', 'off'] as const

/** What a manifest with no `build` block means. */
export const DEFAULT_VERIFY_TARGET: LibraryVerifyTarget = { mode: 'arduino' }

export type ParseVerifyTargetResult = { target: LibraryVerifyTarget } | { errors: string[] }

/**
 * Read `build.verify` / `build.core` off a parsed manifest object.  Returns
 * the default target when the block is absent, and errors when it is present
 * but malformed — a typo that silently verified against a different toolchain
 * would report on something the author never asked about.
 *
 * A `core` naming a toolchain that is not installed is NOT an error here: the
 * build warns and falls back, the same way an uninstalled board does.
 */
export function parseVerifyTarget(manifest: Record<string, unknown>): ParseVerifyTargetResult {
  const raw = manifest[BUILD_KEY]
  if (raw === undefined) return { target: DEFAULT_VERIFY_TARGET }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { errors: [`manifest.${BUILD_KEY} must be a JSON object`] }
  }

  const build = raw as Record<string, unknown>
  const errors: string[] = []

  let mode: LibraryVerifyTarget['mode'] = DEFAULT_VERIFY_TARGET.mode
  if (build.verify !== undefined) {
    if (!VERIFY_MODES.includes(build.verify as (typeof VERIFY_MODES)[number])) {
      errors.push(
        `manifest.${BUILD_KEY}.verify must be one of ${VERIFY_MODES.join(', ')}. Got: ${JSON.stringify(build.verify)}`,
      )
    } else {
      mode = build.verify as LibraryVerifyTarget['mode']
    }
  }

  let core: string | undefined
  if (build.core !== undefined) {
    if (typeof build.core !== 'string' || build.core.length === 0) {
      errors.push(`manifest.${BUILD_KEY}.core must be a non-empty string. Got: ${JSON.stringify(build.core)}`)
    } else {
      core = build.core
    }
  }

  if (errors.length > 0) return { errors }
  return { target: core ? { mode, core } : { mode } }
}

/**
 * `manifestJson` with the `build` block set to `target`.  Returns null when
 * the text is not a JSON object, so the dialog can say so instead of
 * overwriting a manifest the user is midway through editing.
 *
 * The whole document is re-serialised at two-space indent — the shape the
 * editor writes it in — so hand-applied formatting is normalised.  Key order
 * survives, and JSON carries no comments to lose.
 */
export function withVerifyTarget(manifestJson: string, target: LibraryVerifyTarget): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(manifestJson)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null

  const manifest = parsed as Record<string, unknown>
  const build: Record<string, unknown> = {
    // Preserve anything else the block carries: this owns two keys, not the
    // whole object.
    ...((typeof manifest[BUILD_KEY] === 'object' && manifest[BUILD_KEY] !== null && !Array.isArray(manifest[BUILD_KEY])
      ? manifest[BUILD_KEY]
      : {}) as Record<string, unknown>),
    verify: target.mode,
  }
  // The core is remembered across a mode change, so switching back to Arduino
  // does not lose the choice.
  if (target.core) build.core = target.core
  else delete build.core

  manifest[BUILD_KEY] = build
  return JSON.stringify(manifest, null, 2) + '\n'
}
