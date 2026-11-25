/**
 * Licence identity derivation: truncated SHA-256 digests, lowercase hex, computed with WebCrypto.
 * `deriveDeviceId` output must stay lowercase: Edge stores purchases and licences under it.
 */

import { bytesToHex } from '../debug/license-blob'

/** Domain-separation prefix hashed as ASCII ahead of the anchor. */
const DEVICE_ID_PREFIX = 'openplc-dev-v1|'

/** Device ID length: the first 16 digest bytes (`lic_blob_t.deviceId`, `LIC_DEVICE_ID_SIZE`). */
export const DEVICE_ID_BYTES = 16

/** VPP id = first 8 bytes of the digest (matches `lic_blob_t.productId`). */
const VPP_ID_BYTES = 8

/**
 * Derive the 16-byte device ID: `sha256("openplc-dev-v1|" || anchor)[:16]`, lowercase hex.
 * The anchor is hashed exactly as FC 0x48 reported it, with no trimming.
 */
export async function deriveDeviceId(anchor: Uint8Array): Promise<string> {
  const prefix = Uint8Array.from(DEVICE_ID_PREFIX, (c) => c.charCodeAt(0))
  const input = new Uint8Array(prefix.length + anchor.length)
  input.set(prefix, 0)
  input.set(anchor, prefix.length)
  return bytesToHex((await sha256(input)).subarray(0, DEVICE_ID_BYTES))
}

/**
 * Derive the 8-byte VPP (product) identifier from a package id.
 *
 * `vppId = sha256(packageId)[:8]`, hex-encoded (16 lowercase hex
 * chars). Must match `product_id[8]` of the on-device license blob
 * so the firmware can bind a written license to its VPP.
 */
export async function deriveVppId(packageId: string): Promise<string> {
  return bytesToHex(await deriveVppIdBytes(packageId))
}

/** `deriveVppId` as the 8 raw bytes a blob's `productId` carries. */
export async function deriveVppIdBytes(packageId: string): Promise<Uint8Array> {
  return (await sha256(new TextEncoder().encode(packageId))).slice(0, VPP_ID_BYTES)
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data))
}

/** Length of a generated board ID (LIC_BOARD_ID_SIZE in the firmware). */
const GENERATED_BOARD_ID_BYTES = 16

/**
 * A fresh random board ID for FC 0x4E. Never one repeated byte, which the
 * firmware refuses as a blank slot.
 */
export function generateBoardId(): Uint8Array {
  for (;;) {
    const id = crypto.getRandomValues(new Uint8Array(GENERATED_BOARD_ID_BYTES))
    if (id.some((b) => b !== id[0])) return id
  }
}
