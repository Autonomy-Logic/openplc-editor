/**
 * Verification of an OpenPLC Runtime v4 licence file: the signed JSON Edge
 * issues for one hardware ID v2,
 * `{fmt, product, hardware_id, seats, order_id, issued_at, key_id, sig}`.
 *
 * The signed bytes are the payload without `sig`, keys sorted, no whitespace,
 * UTF-8; `sig` is the raw r||s (64 bytes) in base64; the key is picked by
 * `key_id`. Byte-identical with openplc-web.
 */

import {
  RUNTIME_LICENSE_PRODUCT_ID,
  type RuntimeLicenseKeys,
  verifyRuntimeLicenseSignature,
} from './runtime-license-keys'

const RUNTIME_LICENSE_FILE_FORMAT = 1
const MAX_SEATS = 1000
const FIELDS = ['fmt', 'hardware_id', 'issued_at', 'key_id', 'order_id', 'product', 'seats', 'sig'] as const
const HARDWARE_ID_RE = /^hw2:[0-9a-f]{64}$/
const ORDER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const SIG_RE = /^[A-Za-z0-9+/]{86}==$/

export type RuntimeLicenseFileVerdict =
  | { ok: true; orderId: string; seats: number }
  | { ok: false; reason: 'not-a-license' | 'other-product' | 'other-device' | 'signature' }

const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value)

/** The bytes Edge signs: every field but `sig`, keys sorted, no whitespace, UTF-8. */
export function canonicalRuntimeLicensePayload(file: Readonly<Record<string, unknown>>): Uint8Array {
  const body = Object.keys(file)
    .filter((key) => key !== 'sig')
    .sort()
    .map((key) => `${JSON.stringify(key)}:${JSON.stringify(file[key])}`)
    .join(',')
  return new TextEncoder().encode(`{${body}}`)
}

function decodeSignature(sig: string): Uint8Array {
  const text = atob(sig)
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i)
  return out
}

/**
 * Verify a licence file for the runtime whose hardware ID is `hardwareId`.
 *
 * @param file The licence as the runtime or Edge returned it; anything else is `not-a-license`.
 * @param hardwareId The runtime's hardware ID v2 (in a vPLC, the host's).
 * @param keys Accepted public keys by `key_id`.
 */
export async function verifyRuntimeLicenseFile(
  file: unknown,
  hardwareId: string,
  keys: RuntimeLicenseKeys,
): Promise<RuntimeLicenseFileVerdict> {
  if (typeof file !== 'object' || file === null || Array.isArray(file)) return { ok: false, reason: 'not-a-license' }
  const data = file as Record<string, unknown>
  const names = Object.keys(data).sort()
  if (names.length !== FIELDS.length || names.some((name, i) => name !== FIELDS[i])) {
    return { ok: false, reason: 'not-a-license' }
  }
  if (typeof data.product !== 'string') return { ok: false, reason: 'not-a-license' }
  if (data.product !== RUNTIME_LICENSE_PRODUCT_ID) return { ok: false, reason: 'other-product' }

  const { fmt, hardware_id, seats, order_id, issued_at, key_id, sig } = data
  if (
    fmt !== RUNTIME_LICENSE_FILE_FORMAT ||
    typeof hardware_id !== 'string' ||
    !HARDWARE_ID_RE.test(hardware_id) ||
    !isInt(seats) ||
    seats < 1 ||
    seats > MAX_SEATS ||
    typeof order_id !== 'string' ||
    !ORDER_ID_RE.test(order_id) ||
    typeof issued_at !== 'string' ||
    issued_at.length === 0 ||
    !isInt(key_id) ||
    key_id < 0 ||
    typeof sig !== 'string' ||
    !SIG_RE.test(sig)
  ) {
    return { ok: false, reason: 'not-a-license' }
  }
  if (hardware_id !== hardwareId) return { ok: false, reason: 'other-device' }

  const valid = await verifyRuntimeLicenseSignature(
    keys,
    key_id,
    decodeSignature(sig),
    canonicalRuntimeLicensePayload(data),
  )
  return valid ? { ok: true, orderId: order_id, seats } : { ok: false, reason: 'signature' }
}
