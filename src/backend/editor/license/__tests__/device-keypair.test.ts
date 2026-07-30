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

import { deriveDeviceId } from '../device-identity'
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
/**
 * GOLDEN VECTOR — the public key this exact anchor MUST derive to.
 *
 * Amendment (b) to ADR-0002 (2026-07-30): the KDF parameters are a contract
 * PERSISTED IN A DATABASE, not an implementation detail. `publicKeyHex` is bound
 * to the device at checkout and verified against forever, and the purchase
 * webhook's idempotent fast-path never re-binds a device that already has a
 * license — so changing `POP_DOMAIN`, `SEED_BYTES`, `KDF_PARAMS` (N/r/p) or the
 * salt composition would make every already-bound device fail `verifyPossession`
 * on `/activate` AND `/recover`, get the byte-identical answer that "never
 * purchased" gets, and stay that way: a permanent brick of the device+VPP pair
 * with no re-bind path.
 *
 * Every other test in this file is SELF-CONSISTENT (sign with the key the module
 * just derived, verify it, prove determinism). All eight of them stayed green
 * under a mutated `KDF_PARAMS.N`, which is what made that class of change
 * invisible. This literal is the only assertion in the suite that a parameter
 * edit cannot satisfy — do not "update it to what the code does".
 *
 * Measured with the shipped derivation on 2026-07-30, and its `1af309c4` prefix
 * cross-checked against the value recorded from the on-hardware session.
 */
const PI_PUBLIC_KEY = '1af309c4605fbe25be6e84f571d4299f98d45e811860450689b317ef14f128f0'

// scrypt at N=2^16 costs a few hundred ms per derivation, by design.
const KDF_TIMEOUT_MS = 30_000

describe('deriveDeviceKeyPair', () => {
  it(
    'derives the GOLDEN public key for the measured hardware anchor (KDF parameters are a persisted contract)',
    async () => {
      const kp = await deriveDeviceKeyPair(PI_ANCHOR, PI_DEVICE_ID)
      expect(kp.publicKeyHex).toBe(PI_PUBLIC_KEY)
    },
    KDF_TIMEOUT_MS,
  )

  // The salt is `POP_DOMAIN || deviceIdHex`, so the domain separator is pinned by
  // the vector above only in combination with the id. Asserting the id the vector
  // was measured against keeps a silent change of the anchor -> deviceId
  // derivation from making the golden key look like it still matches.
  it('pins the deviceId the golden vector was measured against', () => {
    expect(deriveDeviceId(PI_ANCHOR)).toBe(PI_DEVICE_ID)
  })

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
