/**
 * License-identity derivation helpers.
 *
 * Both identifiers are deterministic SHA-256 digests, truncated to a
 * fixed prefix and hex-encoded, computed with WebCrypto so the same code
 * runs in the desktop main process and in the browser.
 *
 * CROSS-REPO CONTRACT. `deriveDeviceId` output is the PRIMARY KEY the
 * autonomy-edge backend stores a purchase and a license against, and it
 * accepts only LOWERCASE hex (`canonical-device-id.ts` there). `digest('hex')`
 * is already lowercase, so this holds by construction — but nothing downstream
 * may upper-case it: a purchase recorded as `7146…E5` and an activation for
 * `7146…e5` become two devices, the customer pays, the seat check finds
 * nothing, and the board runs demo with no error saying why.
 */

import { bytesToHex } from '../debug/license-blob'

/** Domain-separation prefix for the device-id digest. Mixed
 *  in as raw ASCII bytes ahead of the hardware anchor so the same anchor
 *  can never collide with any other `sha256`-derived identifier. */
const DEVICE_ID_PREFIX = 'openplc-dev-v1|'

/** Device id = first 16 bytes of the digest (matches `lic_blob_t.deviceId`,
 *  and `LIC_DEVICE_ID_SIZE` in the firmware contract). */
export const DEVICE_ID_BYTES = 16

/** VPP id = first 8 bytes of the digest (matches `lic_blob_t.productId`). */
const VPP_ID_BYTES = 8

/**
 * Derive the 16-byte device identifier from a hardware anchor.
 *
 * `deviceId = sha256("openplc-dev-v1|" || anchor)[:16]`, hex-encoded
 * (32 lowercase hex chars). The prefix is concatenated as ASCII bytes
 * directly in front of the anchor bytes in a single buffer, so the
 * hash input is exactly `<prefix bytes><anchor bytes>`.
 *
 * ANCHOR NORMALIZATION CONTRACT — do not "fix" this by trimming here.
 * The anchor is hashed EXACTLY as the board-id read (FC 0x48) answered it,
 * because what 0x48 answers is already what a paid VPP's on-device verifier
 * derives from:
 *   - bare metal reports its raw ID source (factory ID or generated ID) as
 *     read, the same bytes the paid VPP's private core hashes on the board;
 *   - a runtime-v4 target answers its device-tree serial with trailing
 *     NUL/LF/CR/space ALREADY stripped: the runtime's webserver strips on
 *     the wire and the closed core's __linux__ branch strips on read — the
 *     same normative set, in the same place the identity is decided.
 * Pinned by the "raw bytes ARE the identity" case in device-identity.test.ts.
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
