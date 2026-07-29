/**
 * TS mirror of the firmware `lic_blob_t` on-device license blob (OLS-02).
 *
 * Byte-identical to the C struct in `resources/sources/Baremetal/license_blob.h`
 * (see `.specs/features/on-device-license-storage/design.md` §1). All
 * multi-byte fields are **little-endian**, written explicitly through a
 * `DataView` so the result never depends on the host byte order.
 *
 * Blob layout (98 bytes, packed, no padding):
 *
 *   | Offset | Field       | Type          | Size |
 *   |-------:|-------------|---------------|-----:|
 *   | 0      | magic       | uint32 LE     | 4    |  'OPLC' -> bytes 4F 50 4C 43
 *   | 4      | fmtVersion  | uint8         | 1    |
 *   | 5      | keyId       | uint8         | 1    |  signing-key id (rotation)
 *   | 6      | deviceId    | uint8[16]     | 16   |
 *   | 22     | productId   | uint8[8]      | 8    |  vpp id
 *   | 30     | signature   | uint8[64]     | 64   |  ECDSA P-256 r||s raw
 *   | 94     | crc32       | uint32 LE     | 4    |  CRC-32/ISO-HDLC over [payload||signature] (0..93)
 *   | 98     | (end)       |               |      |
 *
 * The signed payload is offsets 0..29 (30 bytes). The crc32 covers
 * `[payload || signature]` = offsets 0..93 (94 bytes) and never itself.
 */

/** Total blob size in bytes (`sizeof(lic_blob_t)`). */
export const LIC_BLOB_SIZE = 98
/** Signed payload size in bytes (`sizeof(lic_payload_t)`). */
export const LIC_PAYLOAD_SIZE = 30
/**
 * Magic as a little-endian uint32. The first four bytes of the blob are
 * always `4F 50 4C 43` ('OPLC'); read as an LE uint32 that is 0x434C504F.
 */
export const LIC_MAGIC_LE = 0x434c504f

// Field offsets (mirror the C struct exactly).
const OFF_MAGIC = 0
const OFF_FMT_VERSION = 4
const OFF_KEY_ID = 5
const OFF_DEVICE_ID = 6
const OFF_PRODUCT_ID = 22
const OFF_SIGNATURE = 30
const OFF_CRC32 = 94

const DEVICE_ID_SIZE = 16
const PRODUCT_ID_SIZE = 8
const SIGNATURE_SIZE = 64

export interface LicenseBlob {
  /** LE uint32 magic; canonical value is `LIC_MAGIC_LE` (0x434C504F). */
  magic: number
  fmtVersion: number
  /** signing-key id (enables signing-key rotation). */
  keyId: number
  /** 16-byte device identifier. */
  deviceId: Uint8Array
  /** 8-byte product identifier (vpp id). */
  productId: Uint8Array
  /** 64-byte ECDSA P-256 signature (r||s, raw). */
  signature: Uint8Array
  /** CRC-32/ISO-HDLC over `[payload||signature]`. */
  crc32: number
}

// ---------------------------------------------------------------------------
// CRC-32/ISO-HDLC (a.k.a. CRC-32, zlib/PKZIP)
//   poly (reflected) 0xEDB88320 · init 0xFFFFFFFF · refin/refout true · xorout 0xFFFFFFFF
//   test vector: crc32IsoHdlc("123456789") === 0xCBF43926
// Same definition as the firmware bitwise implementation — the golden test
// proves cross-language parity.
// ---------------------------------------------------------------------------

/** Compute CRC-32/ISO-HDLC over `data`, returned as an unsigned 32-bit number. */
export function crc32IsoHdlc(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]
    for (let bit = 0; bit < 8; bit++) {
      // Reflected: process LSB first, XOR with poly when the low bit is set.
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

// ---------------------------------------------------------------------------
// Serialize / deserialize
// ---------------------------------------------------------------------------

function copyFixed(dst: Uint8Array, offset: number, src: Uint8Array, size: number): void {
  // Copy at most `size` bytes; a short source leaves the rest zero-filled.
  dst.set(src.subarray(0, size), offset)
}

/**
 * Serialize a `LicenseBlob` into its 98-byte on-wire representation.
 *
 * All multi-byte fields are written little-endian via explicit
 * `DataView.setUint32(off, v, true)`. The `magic` is forced to the canonical
 * `LIC_MAGIC_LE`, and the `crc32` is **recomputed** over `[payload||signature]`
 * (offsets 0..93) — the `crc32` field on the input is ignored.
 */
export function serializeLicenseBlob(b: LicenseBlob): Uint8Array {
  const out = new Uint8Array(LIC_BLOB_SIZE)
  const view = new DataView(out.buffer)

  view.setUint32(OFF_MAGIC, LIC_MAGIC_LE, true)
  out[OFF_FMT_VERSION] = b.fmtVersion & 0xff
  out[OFF_KEY_ID] = b.keyId & 0xff
  copyFixed(out, OFF_DEVICE_ID, b.deviceId, DEVICE_ID_SIZE)
  copyFixed(out, OFF_PRODUCT_ID, b.productId, PRODUCT_ID_SIZE)
  copyFixed(out, OFF_SIGNATURE, b.signature, SIGNATURE_SIZE)

  // Recompute crc32 over [payload || signature] = offsets 0..93 (94 bytes).
  const crc = crc32IsoHdlc(out.subarray(0, OFF_CRC32))
  view.setUint32(OFF_CRC32, crc, true)

  return out
}

/**
 * Deserialize a 98-byte blob into a `LicenseBlob`. All multi-byte fields are
 * read little-endian. `deviceId` / `productId` / `signature` are fresh copies
 * (not views onto `buf`). Does not validate magic or crc32 — that is the
 * caller's / firmware's responsibility.
 */
export function deserializeLicenseBlob(buf: Uint8Array): LicenseBlob {
  if (buf.length < LIC_BLOB_SIZE) {
    throw new Error(`Invalid license blob: too short (${buf.length} bytes, expected ${LIC_BLOB_SIZE})`)
  }

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)

  return {
    magic: view.getUint32(OFF_MAGIC, true),
    fmtVersion: buf[OFF_FMT_VERSION],
    keyId: buf[OFF_KEY_ID],
    deviceId: buf.slice(OFF_DEVICE_ID, OFF_DEVICE_ID + DEVICE_ID_SIZE),
    productId: buf.slice(OFF_PRODUCT_ID, OFF_PRODUCT_ID + PRODUCT_ID_SIZE),
    signature: buf.slice(OFF_SIGNATURE, OFF_SIGNATURE + SIGNATURE_SIZE),
    crc32: view.getUint32(OFF_CRC32, true),
  }
}
