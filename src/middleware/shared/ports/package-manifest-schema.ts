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

import type { PackageManifest } from './types'

export const PackageManifestSchema = z
  .object({
    formatVersion: z.string().min(1),
    package: z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
        version: z.string().min(1),
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
