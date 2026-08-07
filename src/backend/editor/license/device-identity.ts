/**
 * License-identity derivation helpers.
 *
 * Both identifiers are deterministic SHA-256 digests, truncated to a
 * fixed prefix and hex-encoded. They run in the Electron **main**
 * process during the licensing routine, so they use `node:crypto`
 * directly.
 *
 * This module lives under `backend/editor` (not the byte-identical
 * `backend/shared` surface): `backend/shared` must compile identically
 * for both openplc-editor and openplc-web and therefore cannot depend
 * on `node:crypto`. The derivation only ever runs main-side, so an
 * editor-only home is the correct boundary.
 *
 * CROSS-REPO CONTRACT. `deriveDeviceId` output is the PRIMARY KEY the
 * autonomy-edge backend stores a purchase and a license against, and it
 * accepts only LOWERCASE hex (`canonical-device-id.ts` there). `digest('hex')`
 * is already lowercase, so this holds by construction — but nothing downstream
 * may upper-case it: a purchase recorded as `7146…E5` and an activation for
 * `7146…e5` become two devices, the customer pays, the seat check finds
 * nothing, and the board runs demo with no error saying why.
 */

import { createHash } from 'node:crypto'

/** Domain-separation prefix for the device-id digest. Mixed
 *  in as raw ASCII bytes ahead of the hardware anchor so the same anchor
 *  can never collide with any other `sha256`-derived identifier. */
const DEVICE_ID_PREFIX = 'openplc-dev-v1|'

/** Device id = first 16 bytes of the digest (matches `lic_blob_t.deviceId`). */
const DEVICE_ID_BYTES = 16

/** VPP id = first 8 bytes of the digest (matches `lic_blob_t.productId`). */
const VPP_ID_BYTES = 8

/**
 * Derive the 16-byte device identifier from a hardware anchor.
 *
 * `deviceId = sha256("openplc-dev-v1|" || anchor)[:16]`, hex-encoded
 * (32 lowercase hex chars). The prefix is concatenated as ASCII bytes
 * directly in front of the anchor bytes in a single buffer, so the
 * hash input is exactly `<prefix bytes><anchor bytes>`.
 */
export function deriveDeviceId(anchor: Uint8Array): string {
  // Single contiguous buffer: <prefix ASCII bytes><anchor bytes>. Built as
  // a plain Uint8Array (the prefix is ASCII, so its UTF-8 encoding is
  // byte-for-byte the ASCII bytes) to hand `createHash` a plain Uint8Array.
  const prefix = Uint8Array.from(DEVICE_ID_PREFIX, (c) => c.charCodeAt(0))
  const input = new Uint8Array(prefix.length + anchor.length)
  input.set(prefix, 0)
  input.set(anchor, prefix.length)
  return createHash('sha256')
    .update(input)
    .digest('hex')
    .slice(0, DEVICE_ID_BYTES * 2)
}

/**
 * Derive the 8-byte VPP (product) identifier from a package id.
 *
 * `vppId = sha256(packageId)[:8]`, hex-encoded (16 lowercase hex
 * chars). Must match `product_id[8]` of the on-device license blob
 * so the firmware can bind a written license to its VPP.
 */
export function deriveVppId(packageId: string): string {
  // Hash the package id as its UTF-8 (== ASCII) bytes.
  return createHash('sha256')
    .update(packageId)
    .digest('hex')
    .slice(0, VPP_ID_BYTES * 2)
}
