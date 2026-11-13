/**
 * Public keys Autonomy Edge signs runtime licences with, one table per product,
 * by `key_id`: raw P-256 x||y, lowercase hex, as production Edge publishes them
 * on `GET /vpp-catalog/v1/vpps/<product>/pubkey`. Licences from any other Edge
 * do not verify.
 *
 * WebCrypto only, so the same code runs in the desktop main process and in the
 * browser. Byte-identical with openplc-web.
 */

/** Product ID of the OpenPLC Runtime v4 (Linux) licence. */
export const RUNTIME_LICENSE_PRODUCT_ID = 'com.autonomy.openplc-runtime'

/** Product ID of the runtime licence of a built-in (baremetal) board. */
export const BAREMETAL_RUNTIME_LICENSE_PRODUCT_ID = 'com.autonomy.openplc-runtime-baremetal'

/** Accepted public keys by `key_id`. */
export type RuntimeLicenseKeys = Readonly<Record<number, string>>

/** Keys of `RUNTIME_LICENSE_PRODUCT_ID`. */
export const LINUX_RUNTIME_LICENSE_KEYS: RuntimeLicenseKeys = {
  0: 'a32ea93de9f943065638bd9a38ca3aedb2af65ba910ca0f36aca8c5790d1aa0986129d0c6a8ee80ce054c509a5a641636dab4e3929bb25be417624cec6f1a7df',
}

/** Keys of `BAREMETAL_RUNTIME_LICENSE_PRODUCT_ID`. */
export const BAREMETAL_RUNTIME_LICENSE_KEYS: RuntimeLicenseKeys = {
  0: '3c54bf70883b698922279259ddffdef487a881dfd5351ac5ac2a09bc8349385bd47d5073203f4d7fa3db34a6238394d98e25c211a2633f54b7e735b7b3a4d196',
}

const RAW_KEY_RE = /^[0-9a-f]{128}$/

export interface RuntimeLicenseDevKey {
  keyId: number
  rawKeyHex: string
}

/**
 * Parse a development key, `"<keyId>:<x||y hex>"`. Returns null for anything else.
 */
export function parseRuntimeLicenseDevKey(value: string | undefined): RuntimeLicenseDevKey | null {
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

/** `keys` plus an optional development key; a development key never replaces a shipped key. */
export function withRuntimeLicenseDevKey(
  keys: RuntimeLicenseKeys,
  devKey: RuntimeLicenseDevKey | null,
): RuntimeLicenseKeys {
  if (!devKey || Object.prototype.hasOwnProperty.call(keys, devKey.keyId)) return keys
  return { ...keys, [devKey.keyId]: devKey.rawKeyHex }
}

/**
 * ECDSA P-256 / SHA-256 over `message` with the key `keys[keyId]`; `signature` is raw r||s.
 * False for an unknown key or on any import or verify failure.
 */
export async function verifyRuntimeLicenseSignature(
  keys: RuntimeLicenseKeys,
  keyId: number,
  signature: Uint8Array,
  message: Uint8Array,
): Promise<boolean> {
  const rawKeyHex = keys[keyId]
  if (!rawKeyHex || !RAW_KEY_RE.test(rawKeyHex) || signature.length !== 64) return false
  const point = new Uint8Array(65)
  point[0] = 0x04
  for (let i = 0; i < 64; i++) point[i + 1] = parseInt(rawKeyHex.slice(i * 2, i * 2 + 2), 16)
  try {
    const key = await crypto.subtle.importKey('raw', point, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, message)
  } catch {
    return false
  }
}
