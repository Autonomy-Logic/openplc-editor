/**
 * @jest-environment node
 */
import { createHash, generateKeyPairSync, type KeyObject, sign } from 'node:crypto'

import { RUNTIME_LICENSE_PRODUCT_ID } from '@root/middleware/shared/utils/licensing/runtime-license-sync'

import { LIC_PAYLOAD_SIZE, serializeLicenseBlob } from '../license-blob'
import {
  deriveProductIdBytes,
  parseRuntimeLicenseDevKey,
  RUNTIME_LICENSE_TRUSTED_KEYS,
  runtimeLicenseKeys,
  verifyRuntimeLicenseBlob,
} from '../runtime-license-verify'

const DEVICE_ID = Uint8Array.from({ length: 16 }, (_, i) => 0x10 + i)
const RUNTIME_PRODUCT_ID = Uint8Array.from(
  createHash('sha256').update(RUNTIME_LICENSE_PRODUCT_ID).digest().subarray(0, 8),
)

function rawPublicKeyHex(publicKey: KeyObject): string {
  const jwk = publicKey.export({ format: 'jwk' })
  const hex = (b64: string | undefined) => Buffer.from(b64 ?? '', 'base64url').toString('hex')
  return hex(jwk.x) + hex(jwk.y)
}

const signer = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const other = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const KEY_ID = 2
const KEYS = { [KEY_ID]: rawPublicKeyHex(signer.publicKey) }

/** A blob as Edge issues it: payload signed with ECDSA P-256 / SHA-256, raw r||s. */
function issue(opts: { deviceId?: Uint8Array; productId?: Uint8Array; keyId?: number; fmt?: number; key?: KeyObject }) {
  const unsigned = serializeLicenseBlob({
    magic: 0,
    fmtVersion: opts.fmt ?? 1,
    keyId: opts.keyId ?? KEY_ID,
    deviceId: opts.deviceId ?? DEVICE_ID,
    productId: opts.productId ?? RUNTIME_PRODUCT_ID,
    signature: new Uint8Array(64),
    crc32: 0,
  })
  const signature = sign('sha256', unsigned.subarray(0, LIC_PAYLOAD_SIZE), {
    key: opts.key ?? signer.privateKey,
    dsaEncoding: 'ieee-p1363',
  })
  return serializeLicenseBlob({
    magic: 0,
    fmtVersion: opts.fmt ?? 1,
    keyId: opts.keyId ?? KEY_ID,
    deviceId: opts.deviceId ?? DEVICE_ID,
    productId: opts.productId ?? RUNTIME_PRODUCT_ID,
    signature: Uint8Array.from(signature),
    crc32: 0,
  })
}

/** Change one byte and fix the crc32, so only the signature can catch it. */
function tamper(blob: Uint8Array, offset: number): Uint8Array {
  const copy = Uint8Array.from(blob)
  copy[offset] ^= 0x01
  const parsedFields = {
    magic: 0,
    fmtVersion: copy[4],
    keyId: copy[5],
    deviceId: copy.slice(6, 22),
    productId: copy.slice(22, 30),
    signature: copy.slice(30, 94),
    crc32: 0,
  }
  return serializeLicenseBlob(parsedFields)
}

