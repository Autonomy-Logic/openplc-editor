/**
 * @jest-environment node
 */
import { generateKeyPairSync, type KeyObject, sign } from 'node:crypto'

import { canonicalRuntimeLicensePayload, verifyRuntimeLicenseFile } from '../runtime-license-file'
import {
  BAREMETAL_RUNTIME_LICENSE_KEYS,
  BAREMETAL_RUNTIME_LICENSE_PRODUCT_ID,
  LINUX_RUNTIME_LICENSE_KEYS,
  parseRuntimeLicenseDevKey,
  RUNTIME_LICENSE_PRODUCT_ID,
  withRuntimeLicenseDevKey,
} from '../runtime-license-keys'

const ID = `hw2:${'ab'.repeat(32)}`
const OTHER_ID = `hw2:${'cd'.repeat(32)}`

function rawPublicKeyHex(publicKey: KeyObject): string {
  const jwk = publicKey.export({ format: 'jwk' })
  const hex = (b64: string | undefined) => Buffer.from(b64 ?? '', 'base64url').toString('hex')
  return hex(jwk.x) + hex(jwk.y)
}

const signer = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const other = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const KEYS = { 4: rawPublicKeyHex(signer.publicKey) }

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fmt: 1,
    product: RUNTIME_LICENSE_PRODUCT_ID,
    hardware_id: ID,
    seats: 3,
    order_id: 'txn_01k9',
    issued_at: '2026-10-28T12:00:00.000Z',
    key_id: 4,
    ...overrides,
  }
}

function issue(overrides: Record<string, unknown> = {}, key: KeyObject = signer.privateKey): Record<string, unknown> {
  const body = payload(overrides)
  const sig = sign('sha256', canonicalRuntimeLicensePayload(body), { key, dsaEncoding: 'ieee-p1363' })
  return { ...body, sig: sig.toString('base64') }
}

describe('canonicalRuntimeLicensePayload', () => {
  it('produces the bytes Edge and the runtime sign: keys sorted, no whitespace, no sig', () => {
    const bytes = canonicalRuntimeLicensePayload({ ...payload(), sig: 'ignored' })
    expect(new TextDecoder().decode(bytes)).toBe(
      `{"fmt":1,"hardware_id":"${ID}","issued_at":"2026-10-28T12:00:00.000Z","key_id":4,` +
        `"order_id":"txn_01k9","product":"com.autonomy.openplc-runtime","seats":3}`,
    )
  })
})

describe('verifyRuntimeLicenseFile', () => {
  it('accepts a file signed for this hardware ID', async () => {
    await expect(verifyRuntimeLicenseFile(issue(), ID, KEYS)).resolves.toEqual({
      ok: true,
      orderId: 'txn_01k9',
      seats: 3,
    })
  })

  it('accepts the file after a JSON round trip with another key order', async () => {
    const file = issue()
    const reordered = Object.fromEntries(Object.entries(file).reverse())
    await expect(verifyRuntimeLicenseFile(JSON.parse(JSON.stringify(reordered)), ID, KEYS)).resolves.toMatchObject({
      ok: true,
    })
  })

  it('refuses a file for another hardware ID', async () => {
    await expect(verifyRuntimeLicenseFile(issue({ hardware_id: OTHER_ID }), ID, KEYS)).resolves.toEqual({
      ok: false,
      reason: 'other-device',
    })
  })

  it('refuses the baremetal product and any other product', async () => {
    for (const product of [BAREMETAL_RUNTIME_LICENSE_PRODUCT_ID, 'com.openplc.espressif-licensed']) {
      await expect(verifyRuntimeLicenseFile(issue({ product }), ID, KEYS)).resolves.toEqual({
        ok: false,
        reason: 'other-product',
      })
    }
  })

  it('refuses another signer, an unknown key_id and any edited field', async () => {
    const forged = issue({}, other.privateKey)
    await expect(verifyRuntimeLicenseFile(forged, ID, KEYS)).resolves.toEqual({ ok: false, reason: 'signature' })
    await expect(verifyRuntimeLicenseFile(issue({ key_id: 5 }), ID, KEYS)).resolves.toEqual({
      ok: false,
      reason: 'signature',
    })
    const good = issue()
    for (const edit of [{ seats: 50 }, { order_id: 'txn_other' }, { issued_at: '2027-01-01T00:00:00.000Z' }]) {
      await expect(verifyRuntimeLicenseFile({ ...good, ...edit }, ID, KEYS)).resolves.toEqual({
        ok: false,
        reason: 'signature',
      })
    }
  })

  it('refuses anything that is not exactly a licence file', async () => {
    const good = issue()
    const shapes: unknown[] = [
      null,
      'licence',
      [good],
      { ...good, extra: 1 },
      Object.fromEntries(Object.entries(good).filter(([k]) => k !== 'seats')),
      { ...good, fmt: 2 },
      { ...good, hardware_id: 'hw2:abc' },
      { ...good, seats: 0 },
      { ...good, seats: 1001 },
      { ...good, seats: 1.5 },
      { ...good, order_id: '../escape' },
      { ...good, issued_at: '' },
      { ...good, key_id: -1 },
      { ...good, sig: 'short' },
      { ...good, product: 7 },
    ]
    for (const shape of shapes) {
      await expect(verifyRuntimeLicenseFile(shape, ID, KEYS)).resolves.toEqual({ ok: false, reason: 'not-a-license' })
    }
  })
})

describe('runtime licence keys', () => {
  const hex = 'ab'.repeat(64)

  it('ships one production key per product, as raw P-256 x||y hex', () => {
    for (const keys of [LINUX_RUNTIME_LICENSE_KEYS, BAREMETAL_RUNTIME_LICENSE_KEYS]) {
      expect(Object.keys(keys)).toEqual(['0'])
      expect(keys[0]).toMatch(/^[0-9a-f]{128}$/)
    }
    expect(LINUX_RUNTIME_LICENSE_KEYS[0]).not.toBe(BAREMETAL_RUNTIME_LICENSE_KEYS[0])
  })

  it('parses "<keyId>:<hex>" and nothing else', () => {
    expect(parseRuntimeLicenseDevKey(`3:${hex.toUpperCase()}`)).toEqual({ keyId: 3, rawKeyHex: hex })
    expect(parseRuntimeLicenseDevKey(undefined)).toBeNull()
    expect(parseRuntimeLicenseDevKey(hex)).toBeNull()
    expect(parseRuntimeLicenseDevKey(`x:${hex}`)).toBeNull()
    expect(parseRuntimeLicenseDevKey(`256:${hex}`)).toBeNull()
    expect(parseRuntimeLicenseDevKey(`1:${hex.slice(2)}`)).toBeNull()
  })

  it('adds a development key without changing the shipped table', () => {
    expect(withRuntimeLicenseDevKey(LINUX_RUNTIME_LICENSE_KEYS, null)).toBe(LINUX_RUNTIME_LICENSE_KEYS)
    const keys = withRuntimeLicenseDevKey(LINUX_RUNTIME_LICENSE_KEYS, { keyId: 9, rawKeyHex: hex })
    expect(keys[9]).toBe(hex)
    expect(keys[0]).toBe(LINUX_RUNTIME_LICENSE_KEYS[0])
    expect(LINUX_RUNTIME_LICENSE_KEYS[9]).toBeUndefined()
  })
})
