// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Zod schema for PackageManifest at the editor's trust boundary.
 *
 * Design intent: the editor is agnostic to what a VPP carries inside
 * its manifest. Authoring-side strictness lives in openplc-packages
 * (the canonical, vendor-internal VPP builder); at install / load
 * time the editor enforces only the minimum needed to:
 *
 *   1. Confirm the document is shaped roughly like a manifest, so a
 *      random JSON file is rejected with a clear error rather than
 *      crashing deep in the loader with `undefined.devices.map(...)`.
 *
 *   2. Sanity-type the few fields that drive security-critical
 *      decisions — `package.id` becomes a filesystem path; `version`
 *      drives upgrade comparisons. These fields are also guarded at
 *      use sites by `validatePathId` / `assertPathContained` in
 *      `src/backend/shared/utils/path-safety.ts`; the schema is a
 *      thin defence in depth.
 *
 * Everything else — device fields, per-module config screens, vendor
 * extension blocks, future format additions — flows through untouched
 * via `.passthrough()`. New VPP features therefore do not require an
 * editor release: the editor's *transport* surface is fully
 * extensible, and only the *interpretation* surface (layout
 * dispatcher, field renderer, encoder rules) needs a build when a
 * brand-new vocabulary is introduced.
 *
 * The TypeScript `PackageManifest` interface in `./types.ts` remains
 * the source of truth for what the editor code *reads*; the schema
 * below controls only what it *rejects*.
 */

import { z } from 'zod'

import { isValidVersion } from '../../../frontend/utils/semver'
import type { PackageManifest } from './types'

/**
 * A compatibility floor must be a version this codebase can compare.
 *
 * This is the exception to the "the editor is agnostic to manifest
 * contents" rule above, and it earns it: an unreadable floor is not
 * inert, it is a constraint the package author believes is being
 * enforced and which silently is not. `"4.3"`, `"4"` and `"v5"` are all
 * accepted — they mean 4.3.0 / 4.0.0 / 5.0.0 — so in practice only
 * genuine junk (`"garbage"`, `"next"`, `"4,3,0"`) is refused.
 *
 * It matters most for the path this gate exists for: a `.vpp` added
 * from disk never passes through openplc-packages' `scripts/validate.ts`,
 * so for sideloaded packages this schema is the only boundary there is.
 *
 * Refusing applies to the artefact ENTERING the editor. Reading a
 * package that is already installed goes through
 * `parseInstalledPackageManifest` below, which drops such a floor
 * instead of rejecting the manifest around it.
 */
const versionFloor = z
  .string()
  .min(1)
  .refine(isValidVersion, { message: 'must be a version like "4.3.2", "4.3", "4" or "v4.3.2"' })

export const PackageManifestSchema = z
  .object({
    formatVersion: z.string().min(1),
    package: z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
        version: z.string().min(1),
        // Compatibility floors (DOPE-448). Optional on purpose: packages built
        // before these fields existed must keep installing, and a package that
        // declares no floor declares no constraint. They are typed here rather
        // than left to `.passthrough()` because the install gate compares them
        // — a field a gate reads should not reach it as `unknown`.
        //
        // Authoring-side rules (minRuntimeVersion required iff a device targets
        // runtime-v4, rejected otherwise) live in openplc-packages'
        // `scripts/validate.ts`, per this file's split of responsibilities.
        // The *format* is checked here because a floor nobody can parse is a
        // constraint that silently does not apply — see `versionFloor`.
        minEditorVersion: versionFloor.optional(),
        minRuntimeVersion: versionFloor.optional(),
      })
      .passthrough(),
    devices: z.array(z.object({}).passthrough()).min(1),
  })
  .passthrough()

/**
 * Validate an unknown value as a PackageManifest. Returns the typed
 * value on success, null + logs on failure. Callers should treat null
 * as "this manifest is unusable" — never as "no manifest present"
 * (use a separate undefined check for that).
 */
export function parsePackageManifest(value: unknown): PackageManifest | null {
  const parsed = PackageManifestSchema.safeParse(value)
  if (!parsed.success) {
    console.warn('[package-manifest] schema validation failed:', parsed.error.message)
    return null
  }
  // The inferred Zod type is intentionally narrower than `PackageManifest`
  // (only the minimum fields are declared in the schema). Cast through
  // `unknown` so the consumer-side TypeScript shape still reflects what
  // editor code reads — at the cost of trusting authoring-side
  // validation in openplc-packages for the deeper fields.
  return parsed.data as unknown as PackageManifest
}

/** The manifest fields `versionFloor` guards, as read by the load path. */
const FLOOR_FIELDS: readonly string[] = ['minEditorVersion', 'minRuntimeVersion']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A floor that is absent constrains nothing; one that is present must be comparable. */
function isUsableFloor(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && isValidVersion(value))
}

/**
 * Return `value` with any compatibility floor this codebase cannot
 * compare removed, logging each one. Anything else is passed through
 * untouched, including a shape that is not a manifest at all — deciding
 * that is the schema's job, not this function's.
 */
function withComparableFloorsOnly(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.package)) return value

  const kept: Record<string, unknown> = {}
  let droppedAny = false
  for (const [field, fieldValue] of Object.entries(value.package)) {
    if (FLOOR_FIELDS.includes(field) && !isUsableFloor(fieldValue)) {
      console.warn(
        `[package-manifest] installed package declares an unreadable ${field} (${JSON.stringify(fieldValue)}); ` +
          `ignoring it — the compatibility floor it intends cannot be enforced`,
      )
      droppedAny = true
      continue
    }
    kept[field] = fieldValue
  }

  return droppedAny ? { ...value, package: kept } : value
}

/**
 * Validate a manifest read back from a package that is ALREADY
 * INSTALLED, dropping a floor this codebase cannot compare rather than
 * rejecting the whole document.
 *
 * Strict where the artefact enters, tolerant where we are only reading
 * what is already on disk. `importFromFile` refuses an unreadable floor
 * — that is the boundary, and refusing there is what makes the promise
 * in `docs/package-format.md` true. But a package installed BEFORE that
 * boundary existed can carry such a floor, and rejecting its manifest on
 * load would make the boards it provides disappear from the board lookup
 * with no message, on an upgrade where the user did nothing.
 *
 * Dropping the field leaves the package exactly as unconstrained as it
 * already was — an unreadable floor never gated anything (see
 * `isVersionAtLeast`) — while the log keeps the cause visible instead of
 * silently trading one invisible outcome for another.
 */
export function parseInstalledPackageManifest(value: unknown): PackageManifest | null {
  return parsePackageManifest(withComparableFloorsOnly(value))
}
