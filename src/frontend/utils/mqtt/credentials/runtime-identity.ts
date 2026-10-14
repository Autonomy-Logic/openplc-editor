// The fingerprint is entered by the user from a trusted source, never learnt from the network.

const OPENSSL_PREFIX = /^(?:sha-?256\s+)?fingerprint\s*=\s*/i
const HEX_PAIRS = /^[0-9a-f]{2}(?::[0-9a-f]{2}){31}$/
const HEX = /^[0-9a-f]{64}$/

/** Lowercase 64-hex digest, or null. Accepts `AB:CD:..`, plain hex and `openssl x509 -fingerprint -sha256` output. */
export const normalizeRuntimeCertificateFingerprint = (text: string): string | null => {
  const value = text.trim().replace(OPENSSL_PREFIX, '').trim().toLowerCase()
  if (HEX.test(value)) return value
  if (HEX_PAIRS.test(value)) return value.replace(/:/g, '')
  return null
}

/** `AB:CD:...` form, as `openssl` prints it, for display. */
export const formatRuntimeCertificateFingerprint = (sha256: string): string =>
  (sha256.toUpperCase().match(/.{2}/g) ?? []).join(':')
