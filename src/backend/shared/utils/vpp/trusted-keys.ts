/**
 * Trusted VPP package-signing public keys.
 *
 * Maps `keyId` -> PEM-encoded Ed25519 public key. A package's
 * `signature.json` names the `keyId` it was signed with; the verifier looks
 * the key up here. The map shape (rather than a single constant) is what
 * makes key rotation possible: publish packages signed with a new keyId,
 * ship the editor with BOTH keys trusted, then retire the old one once no
 * supported package version still depends on it.
 *
 * The private counterparts live ONLY in the openplc-packages signing
 * pipeline (CI secret) and are never present in this repo.
 *
 * This lives in the shared surface so the editor and openplc-web trust the
 * exact same keys — the cross-repo sync check keeps them byte-identical, so
 * the trust anchor can't silently diverge between platforms.
 */

export const TRUSTED_PACKAGE_KEYS: Record<string, string> = {
  'openplc-2026': `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEABdweEuJAfYG923RkmZLYsmonLvCcgVtgpJ7mngbRJQk=
-----END PUBLIC KEY-----
`,
}
