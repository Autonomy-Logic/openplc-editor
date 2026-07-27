import type { DebugBoardIdResult, DebugLicenseReadResult, LicenseCapableTransport } from '../../../shared/debug/types'
import { probeDevice } from '../license-probe'

function mockTransport(over: Partial<LicenseCapableTransport> = {}): LicenseCapableTransport {
  return {
    connect: jest.fn(async () => undefined),
    disconnect: jest.fn(),
    getBoardId: jest.fn(async (): Promise<DebugBoardIdResult> => ({ success: true, boardId: new Uint8Array([1, 2, 3, 4]), boardIdHex: '01020304' })),
    readLicense: jest.fn(async (): Promise<DebugLicenseReadResult> => ({ success: true, status: 0x83, empty: true })),
    writeLicense: jest.fn(async () => ({ success: true })),
    ...over,
  }
}

describe('probeDevice', () => {
  it("classifies a board that answers 0x48 as connected-with-firmware", async () => {
    const t = mockTransport()
    const r = await probeDevice(t, {})
    expect(r.status).toBe('connected-with-firmware')
    expect(r.anchorHex).toBe('01020304')
    expect(r.licenseStatus).toBeUndefined() // not licensable -> no 0x4A read
    expect(t.disconnect).toHaveBeenCalled()
  })

  it("reads on-device license status when licensable (0x7E -> licensed)", async () => {
    const t = mockTransport({ readLicense: jest.fn(async () => ({ success: true, status: 0x7e, blob: new Uint8Array(98) })) })
    const r = await probeDevice(t, { isLicensable: true })
    expect(r.status).toBe('connected-with-firmware')
    expect(r.licenseStatus).toBe('licensed')
  })

  it("maps empty/corrupt to unlicensed, unsupported to unsupported", async () => {
    const empty = await probeDevice(mockTransport({ readLicense: jest.fn(async () => ({ success: true, status: 0x83, empty: true })) }), { isLicensable: true })
    expect(empty.licenseStatus).toBe('unlicensed')
    const unsup = await probeDevice(mockTransport({ readLicense: jest.fn(async () => ({ success: true, status: 0x85, unsupported: true })) }), { isLicensable: true })
    expect(unsup.licenseStatus).toBe('unsupported')
  })

  it('classifies an opened-but-silent channel as no-firmware', async () => {
    // getBoardId always reports no id -> retries exhaust -> no-firmware.
    const t = mockTransport({ getBoardId: jest.fn(async () => ({ success: false })) })
    const r = await probeDevice(t, { isLicensable: true })
    expect(r.status).toBe('no-firmware')
    expect(t.readLicense).not.toHaveBeenCalled()
    expect(t.disconnect).toHaveBeenCalled()
  }, 8000)

  it('classifies a channel that will not open as no-response', async () => {
    const t = mockTransport({ connect: jest.fn(async () => { throw new Error('port busy') }) })
    const r = await probeDevice(t, {})
    expect(r.status).toBe('no-response')
  }, 8000)
})
