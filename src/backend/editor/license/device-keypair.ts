/**
 * Device proof-of-possession keypair (ADR-0002).
 *
 * WHAT PROBLEM THIS SOLVES. The backend hands a signed license to whoever names
 * a `deviceId` — and a `deviceId` is not a secret: the license popover shows it
 * with a copy button (deliberately, so it can be pasted into a ticket) and it
 * travels in the `/buy` query string. So a leaked `deviceId` is a free license
 * for anyone. The missing ingredient already existed and was never asked for:
 * `deviceId` is a ONE-WAY hash of the hardware anchor, so knowing the id does
 * not yield the anchor. Only something actually talking to the board gets the
 * raw anchor bytes (FC 0x48). This module turns "I hold the anchor" into
 * something provable without ever transmitting it.
 *
 * WHY DERIVED AND NOT GENERATED. A randomly generated keypair would have to be
 * stored in a file, and on Linux targets that file lives on the SD card — the
 * single most common part to fail in industrial use. Losing it would lose the
 * ability to prove possession and therefore the ability to RECOVER the license:
 * the recovery mechanism would depend on the thing that was lost. Deriving from
 * the anchor means the key is recomputed from the silicon on a fresh card, so
 * `deviceId` and the keypair are both stable across an SD swap. That preserves
 * D14 ("recuperação/reemissão pelo deviceId após troca de SD/SO").
 *
 * WHY A MEMORY-HARD KDF AND NOT sha256. The anchor is LOW ENTROPY: ~2^24 real
 * bits on ESP32 (`ArduinoUniqueID` returns 6 bytes, the first 3 being
 * Espressif's fixed OUI) and 2^32 on Raspberry Pi 4 and earlier. Anyone holding
 * a `deviceId` could enumerate candidate anchors offline and rebuild this key.
 * A plain hash would make that free. `scrypt` prices each guess in memory and
 * time. See KDF_PARAMS for what sets the cost.
 *
 * WHAT THIS DOES NOT BUY. Nothing against the owner of the board: they hold the
 * anchor, so they hold the key. That is deliberate (ADR-0001) and desirable — a
 * technician, a replacement SD card, or the customer must be able to recover the
 * license. The key proves "I can read this hardware", never "I own this license".
 *
 * Main-process only (`node:crypto`), like `device-identity.ts` and for the same
 * reason: `backend/shared` is byte-identical with openplc-web and cannot depend
 * on `node:crypto`.
 */

import { createPrivateKey, createPublicKey, type KeyObject, scrypt, sign as cryptoSign } from 'node:crypto'

/**
 * Domain separator for the proof-of-possession seed.
 *
 * DIFFERENT from `device-identity.ts`'s `openplc-dev-v1|` on purpose: the same
 * anchor feeds both derivations, and reusing one label would make the public
 * `deviceId` and the private seed two truncations of related material. With
 * distinct labels, publishing the id says nothing about the key.
 *
 * Part of the persisted derivation contract — see the migration note on
 * `KDF_PARAMS`. The `v1` here is a LABEL, not a version record: nothing stores
 * which version produced a bound public key.
 */
const POP_DOMAIN = 'openplc-pop-v1|'

/** Ed25519 seed length. Part of the persisted contract — see `KDF_PARAMS`. */
const SEED_BYTES = 32

/**
 * `scrypt` cost. 128 * N * r bytes of memory => 64 MiB here, a few hundred ms
 * on a developer machine. It is paid ONCE per activation attempt (the connect
 * flow short-circuits on an already-licensed device before reaching this), so
 * the honest cost is invisible while an attacker pays it per guess.
 *
 * THESE PARAMETERS ARE A PERSISTED CONTRACT, NOT AN IMPLEMENTATION DETAIL —
 * amendment (b) to ADR-0002, 2026-07-30. Changing `N`, `r`, `p`, `POP_DOMAIN`,
 * `SEED_BYTES` or the salt composition changes `publicKeyHex` for EVERY device.
 * The public key is stored in `licensed_devices.device_public_key` at CHECKOUT
 * and verified against forever, and the purchase webhook's idempotent fast-path
 * never re-binds a device that already has a license. So a device bound under
 * the old parameters would fail `verifyPossession` on both `/activate` and
 * `/recover`, receive the byte-identical answer that "never purchased" gets, and
 * have NO WAY BACK short of physical access to every board: a permanent brick of
 * the device+VPP pair.
 *
 * There is no re-bind path today. Until one exists, any change here requires an
 * explicit migration — a recorded decision, a way to verify a stored key against
 * both the old and the new derivation, and a way to re-bind. Bumping a number
 * because a benchmark says it is affordable is exactly the move that bricks the
 * fleet, so an earlier version of this comment that invited it was removed.
 *
 * (For context on which target would set a higher floor if a migration ever
 * happens: the ESP32 (~2^24 anchor entropy), not the Pi — it has both the
 * smallest anchor space AND a stolen blob that is usable after rebuilding the
 * firmware. An amendment arguing the opposite was considered and REJECTED; see
 * ADR-0002. Task #44.1 measures the real entropy per target.)
 *
 * `device-keypair.test.ts` pins a GOLDEN VECTOR (a measured anchor -> the exact
 * `publicKeyHex`) so any edit to the values above fails a test instead of
 * silently invalidating every key in the database.
 */
