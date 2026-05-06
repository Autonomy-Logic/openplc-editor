// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Zod schema for PackageManifest, used at the trust boundary where a
 * `.vpp` package's `manifest.json` enters the editor process. Catches
 * malformed manifests before any of their fields are consumed (and
 * before any field is used as a filesystem path component, which is
 * separately defended by `validatePathId` / `assertPathContained` in
 * `src/backend/shared/utils/path-safety.ts`).
 *
 * The TypeScript `PackageManifest` interface in `./types.ts` stays the
 * editor-internal source of truth for IDE-time shape; this schema is
 * the runtime mirror used at IPC and disk-load boundaries.
 */

import { z } from 'zod'

import type { PackageManifest } from './types'

const VppModuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  hwId: z.string().optional(),
  image: z.string().optional(),
  io: z.object({
    digitalInputs: z.number().int().nonnegative(),
    digitalOutputs: z.number().int().nonnegative(),
    analogInputs: z.number().int().nonnegative(),
    analogOutputs: z.number().int().nonnegative(),
  }),
  parameters: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        type: z.string().min(1),
        options: z.array(z.string()).optional(),
        default: z.unknown().optional(),
        min: z.number().optional(),
        max: z.number().optional(),
      }),
    )
    .optional(),
  addressMapping: z.unknown().optional(),
})

export const PackageManifestSchema = z.object({
  formatVersion: z.string().min(1),
  package: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    version: z.string().min(1),
    vendor: z.object({
      name: z.string().min(1),
      url: z.string().optional(),
      logo: z.string(),
    }),
    description: z.string(),
    license: z.string().optional(),
    minEditorVersion: z.string().optional(),
  }),
  devices: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        category: z.string().optional(),
        preview: z.string(),
        target: z.object({
          type: z.string().min(1),
          platform: z.string().optional(),
          core: z.string().optional(),
        }),
        specs: z.record(z.string(), z.string()).optional(),
        hal: z.object({
          type: z.string().min(1),
          pluginType: z.string().optional(),
          pluginEntry: z.string().optional(),
          configTemplate: z.string().optional(),
          requirements: z.string().optional(),
          source: z.string().optional(),
        }),
        defaults: z
          .object({
            runtimeIpAddress: z.string().optional(),
            pins: z
              .object({
                defaultDin: z.array(z.string()).optional(),
                defaultDout: z.array(z.string()).optional(),
                defaultAin: z.array(z.string()).optional(),
                defaultAout: z.array(z.string()).optional(),
              })
              .optional(),
          })
          .optional(),
        screens: z.record(z.string(), z.string()).optional(),
        moduleSystem: z
          .object({
            enabled: z.boolean(),
            maxSlots: z.number().int().nonnegative(),
            discoverySupported: z.boolean().optional(),
            discoveryCommand: z.string().optional(),
            modules: z.array(VppModuleSchema),
          })
          .optional(),
      }),
    )
    .min(1),
})

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
  return parsed.data as PackageManifest
}
