import { deriveDeviceId, deriveVppId } from '../device-identity'

describe('deriveDeviceId', () => {
  it('derives the golden 16-byte device id for the real NodeMCU anchor', () => {
    // Anchor 00 b1 8c ed is the real NodeMCU hardware anchor. The golden
    // value below is the deterministic sha256("openplc-dev-v1|"||anchor)[:16].
    const anchor = Uint8Array.from([0, 177, 140, 237])
    expect(deriveDeviceId(anchor)).toBe('659a3520540f803625ddc34081e893d3')
  })

  it('derives the anchor-parity golden id for the runtime-v4 Pi serial', () => {
    // Cross-repo pin (openplc-packages license-core/test/runtime-v4/
    // anchor-parity.mjs): every RAW vector there — the ASCII serial
    // "8625807b0a83ae7d" with trailing NUL/LF/CRLF/space — normalizes to these
    // bytes and MUST derive this exact deviceId. The strip half of the contract
    // is pinned in websocket-debug-transport-license.test.ts; this is the hash
    // half. Together they make the cross-repo comment breakable by a test.
    const normalized = Uint8Array.from('8625807b0a83ae7d', (c) => c.charCodeAt(0))
    expect(deriveDeviceId(normalized)).toBe('7146518f9842adacfadc731ee7f546e5')
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
    // The normalization contract (see deriveDeviceId's docstring). Since
    // DOPE-589 this function serves the runtime-v4 path only: baremetal reports
    // an id already derived inside its closed core, so nothing here touches it.
    // What arrives here is the device-tree serial, and the closed core's
    // __linux__ branch strips the same trailing set on read, in the same place
    // the identity is decided — the transport re-normalizes, this function does
    // NOT. Hashing raw is what keeps the two sides equal: a trim here would
    // derive a deviceId the device can never reproduce and the purchased
    // license would never verify. If this test starts failing because someone
    // added a trim, that trim is the bug.
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