describe('verifyRuntimeLicenseBlob', () => {
  it('accepts a licence signed for this board and the runtime product', async () => {
    await expect(verifyRuntimeLicenseBlob(issue({}), DEVICE_ID, KEYS)).resolves.toEqual({ ok: true })
  })

  it('derives the runtime product ID as sha256(product)[:8]', async () => {
    expect(Array.from(await deriveProductIdBytes(RUNTIME_LICENSE_PRODUCT_ID))).toEqual(Array.from(RUNTIME_PRODUCT_ID))
  })

  it('refuses a licence for another board', async () => {
    const otherDevice = Uint8Array.from(DEVICE_ID, (b) => b ^ 0xff)
    await expect(verifyRuntimeLicenseBlob(issue({ deviceId: otherDevice }), DEVICE_ID, KEYS)).resolves.toEqual({
      ok: false,
      reason: 'other-device',
    })
  })

  it('refuses a licence for another product, such as a VPP', async () => {
    const vppId = Uint8Array.from(createHash('sha256').update('com.openplc.espressif-licensed').digest().subarray(0, 8))
    await expect(verifyRuntimeLicenseBlob(issue({ productId: vppId }), DEVICE_ID, KEYS)).resolves.toEqual({
      ok: false,
      reason: 'other-product',
    })
  })

  it('refuses a licence signed by a key it does not trust', async () => {
    await expect(verifyRuntimeLicenseBlob(issue({ key: other.privateKey }), DEVICE_ID, KEYS)).resolves.toEqual({
      ok: false,
      reason: 'signature',
    })
  })

  it('refuses a key id with no key, and an all-zero key', async () => {
    await expect(verifyRuntimeLicenseBlob(issue({ keyId: 7 }), DEVICE_ID, KEYS)).resolves.toEqual({
      ok: false,
      reason: 'signature',
    })
    await expect(verifyRuntimeLicenseBlob(issue({}), DEVICE_ID, { [KEY_ID]: '0'.repeat(128) })).resolves.toEqual({
      ok: false,
      reason: 'signature',
    })
  })

  it('refuses any signed byte changed, even with a recomputed crc32', async () => {
    const good = issue({})
    for (const offset of [5, 10, 25, 40, 93]) {
      const verdict = await verifyRuntimeLicenseBlob(tamper(good, offset), DEVICE_ID, KEYS)
      expect(verdict.ok).toBe(false)
    }
  })

  it('reports a damaged crc32, a missing magic, a short blob and an unknown format', async () => {
    const damaged = Uint8Array.from(issue({}))
    damaged[97] ^= 0x01
    await expect(verifyRuntimeLicenseBlob(damaged, DEVICE_ID, KEYS)).resolves.toEqual({ ok: false, reason: 'damaged' })

    const erased = new Uint8Array(98).fill(0xff)
    await expect(verifyRuntimeLicenseBlob(erased, DEVICE_ID, KEYS)).resolves.toMatchObject({ ok: false })

    await expect(verifyRuntimeLicenseBlob(new Uint8Array(97), DEVICE_ID, KEYS)).resolves.toEqual({
      ok: false,
      reason: 'incomplete',
    })
    await expect(verifyRuntimeLicenseBlob(issue({ fmt: 2 }), DEVICE_ID, KEYS)).resolves.toEqual({
      ok: false,
      reason: 'format',
    })
  })
})

describe('runtime licence keys', () => {
  const hex = 'ab'.repeat(64)

  it('parses "<keyId>:<hex>" and nothing else', () => {
    expect(parseRuntimeLicenseDevKey(`3:${hex.toUpperCase()}`)).toEqual({ keyId: 3, rawKeyHex: hex })
    expect(parseRuntimeLicenseDevKey(undefined)).toBeNull()
    expect(parseRuntimeLicenseDevKey(hex)).toBeNull()
    expect(parseRuntimeLicenseDevKey(`x:${hex}`)).toBeNull()
    expect(parseRuntimeLicenseDevKey(`256:${hex}`)).toBeNull()
    expect(parseRuntimeLicenseDevKey(`1:${hex.slice(2)}`)).toBeNull()
  })

  it('adds a development key to the built-in table without changing it', () => {
    expect(runtimeLicenseKeys(null)).toBe(RUNTIME_LICENSE_TRUSTED_KEYS)
    const keys = runtimeLicenseKeys({ keyId: 9, rawKeyHex: hex })
    expect(keys[9]).toBe(hex)
    expect(RUNTIME_LICENSE_TRUSTED_KEYS[9]).toBeUndefined()
  })
})
