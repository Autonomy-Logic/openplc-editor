import type { DebugBoardIdResult, DebugLicenseReadResult, LicenseCapableTransport } from '../../../shared/debug/types'

const mockCheckDeviceActivation = jest.fn()
jest.mock('../license-activation-client', () => ({
  checkDeviceActivation: (...args: unknown[]) => mockCheckDeviceActivation(...args),
}))

import { probeAndRecover, toLegacyActivationOutcome } from '../device-connect'

function mockTransport(over: Partial<LicenseCapableTransport> = {}): LicenseCapableTransport {
  return {
    connect: jest.fn(async () => undefined),
    disconnect: jest.fn(),
    getBoardId: jest.fn(
      async (): Promise<DebugBoardIdResult> => ({ success: true, boardId: new Uint8Array([1, 2, 3, 4]), boardIdHex: '01020304' }),
    ),
    readLicense: jest.fn(async (): Promise<DebugLicenseReadResult> => ({ success: true, status: 0x83, empty: true })),
    writeLicense: jest.fn(async () => ({ success: true })),
    ...over,
  }
}

beforeEach(() => jest.clearAllMocks())

describe('probeAndRecover', () => {
  it('reports no-firmware when the board never answers 0x48', async () => {
    const r = await probeAndRecover(mockTransport({ getBoardId: jest.fn(async () => ({ success: false })) }), {
      isLicensable: true,
    })
    expect(r.status).toBe('no-firmware')
    expect(mockCheckDeviceActivation).not.toHaveBeenCalled()
  })

  it('connects a non-licensable board without a license step', async () => {
    const r = await probeAndRecover(mockTransport(), { isLicensable: false })
    expect(r).toEqual({ status: 'connected-with-firmware', anchorHex: '01020304' })
    expect(mockCheckDeviceActivation).not.toHaveBeenCalled()
  })

  it('reports already-licensed on a stored valid license (0x7E) without calling the backend', async () => {
    const r = await probeAndRecover(
      mockTransport({ readLicense: jest.fn(async () => ({ success: true, status: 0x7e, blob: new Uint8Array(98) })) }),
      { isLicensable: true, packageId: 'com.vendor.board' },
    )
    expect(r).toMatchObject({ status: 'connected-with-firmware', licenseStatus: 'licensed', activation: 'already-licensed' })
    expect(mockCheckDeviceActivation).not.toHaveBeenCalled()
  })

  it('reports unsupported when the firmware has no storage backend (0x85)', async () => {
    const r = await probeAndRecover(
      mockTransport({ readLicense: jest.fn(async () => ({ success: true, status: 0x85, unsupported: true })) }),
      { isLicensable: true, packageId: 'com.vendor.board' },
    )
    expect(r).toMatchObject({ licenseStatus: 'unsupported', activation: 'unsupported' })
  })

  it('stays unlicensed without recover when no packageId is given', async () => {
    const r = await probeAndRecover(mockTransport(), { isLicensable: true })
    expect(r).toMatchObject({ licenseStatus: 'unlicensed' })
    expect(r.activation).toBeUndefined()
    expect(mockCheckDeviceActivation).not.toHaveBeenCalled()
  })

  it('recovers demo when the backend has no license', async () => {
    mockCheckDeviceActivation.mockResolvedValue({ licensed: false })
    const r = await probeAndRecover(mockTransport(), { isLicensable: true, packageId: 'com.vendor.board' })
    expect(r).toMatchObject({ licenseStatus: 'unlicensed', activation: 'demo' })
    expect(mockCheckDeviceActivation).toHaveBeenCalledTimes(1)
  })

  it('recovers and writes a license the backend returns (activated)', async () => {
    mockCheckDeviceActivation.mockResolvedValue({ licensed: true, license: new Array(98).fill(0) })
    const writeLicense = jest.fn(async () => ({ success: true }))
    const r = await probeAndRecover(mockTransport({ writeLicense }), {
      isLicensable: true,
      packageId: 'com.vendor.board',
    })
    expect(writeLicense).toHaveBeenCalledTimes(1)
    expect(r).toMatchObject({ licenseStatus: 'licensed', activation: 'activated' })
  })

  it('reports unsupported when the write lands on a device with no storage', async () => {
    mockCheckDeviceActivation.mockResolvedValue({ licensed: true, license: new Array(98).fill(0) })
    const r = await probeAndRecover(
      mockTransport({ writeLicense: jest.fn(async () => ({ success: false, unsupported: true })) }),
      { isLicensable: true, packageId: 'com.vendor.board' },
    )
    expect(r).toMatchObject({ licenseStatus: 'unsupported', activation: 'unsupported' })
  })

  it('surfaces a write failure as an error activation', async () => {
    mockCheckDeviceActivation.mockResolvedValue({ licensed: true, license: new Array(98).fill(0) })
    const r = await probeAndRecover(
      mockTransport({ writeLicense: jest.fn(async () => ({ success: false, error: 'crc mismatch' })) }),
      { isLicensable: true, packageId: 'com.vendor.board' },
    )
    expect(r).toMatchObject({ licenseStatus: 'unlicensed', activation: 'error', error: 'crc mismatch' })
  })

  it('runs demo when the backend says licensed but returns no blob', async () => {
    mockCheckDeviceActivation.mockResolvedValue({ licensed: true })
    const r = await probeAndRecover(mockTransport(), { isLicensable: true, packageId: 'com.vendor.board' })
    expect(r).toMatchObject({ licenseStatus: 'unlicensed', activation: 'demo' })
  })

  it('resolves to error when a transport read throws', async () => {
    const r = await probeAndRecover(
      mockTransport({ readLicense: jest.fn(async () => { throw new Error('serial timeout') }) }),
      { isLicensable: true, packageId: 'com.vendor.board' },
    )
    expect(r.status).toBe('error')
    expect(r.error).toContain('serial timeout')
  })
})

