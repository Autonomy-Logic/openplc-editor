/**
 * Verification of a baremetal runtime licence: the 98-byte blob (see
 * license-blob.ts) a board stores for `BAREMETAL_RUNTIME_LICENSE_PRODUCT_ID`, checked here
 * because built-in boards carry no verifier.
 *
 * The checks and their order match the device-side verifier paid VPPs run:
 * length, crc32, magic, format 1, device ID, product ID, then the ECDSA P-256 /
 * SHA-256 signature over the 30-byte payload, with the public key picked by
 * the blob's `keyId`.
 *
 * WebCrypto only, so the same code runs in the desktop main process and in the
 * browser. Byte-identical with openplc-web.
 */

import {
  BAREMETAL_RUNTIME_LICENSE_PRODUCT_ID,
  type RuntimeLicenseKeys,
  verifyRuntimeLicenseSignature,
} from '@root/middleware/shared/utils/licensing/runtime-license-keys'

import { deriveVppIdBytes } from '../license/device-identity'
import {
  bytesEqual,
  crc32IsoHdlc,
  deserializeLicenseBlob,
  LIC_BLOB_SIZE,
  LIC_CRC_COVERAGE,
  LIC_MAGIC_LE,
  LIC_PAYLOAD_SIZE,
} from './license-blob'

/** Blob format this verifier understands (`fmtVersion`). */
const RUNTIME_LICENSE_FORMAT = 1
const DEVICE_ID_BYTES = 16

export type RuntimeLicenseVerdict =
  | { ok: true }
  | {
      ok: false
      reason: 'incomplete' | 'damaged' | 'not-a-license' | 'format' | 'other-device' | 'other-product' | 'signature'
    }

/** `sha256(packageId)[:8]`, the product ID a blob carries. */
export async function deriveProductIdBytes(packageId: string): Promise<Uint8Array> {
  return deriveVppIdBytes(packageId)
}

/**
 * Verify a runtime licence blob for one board.
 *
 * @param blob What the board returned on 0x4A.
 * @param deviceId The 16-byte device ID derived from the board's 0x48 report.
 * @param keys Accepted public keys by `keyId` (`BAREMETAL_RUNTIME_LICENSE_KEYS`, plus a development key on desktop).
 */
export async function verifyRuntimeLicenseBlob(
  blob: Uint8Array,
  deviceId: Uint8Array,
  keys: RuntimeLicenseKeys,
): Promise<RuntimeLicenseVerdict> {
  if (blob.length !== LIC_BLOB_SIZE || deviceId.length !== DEVICE_ID_BYTES) return { ok: false, reason: 'incomplete' }

  const parsed = deserializeLicenseBlob(blob)
  if (crc32IsoHdlc(blob.subarray(0, LIC_CRC_COVERAGE)) !== parsed.crc32) return { ok: false, reason: 'damaged' }
  if (parsed.magic !== LIC_MAGIC_LE) return { ok: false, reason: 'not-a-license' }
  if (parsed.fmtVersion !== RUNTIME_LICENSE_FORMAT) return { ok: false, reason: 'format' }
  if (!bytesEqual(parsed.deviceId, deviceId)) return { ok: false, reason: 'other-device' }
  if (!bytesEqual(parsed.productId, await deriveProductIdBytes(BAREMETAL_RUNTIME_LICENSE_PRODUCT_ID))) {
    return { ok: false, reason: 'other-product' }
  }

  const valid = await verifyRuntimeLicenseSignature(
    keys,
    parsed.keyId,
    parsed.signature,
    blob.slice(0, LIC_PAYLOAD_SIZE),
  )
  return valid ? { ok: true } : { ok: false, reason: 'signature' }
}
