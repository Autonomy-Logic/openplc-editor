// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Autonomy®

import { z } from 'zod'

import { isValidVersion } from '../../../frontend/utils/semver'
import type { PackageManifest } from './types'

/** A compatibility floor must be a version this codebase can compare. */
const versionFloor = z
  .string()
  .min(1)
  .refine(isValidVersion, { message: 'must be a version like "4.3.2", "4.3", "4" or "v4.3.2"' })

/** A vendor board-manager index URL that can be passed to arduino-cli as `--additional-urls`. */
const boardManagerUrl = z.string().refine(
  (value) => {
    try {
      return new URL(value).protocol === 'https:'
    } catch {
      return false
    }
  },
  { message: 'must be an https:// URL' },
)

/**
 * Device entries declare only `target.boardManagerUrl`, `target.uploadMethod` and `rs485FixedPins`;
 * every other key passes through.
 */
export const PackageManifestSchema = z
  .object({
    formatVersion: z.string().min(1),
    package: z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
        version: z.string().min(1),
        minEditorVersion: versionFloor.optional(),
        minRuntimeVersion: versionFloor.optional(),
      })
      .passthrough(),
    devices: z
      .array(
        z
          .object({
            target: z
              .object({
                boardManagerUrl: boardManagerUrl.optional(),
                uploadMethod: z.enum(['serial', 'ethernet']).optional(),
              })
              .passthrough()
              .optional(),
            rs485FixedPins: z.record(z.string(), z.string()).optional(),
          })
          .passthrough(),
      )
      .min(1),
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

/** True for a board-manager URL this codebase is willing to pass to arduino-cli. */
function isUsableBoardManagerUrl(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && boardManagerUrl.safeParse(value).success)
}

/** Return `value` with every refused board-manager URL removed, logging each one. */
function withUsableBoardManagerUrlsOnly(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.devices)) return value

  let droppedAny = false
  const devices = value.devices.map((device: unknown) => {
    if (!isRecord(device) || !isRecord(device.target)) return device
    if (isUsableBoardManagerUrl(device.target.boardManagerUrl)) return device

    console.warn(
      `[package-manifest] installed device declares a board manager URL that is not https ` +
        `(${JSON.stringify(device.target.boardManagerUrl)}); ignoring it — the vendor core it ` +
        `points at will not be installed automatically`,
    )
    droppedAny = true
    const { boardManagerUrl: _dropped, ...target } = device.target
    return { ...device, target }
  })

  return droppedAny ? { ...value, devices } : value
}

/**
 * Validate a manifest read back from an installed package, dropping a floor that cannot be compared instead of
 * rejecting the whole document.
 */
export function parseInstalledPackageManifest(value: unknown): PackageManifest | null {
  return parsePackageManifest(withUsableBoardManagerUrlsOnly(withComparableFloorsOnly(value)))
}
