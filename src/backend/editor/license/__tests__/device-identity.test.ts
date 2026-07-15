import { deriveDeviceId, deriveVppId } from '../device-identity'

describe('deriveDeviceId', () => {
  it('derives the golden 16-byte device id for the real NodeMCU anchor', () => {
    // Anchor 00 b1 8c ed is the real NodeMCU hardware anchor. The golden
    // value below is the deterministic sha256("openplc-dev-v1|"||anchor)[:16].
    const anchor = Uint8Array.from([0, 177, 140, 237])
    expect(deriveDeviceId(anchor)).toBe('659a3520540f803625ddc34081e893d3')
  })

  it('returns 32 lowercase hex chars (16 bytes)', () => {
    const id = deriveDeviceId(Uint8Array.from([1, 2, 3]))
    expect(id).toMatch(/^[0-9a-f]{32}$/)
  })

  it('is deterministic and domain-separated by the prefix', () => {
    const anchor = Uint8Array.from([0, 177, 140, 237])
    // Same anchor -> same id.
    expect(deriveDeviceId(anchor)).toBe(deriveDeviceId(Uint8Array.from([0, 177, 140, 237])))
    // A different anchor -> different id.
    expect(deriveDeviceId(anchor)).not.toBe(deriveDeviceId(Uint8Array.from([0, 177, 140, 238])))
  })
})

describe('deriveVppId', () => {
  it('derives the golden 8-byte vpp id for the espressif package', () => {
    // Golden value = sha256("com.openplc.espressif")[:8], hex.
    expect(deriveVppId('com.openplc.espressif')).toBe('29a17c7c2486d355')
  })

  it('returns 16 lowercase hex chars (8 bytes)', () => {
    expect(deriveVppId('com.openplc.espressif')).toMatch(/^[0-9a-f]{16}$/)
  })
})