const KDF_PARAMS = { N: 1 << 16, r: 8, p: 1, maxmem: 128 * 1024 * 1024 } as const

/**
 * PKCS#8 prefix for a raw Ed25519 private seed (RFC 8410 §7).
 *
 * `node:crypto` cannot import a bare 32-byte scalar, so the seed is wrapped in
 * the fixed 16-byte DER header that precedes it in every Ed25519 PKCS#8 blob:
 * SEQUENCE(46) { INTEGER 0, SEQUENCE { OID 1.3.101.112 }, OCTET STRING(34) {
 * OCTET STRING(32) } }. Ed25519 was chosen over P-256 precisely because this
 * wrapper is a constant — importing a raw P-256 scalar would mean assembling
 * SEC1/PKCS#8 with the curve parameters by hand.
 *
 * NOTE: this is a THIRD key domain, unrelated to both signing keys in the
 * product. D7 forbids reusing the package-signing Ed25519 key for LICENSES;
 * this key signs neither packages nor licenses — it signs a challenge, and it
 * never leaves the machine that read the anchor.
 *
 * Kept as HEX and concatenated as a string before a single `Buffer.from(...,
 * 'hex')`: the byte-array routes fight this repo's @types/node <-> TS pairing
 * from both sides — `Buffer.concat` rejects `Buffer` in its element position,
 * while `createPrivateKey`'s `key` rejects `Uint8Array`. One hex string sidesteps
 * both instead of casting.
 */
const ED25519_PKCS8_PREFIX_HEX = '302e020100300506032b657004220420'

/** SPKI-wrapped Ed25519 public keys are a 12-byte header + the 32 raw bytes. */
const ED25519_RAW_PUBLIC_BYTES = 32

export interface DeviceKeyPair {
  /** Raw Ed25519 public key, 32 bytes hex — what the backend stores and verifies against. */
  publicKeyHex: string
  /** Sign a server-issued challenge. Returns the 64-byte signature as hex. */
  sign(challenge: Uint8Array): string
}

/**
 * Derive this device's proof-of-possession keypair from its hardware anchor.
 *
 * `deviceIdHex` is used as the scrypt SALT. It is public and device-specific,
 * which is exactly what a salt is for here: it does not slow down a single
 * guess, but it stops an attacker from precomputing one anchor -> key table and
 * reusing it across the whole fleet. With a fixed salt, ~2^24 ESP32 anchors
 * would be a one-time build reusable against every board.
 *
 * The salt COMPOSITION (`POP_DOMAIN || deviceIdHex`) is part of the persisted
 * derivation contract — see the migration note on `KDF_PARAMS`.
 *
 * Async on purpose: `scryptSync` would block the Electron main process for the
 * full cost, and the cost is the point.
 */
export async function deriveDeviceKeyPair(anchor: Uint8Array, deviceIdHex: string): Promise<DeviceKeyPair> {
  if (anchor.length === 0) {
    // Mirrors `license_core.c`: no anchor means no identity. Refusing here keeps
    // a degenerate all-zero seed from ever becoming a "valid" device key.
    throw new Error('cannot derive a device keypair from an empty anchor')
  }
  const seed = await scryptSeed(anchor, `${POP_DOMAIN}${deviceIdHex}`)
  const privateKey = createPrivateKey({
    key: Buffer.from(`${ED25519_PKCS8_PREFIX_HEX}${Buffer.from(seed).toString('hex')}`, 'hex'),
    format: 'der',
    type: 'pkcs8',
  })
  return {
    publicKeyHex: rawPublicKeyHex(privateKey),
    // Ed25519 takes no digest algorithm — `null` is required, not a shortcut.
    sign: (challenge: Uint8Array) => Buffer.from(cryptoSign(null, challenge, privateKey)).toString('hex'),
  }
}

function scryptSeed(anchor: Uint8Array, salt: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    scrypt(anchor, salt, SEED_BYTES, KDF_PARAMS, (err, derived) => {
      if (err) reject(err)
      else resolve(Uint8Array.from(derived))
    })
  })
}

/** Strip the SPKI header and hex-encode the 32 raw public bytes. */
function rawPublicKeyHex(privateKey: KeyObject): string {
  const spki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' })
  return Buffer.from(spki.subarray(spki.length - ED25519_RAW_PUBLIC_BYTES)).toString('hex')
}
