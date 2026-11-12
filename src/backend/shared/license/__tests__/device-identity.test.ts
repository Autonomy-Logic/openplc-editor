import { deriveDeviceId, deriveVppId, generateBoardId } from '../device-identity'

describe('deriveDeviceId', () => {
  it('derives the golden 16-byte device id for the real NodeMCU anchor', async () => {
    // Anchor 00 b1 8c ed is the real NodeMCU hardware anchor. The golden
    // value below is the deterministic sha256("openplc-dev-v1|"||anchor)[:16].
    const anchor = Uint8Array.from([0, 177, 140, 237])
    expect(await deriveDeviceId(anchor)).toBe('659a3520540f803625ddc34081e893d3')
  })

  it('derives the anchor-parity golden id for the runtime-v4 Pi serial', async () => {
    // Cross-repo pin (openplc-packages license-core/test/runtime-v4/
    // anchor-parity.mjs): every RAW vector there — the ASCII serial
    // "8625807b0a83ae7d" with trailing NUL/LF/CRLF/space — normalizes to these
    // bytes and MUST derive this exact deviceId. The strip half of the contract
    // is pinned in websocket-debug-transport-license.test.ts; this is the hash
    // half. Together they make the cross-repo comment breakable by a test.
    const normalized = Uint8Array.from('8625807b0a83ae7d', (c) => c.charCodeAt(0))
    expect(await deriveDeviceId(normalized)).toBe('7146518f9842adacfadc731ee7f546e5')
  })

  it('returns 32 lowercase hex chars (16 bytes)', async () => {
    const id = await deriveDeviceId(Uint8Array.from([1, 2, 3]))
    expect(id).toMatch(/^[0-9a-f]{32}$/)
  })

  it('is deterministic and domain-separated by the prefix', async () => {
    const anchor = Uint8Array.from([0, 177, 140, 237])
    // Same anchor -> same id.
    expect(await deriveDeviceId(anchor)).toBe(await deriveDeviceId(Uint8Array.from([0, 177, 140, 237])))
    // A different anchor -> different id.
    expect(await deriveDeviceId(anchor)).not.toBe(await deriveDeviceId(Uint8Array.from([0, 177, 140, 238])))
  })

  it('hashes the anchor bytes RAW — trailing NUL/LF/CR/space are part of the identity', async () => {
    const anchor = Uint8Array.from([0, 177, 140, 237])
    for (const trailing of [0x00, 0x0a, 0x0d, 0x20]) {
      const padded = Uint8Array.from([...anchor, trailing])
      expect(await deriveDeviceId(padded)).not.toBe(await deriveDeviceId(anchor))
    }
  })
})

describe('deriveVppId', () => {
  it('derives the golden 8-byte vpp id for the espressif package', async () => {
    // Golden value = sha256("com.openplc.espressif")[:8], hex.
    expect(await deriveVppId('com.openplc.espressif')).toBe('29a17c7c2486d355')
  })

  it('returns 16 lowercase hex chars (8 bytes)', async () => {
    expect(await deriveVppId('com.openplc.espressif')).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('generateBoardId', () => {
  it('returns 16 bytes that are not one repeated byte, different on every call', () => {
    const a = generateBoardId()
    const b = generateBoardId()
    expect(a.length).toBe(16)
    expect(a.some((x) => x !== a[0])).toBe(true)
    expect(Array.from(a)).not.toEqual(Array.from(b))
  })
})
