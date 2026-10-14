import { formatRuntimeCertificateFingerprint, normalizeRuntimeCertificateFingerprint } from '../runtime-identity'

const HEX = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
const PAIRS = formatRuntimeCertificateFingerprint(HEX)

describe('runtime certificate fingerprint', () => {
  it('prints the openssl colon form', () => {
    expect(PAIRS).toBe(
      '9F:86:D0:81:88:4C:7D:65:9A:2F:EA:A0:C5:5A:D0:15:A3:BF:4F:1B:2B:0B:82:2C:D1:5D:6C:15:B0:F0:0A:08',
    )
  })

  it('accepts plain hex, the colon form and openssl output, in any case', () => {
    expect(normalizeRuntimeCertificateFingerprint(HEX)).toBe(HEX)
    expect(normalizeRuntimeCertificateFingerprint(HEX.toUpperCase())).toBe(HEX)
    expect(normalizeRuntimeCertificateFingerprint(`  ${PAIRS}  `)).toBe(HEX)
    expect(normalizeRuntimeCertificateFingerprint(`sha256 Fingerprint=${PAIRS}`)).toBe(HEX)
    expect(normalizeRuntimeCertificateFingerprint(`SHA256 Fingerprint=${PAIRS}`)).toBe(HEX)
  })

  it('refuses anything that is not exactly one SHA-256 digest', () => {
    expect(normalizeRuntimeCertificateFingerprint('')).toBeNull()
    expect(normalizeRuntimeCertificateFingerprint(HEX.slice(1))).toBeNull()
    expect(normalizeRuntimeCertificateFingerprint(`${HEX}00`)).toBeNull()
    expect(normalizeRuntimeCertificateFingerprint(PAIRS.replace(/:/, ''))).toBeNull()
    expect(normalizeRuntimeCertificateFingerprint(`SHA1 Fingerprint=${PAIRS}`)).toBeNull()
    expect(normalizeRuntimeCertificateFingerprint(HEX.replace('9', 'g'))).toBeNull()
  })
})