describe('toLegacyActivationOutcome (P0-2 dedup: handleActivateDeviceLicense over probeAndRecover)', () => {
  it('maps no-firmware to the legacy no-id outcome', () => {
    expect(toLegacyActivationOutcome({ status: 'no-firmware' })).toEqual({ success: true, outcome: 'no-id' })
  })

  it('maps no-response to a failed error outcome', () => {
    expect(toLegacyActivationOutcome({ status: 'no-response', error: 'port busy' })).toEqual({
      success: false,
      outcome: 'error',
      error: 'port busy',
    })
  })

  it('maps a thrown-exception error status to success:false (matches the old outer-catch behavior)', () => {
    expect(toLegacyActivationOutcome({ status: 'error', error: 'serial timeout' })).toEqual({
      success: false,
      outcome: 'error',
      error: 'serial timeout',
    })
  })

  it('maps already-licensed to success:true with license.present', () => {
    expect(
      toLegacyActivationOutcome({
        status: 'connected-with-firmware',
        anchorHex: '01020304',
        licenseStatus: 'licensed',
        activation: 'already-licensed',
      }),
    ).toEqual({ success: true, outcome: 'already-licensed', anchorHex: '01020304', license: { present: true } })
  })

  it('maps activated to success:true with license.present', () => {
    expect(
      toLegacyActivationOutcome({
        status: 'connected-with-firmware',
        anchorHex: '01020304',
        licenseStatus: 'licensed',
        activation: 'activated',
      }),
    ).toEqual({ success: true, outcome: 'activated', anchorHex: '01020304', license: { present: true } })
  })

  it('maps demo to success:true without a license field', () => {
    expect(
      toLegacyActivationOutcome({
        status: 'connected-with-firmware',
        anchorHex: '01020304',
        licenseStatus: 'unlicensed',
        activation: 'demo',
      }),
    ).toEqual({ success: true, outcome: 'demo', anchorHex: '01020304' })
  })

  it('maps unsupported to success:true, outcome:error (business state, not a transport failure)', () => {
    expect(
      toLegacyActivationOutcome({
        status: 'connected-with-firmware',
        anchorHex: '01020304',
        licenseStatus: 'unsupported',
        activation: 'unsupported',
      }),
    ).toEqual({ success: true, outcome: 'error', anchorHex: '01020304', error: 'no on-device storage backend' })
  })

  it('maps a write-error activation to success:true, outcome:error with the write error message', () => {
    expect(
      toLegacyActivationOutcome({
        status: 'connected-with-firmware',
        anchorHex: '01020304',
        licenseStatus: 'unlicensed',
        activation: 'error',
        error: 'crc mismatch',
      }),
    ).toEqual({ success: true, outcome: 'error', anchorHex: '01020304', error: 'crc mismatch' })
  })
})
