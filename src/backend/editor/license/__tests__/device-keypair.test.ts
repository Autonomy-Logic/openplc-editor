/**
 * Proof-of-possession keypair (ADR-0002).
 *
 * The verification side of every test here rebuilds the public key from the
 * exported HEX, wrapping it in SPKI DER the way an independent verifier — the
 * backend, in another language — would have to. It deliberately does NOT reuse
 * the `KeyObject` the module built internally: that would only prove the module
 * agrees with itself. This is the lesson from the CI mock incident recorded in
 * `context.md` ("a ferramenta de verificação estava errada, não o código").
 *
 * A note on byte types, because they are NOT uniform here: `verify()` wants
 * `Uint8Array` for its data and signature, while `createPublicKey()` wants a
 * `Buffer` for its key. The @types/node overloads genuinely disagree, so each
 * call site below passes what that specific API declares — see `verifierFromHex`.
 * This is the same drift that once broke `license-activation-client.ts`.
 */

import { createPublicKey, verify as cryptoVerify } from 'node:crypto'

import { deriveDeviceKeyPair } from '../device-keypair'

/** SPKI DER header for a raw Ed25519 public key (RFC 8410). */
const ED25519_SPKI_PREFIX = '302a300506032b6570032100'

function bytesFromHex(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex, 'hex'))
}

function bytesFromAscii(text: string): Uint8Array {
  return Uint8Array.from(Buffer.from(text, 'utf8'))
}

/**
 * Rebuild a verifier from the raw 32-byte public key, as the backend must.
 *
 * `key` is a `Buffer` here while the signing side hands `createPrivateKey` a
 * `Uint8Array`: the two @types/node overloads genuinely disagree —
 * `PublicKeyInput.key` is `string | Buffer`, `PrivateKeyInput.key` is
 * `Uint8Array`. Not interchangeable, so each call site says what it needs.
 */
function verifierFromHex(publicKeyHex: string) {
  return createPublicKey({
    key: Buffer.from(`${ED25519_SPKI_PREFIX}${publicKeyHex}`, 'hex'),
    format: 'der',
    type: 'spki',
  })
}

/** The Pi 5 anchor measured on real hardware: ASCII "8625807b0a83ae7d". */
const PI_ANCHOR = bytesFromAscii('8625807b0a83ae7d')
/** Its `deriveDeviceId` output, hardcoded from the on-hardware measurement. */
const PI_DEVICE_ID = '7146518f9842adacfadc731ee7f546e5'

// scrypt at N=2^16 costs a few hundred ms per derivation, by design.
const KDF_TIMEOUT_MS = 30_000

describe('deriveDeviceKeyPair', () => {
  it('refuses an empty anchor instead of deriving a degenerate key', async () => {
    await expect(deriveDeviceKeyPair(new Uint8Array(0), PI_DEVICE_ID)).rejects.toThrow(/empty anchor/)
  })

  it(
    'produces a 32-byte public key and a 64-byte signature, both hex',
    async () => {
      const kp = await deriveDeviceKeyPair(PI_ANCHOR, PI_DEVICE_ID)
      expect(kp.publicKeyHex).toMatch(/^[0-9a-f]{64}$/)
      expect(kp.sign(Uint8Array.from([1, 2, 3]))).toMatch(/^[0-9a-f]{128}$/)
    },
    KDF_TIMEOUT_MS,
  )

  it(
    'signs a challenge verifiably under the exported public key',
    async () => {
      const kp = await deriveDeviceKeyPair(PI_ANCHOR, PI_DEVICE_ID)
      const challenge = bytesFromAscii('server-issued-nonce')
      const signature = bytesFromHex(kp.sign(challenge))
      // `null` algorithm is Ed25519's contract, matching the signing side.
      expect(cryptoVerify(null, challenge, verifierFromHex(kp.publicKeyHex), signature)).toBe(true)
    },
    KDF_TIMEOUT_MS,
  )

  it(
    'rejects a signature over a DIFFERENT challenge (no replay of one answer)',
    async () => {
      const kp = await deriveDeviceKeyPair(PI_ANCHOR, PI_DEVICE_ID)
      const signature = bytesFromHex(kp.sign(bytesFromAscii('nonce-a')))
      expect(cryptoVerify(null, bytesFromAscii('nonce-b'), verifierFromHex(kp.publicKeyHex), signature)).toBe(false)
    },
    KDF_TIMEOUT_MS,
  )

  it(
    'is deterministic: the same anchor and device id rebuild the same key',
    async () => {
      // This is the property that lets a license survive an SD-card swap: the key
      // is recomputed from the silicon, never stored.
      const a = await deriveDeviceKeyPair(PI_ANCHOR, PI_DEVICE_ID)
      const b = await deriveDeviceKeyPair(PI_ANCHOR, PI_DEVICE_ID)
      expect(b.publicKeyHex).toBe(a.publicKeyHex)
    },
    KDF_TIMEOUT_MS,
  )

  it(
    'gives a different key for a different anchor',
    async () => {
      const mine = await deriveDeviceKeyPair(PI_ANCHOR, PI_DEVICE_ID)
      const theirs = await deriveDeviceKeyPair(bytesFromAscii('0000000000000000'), PI_DEVICE_ID)
      expect(theirs.publicKeyHex).not.toBe(mine.publicKeyHex)
    },
    KDF_TIMEOUT_MS,
  )

  it(
    "cannot sign for another device's key",
    async () => {
      // The whole point: holding one board's anchor proves nothing about another.
      const mine = await deriveDeviceKeyPair(PI_ANCHOR, PI_DEVICE_ID)
      const theirs = await deriveDeviceKeyPair(bytesFromAscii('deadbeefdeadbeef'), PI_DEVICE_ID)
      const challenge = bytesFromAscii('nonce')
      const signature = bytesFromHex(mine.sign(challenge))
      expect(cryptoVerify(null, challenge, verifierFromHex(theirs.publicKeyHex), signature)).toBe(false)
    },
    KDF_TIMEOUT_MS,
  )

  it(
    'mixes the device id into the salt, so it is not a fleet-wide table',
    async () => {
      // Asserts the salt genuinely participates. With a fixed salt, one precomputed
      // anchor -> key table (~2^24 entries on ESP32) would work against every board;
      // with the device id salted in, the attacker pays per device.
      const a = await deriveDeviceKeyPair(PI_ANCHOR, PI_DEVICE_ID)
      const b = await deriveDeviceKeyPair(PI_ANCHOR, 'ffffffffffffffffffffffffffffffff')
      expect(b.publicKeyHex).not.toBe(a.publicKeyHex)
    },
    KDF_TIMEOUT_MS,
  )
})
