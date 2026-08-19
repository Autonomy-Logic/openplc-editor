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

  it('hashes the anchor bytes RAW — trailing NUL/LF/CR/space are part of the identity', () => {
    // The normalization contract (see deriveDeviceId's docstring): bare metal
    // answers 0x48 with the raw ArduinoUniqueID bytes and the closed core reads
    // the SAME bytes raw, so a MAC that genuinely ends in one of these bytes
    // keeps it in its identity. A trim here would derive a deviceId the device
    // can never reproduce — the purchased license would never verify. If this
    // test starts failing because someone added a trim, that trim is the bug.
    const anchor = Uint8Array.from([0, 177, 140, 237])
    for (const trailing of [0x00, 0x0a, 0x0d, 0x20]) {
      const padded = Uint8Array.from([...anchor, trailing])
      expect(deriveDeviceId(padded)).not.toBe(deriveDeviceId(anchor))
    }
    // Runtime-v4 needs no trim HERE either: its anchor arrives already
    // normalized (the runtime webserver strips on the wire, the closed core's
    // __linux__ branch strips on read — same set, where identity is decided).
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
