/**
 * Verification of a baremetal runtime licence: the 98-byte blob (see
 * license-blob.ts) a board stores for the runtime product, checked here
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

import { deriveVppIdBytes } from '../license/device-identity'
import {
  bytesEqual,
  crc32IsoHdlc,
  deserializeLicenseBlob,
  hexToBytes,
  LIC_BLOB_SIZE,
  LIC_CRC_COVERAGE,
  LIC_MAGIC_LE,
  LIC_PAYLOAD_SIZE,
} from './license-blob'

/** Product the runtime licence is issued for. */
export const RUNTIME_LICENSE_PRODUCT = 'com.autonomy.openplc-runtime'

/** Blob format this verifier understands (`fmtVersion`). */
const RUNTIME_LICENSE_FORMAT = 1
const DEVICE_ID_BYTES = 16
const RAW_KEY_RE = /^[0-9a-f]{128}$/

/**
 * Public keys for the runtime product by `keyId`: raw P-256 x||y, lowercase
 * hex. The production key is added before the integration branch merges.
 */
export const RUNTIME_LICENSE_TRUSTED_KEYS: Readonly<Record<number, string>> = {}

/** Keys the verifier accepts, by `keyId`. */
export type RuntimeLicenseKeys = Readonly<Record<number, string>>

export type RuntimeLicenseVerdict =
  | { ok: true }
  | {
      ok: false
      reason: 'incomplete' | 'damaged' | 'not-a-license' | 'format' | 'other-device' | 'other-product' | 'signature'
    }

/**
 * Parse a development key, `"<keyId>:<x||y hex>"`, as the runtime takes it.
 * Returns null for anything else.
 */
export function parseRuntimeLicenseDevKey(value: string | undefined): { keyId: number; rawKeyHex: string } | null {
  if (!value) return null
  const sep = value.indexOf(':')
  if (sep <= 0) return null
  const idText = value.slice(0, sep).trim()
  const rawKeyHex = value
    .slice(sep + 1)
    .trim()
    .toLowerCase()
  if (!/^\d{1,3}$/.test(idText) || !RAW_KEY_RE.test(rawKeyHex)) return null
  const keyId = Number(idText)
  if (keyId > 255) return null
  return { keyId, rawKeyHex }
}

/** The built-in keys plus an optional development key; the development key wins its slot. */
export function runtimeLicenseKeys(devKey: { keyId: number; rawKeyHex: string } | null): RuntimeLicenseKeys {
  if (!devKey) return RUNTIME_LICENSE_TRUSTED_KEYS
  return { ...RUNTIME_LICENSE_TRUSTED_KEYS, [devKey.keyId]: devKey.rawKeyHex }
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
 * @param keys Accepted public keys by `keyId` (see `runtimeLicenseKeys`).
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
  if (!bytesEqual(parsed.productId, await deriveProductIdBytes(RUNTIME_LICENSE_PRODUCT))) {
    return { ok: false, reason: 'other-product' }
  }

  const rawKeyHex = keys[parsed.keyId]
  if (!rawKeyHex || !RAW_KEY_RE.test(rawKeyHex)) return { ok: false, reason: 'signature' }
  const valid = await verifyP256(rawKeyHex, parsed.signature, blob.slice(0, LIC_PAYLOAD_SIZE))
  return valid ? { ok: true } : { ok: false, reason: 'signature' }
}

/** ECDSA P-256 / SHA-256 over `message`; `signature` is raw r||s. False on any import or verify failure. */
async function verifyP256(rawKeyHex: string, signature: Uint8Array, message: Uint8Array): Promise<boolean> {
  const point = new Uint8Array(65)
  point[0] = 0x04
  point.set(hexToBytes(rawKeyHex), 1)
  try {
    const key = await crypto.subtle.importKey('raw', point, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, message)
  } catch {
    return false
  }
}
