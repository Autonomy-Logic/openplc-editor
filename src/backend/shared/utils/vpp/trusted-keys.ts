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
 * The private counterparts live ONLY in the OpenPLC/JW Control signing
 * pipelines as CI/local secrets and are never present in this repo.
 *
 * JW Control keeps `openplc-2026` for upstream compatibility and adds
 * `jwcontrol-2026` only for OpenPLC Editor - JWPLC Edition builds.
 */

export const TRUSTED_PACKAGE_KEYS: Record<string, string> = {
  'openplc-2026': `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEABdweEuJAfYG923RkmZLYsmonLvCcgVtgpJ7mngbRJQk=
-----END PUBLIC KEY-----
`,
  'jwcontrol-2026': `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAYYclqyKEy2g7+jgMs2tKihQYFdrqc1/zE7AKJgbWvlo=
-----END PUBLIC KEY-----
`,
}
