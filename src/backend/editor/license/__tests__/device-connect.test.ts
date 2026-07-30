import type { DebugBoardIdResult, DebugLicenseReadResult, LicenseCapableTransport } from '../../../shared/debug/types'

const mockCheckDeviceActivation = jest.fn()
jest.mock('../license-activation-client', () => ({
  checkDeviceActivation: (...args: unknown[]) => mockCheckDeviceActivation(...args),
}))

// Mocked, not run: the real derivation is a memory-hard KDF (64 MiB, hundreds of
// ms by design). Its own behaviour is covered in `device-keypair.test.ts`; what
// matters here is WHICH results carry the key and when it is derived twice.
const mockDeriveDeviceKeyPair = jest.fn()
jest.mock('../device-keypair', () => ({
  deriveDeviceKeyPair: (...args: unknown[]) => mockDeriveDeviceKeyPair(...args),
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

/**
 * `deriveDeviceId` of the mock transport's anchor `[1,2,3,4]`, computed
 * independently (sha256 of the ASCII prefix + the 4 bytes, first 16 bytes hex).
 * Hardcoded on purpose: calling the module under test to build the expectation
 * would assert nothing about the value the renderer is handed.
 */
const DEVICE_ID_OF_01020304 = 'af572de307790e5f5e9091f8d7435f70'

/** What the proof already derived while signing the challenge — reused, not recomputed. */
const KEY_FROM_PROOF = 'a'.repeat(64)
/** What a local derivation yields when no proof happened (no challenge route, older backend). */
const KEY_DERIVED_LOCALLY = 'b'.repeat(64)

beforeEach(() => {
  jest.clearAllMocks()
  mockDeriveDeviceKeyPair.mockResolvedValue({ publicKeyHex: KEY_DERIVED_LOCALLY, sign: () => '' })
})

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
    expect(r).toEqual({
      status: 'connected-with-firmware',
      anchorHex: '01020304',
      deviceId: DEVICE_ID_OF_01020304,
    })
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

  // A transport/backend failure is not a missing purchase. Reporting `demo`
  // here makes the renderer prompt a user who already owns a license to buy
  // one -- the activate endpoint is throttled, so a few quick reconnects are
  // enough to trigger it.
  it.each([
    ['rate limited', 'Activation request failed: 429 Too Many Requests'],
    ['signer unconfigured', 'Activation request failed: 503 Service Unavailable'],
    ['network down', 'getaddrinfo ENOTFOUND api.autonomylogic.com'],
  ])('reports an error, not demo, when activation fails (%s)', async (_label, error) => {
    mockCheckDeviceActivation.mockResolvedValue({ licensed: false, error })
    const r = await probeAndRecover(mockTransport(), { isLicensable: true, packageId: 'com.vendor.board' })
    expect(r).toMatchObject({ licenseStatus: 'unlicensed', activation: 'error', error })
  })

  it('still reports demo when the backend answers with a business reason', async () => {
    mockCheckDeviceActivation.mockResolvedValue({ licensed: false, reason: 'no active subscription' })
    const r = await probeAndRecover(mockTransport(), { isLicensable: true, packageId: 'com.vendor.board' })
    expect(r).toMatchObject({ licenseStatus: 'unlicensed', activation: 'demo' })
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

  // The renderer cannot derive the device id (node:crypto is main-only), so it
  // shows and copies whatever this returns. A branch that omits it leaves the
  // popover with no id and the buy link with nothing to bind a purchase to.
  it.each([
    ['already licensed (no recover ran)', { readLicense: jest.fn(async () => ({ success: true, status: 0x7e })) }, undefined],
    ['no storage backend', { readLicense: jest.fn(async () => ({ success: true, status: 0x85, unsupported: true })) }, undefined],
    ['demo', {}, { licensed: false }],
    ['activation error', {}, { licensed: false, error: 'Activation request failed: 503 Service Unavailable' }],
    ['activated', {}, { licensed: true, license: new Array(98).fill(0) }],
  ])('carries the derived deviceId on a connected result — %s', async (_label, over, activation) => {
    if (activation) mockCheckDeviceActivation.mockResolvedValue(activation)
    const r = await probeAndRecover(mockTransport(over), { isLicensable: true, packageId: 'com.vendor.board' })
    expect(r.deviceId).toBe(DEVICE_ID_OF_01020304)
  })

  it('carries the deviceId even with no packageId to recover against', async () => {
    const r = await probeAndRecover(mockTransport(), { isLicensable: true })
    expect(r.deviceId).toBe(DEVICE_ID_OF_01020304)
  })

  // Showing one id while asking the backend about another would send users
  // chasing a license bound to an id they never saw.
  it('reports the same deviceId it asked the backend about', async () => {
    mockCheckDeviceActivation.mockResolvedValue({ licensed: false })
    const r = await probeAndRecover(mockTransport(), { isLicensable: true, packageId: 'com.vendor.board' })
    expect(mockCheckDeviceActivation).toHaveBeenCalledWith(expect.objectContaining({ deviceId: r.deviceId }))
  })

  // ADR-0002. The purchase is the only moment a key can be bound to a device, and
  // the buy link is how it gets there — so every result whose popover can offer
  // "Buy license" has to carry it, and the ones that cannot buy must not.
  describe('device public key for the purchase link', () => {
    it('reuses the key the proof already derived instead of paying the KDF twice', async () => {
      mockCheckDeviceActivation.mockResolvedValue({ licensed: false, devicePublicKey: KEY_FROM_PROOF })
      const r = await probeAndRecover(mockTransport(), { isLicensable: true, packageId: 'com.vendor.board' })
      expect(r.devicePublicKey).toBe(KEY_FROM_PROOF)
      expect(mockDeriveDeviceKeyPair).not.toHaveBeenCalled()
    })

    // The proof is skipped when the backend has no challenge route (rollout) — but
    // the user can still buy, so the key has to come from somewhere.
    it('derives the key locally when the activation carried none', async () => {
      mockCheckDeviceActivation.mockResolvedValue({ licensed: false })
      const r = await probeAndRecover(mockTransport(), { isLicensable: true, packageId: 'com.vendor.board' })
      expect(r.devicePublicKey).toBe(KEY_DERIVED_LOCALLY)
      expect(mockDeriveDeviceKeyPair).toHaveBeenCalledWith(new Uint8Array([1, 2, 3, 4]), DEVICE_ID_OF_01020304)
    })

    // Buy is offered on a failed check too (demoted, but present): a device whose
    // check never answered may well be unlicensed.
    it.each([
      ['demo', { licensed: false }],
      ['activation error', { licensed: false, error: 'Activation request failed: 503 Service Unavailable' }],
    ])('carries the key on %s, where the popover offers Buy', async (_label, activation) => {
      mockCheckDeviceActivation.mockResolvedValue(activation)
      const r = await probeAndRecover(mockTransport(), { isLicensable: true, packageId: 'com.vendor.board' })
      expect(r.devicePublicKey).toBe(KEY_DERIVED_LOCALLY)
    })

    it('carries the key with no packageId to recover against — Buy is still offered', async () => {
      const r = await probeAndRecover(mockTransport(), { isLicensable: true })
      expect(r.devicePublicKey).toBe(KEY_DERIVED_LOCALLY)
    })

    // Nothing to buy on these two, so nothing to bind — and deriving anyway would
    // charge every connect a memory-hard KDF for a value no one reads.
    it.each([
      ['a free VPP', { isLicensable: false }, {}],
      [
        'an already-licensed device',
        { isLicensable: true, packageId: 'com.vendor.board' },
        { readLicense: jest.fn(async () => ({ success: true, status: 0x7e })) },
      ],
    ])('omits the key for %s', async (_label, opts, over) => {
      const r = await probeAndRecover(mockTransport(over), opts)
      expect(r.devicePublicKey).toBeUndefined()
      expect(mockDeriveDeviceKeyPair).not.toHaveBeenCalled()
    })

    // A failed derivation must cost the purchase link, never the connection: the
    // board is connected and usable, and the backend logs the unbound activation.
    it('still connects when the derivation fails', async () => {
      mockCheckDeviceActivation.mockResolvedValue({ licensed: false })
      mockDeriveDeviceKeyPair.mockRejectedValue(new Error('cannot derive a device keypair from an empty anchor'))
      const r = await probeAndRecover(mockTransport(), { isLicensable: true, packageId: 'com.vendor.board' })
      expect(r).toMatchObject({ status: 'connected-with-firmware', activation: 'demo' })
      expect(r.devicePublicKey).toBeUndefined()
    })
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

  // The runtime-v4 (WebSocket) path reaches the SAME license popover, whose Buy
  // button builds the link that binds the key. Dropping it here would leave every
  // network purchase unbound while serial purchases bind correctly.
  it('carries the device public key through to the network path', () => {
    expect(
      toLegacyActivationOutcome({
        status: 'connected-with-firmware',
        anchorHex: '01020304',
        deviceId: DEVICE_ID_OF_01020304,
        devicePublicKey: KEY_FROM_PROOF,
        licenseStatus: 'unlicensed',
        activation: 'demo',
      }),
    ).toMatchObject({ outcome: 'demo', devicePublicKey: KEY_FROM_PROOF })
  })

  it('maps already-licensed to success:true with license.present', () => {
    expect(
      toLegacyActivationOutcome({
        status: 'connected-with-firmware',
        anchorHex: '01020304',
        licenseStatus: 'licensed',
        activation: 'already-licensed',
      }),
    ).toEqual({
      success: true,
      outcome: 'already-licensed',
      anchorHex: '01020304',
      licenseStatus: 'licensed',
      activation: 'already-licensed',
      license: { present: true },
    })
  })

  it('maps activated to success:true with license.present', () => {
    expect(
      toLegacyActivationOutcome({
        status: 'connected-with-firmware',
        anchorHex: '01020304',
        licenseStatus: 'licensed',
        activation: 'activated',
      }),
    ).toEqual({
      success: true,
      outcome: 'activated',
      anchorHex: '01020304',
      licenseStatus: 'licensed',
      activation: 'activated',
      license: { present: true },
    })
  })

  it('maps demo to success:true without a license field', () => {
    expect(
      toLegacyActivationOutcome({
        status: 'connected-with-firmware',
        anchorHex: '01020304',
        licenseStatus: 'unlicensed',
        activation: 'demo',
      }),
    ).toEqual({
      success: true,
      outcome: 'demo',
      anchorHex: '01020304',
      licenseStatus: 'unlicensed',
      activation: 'demo',
    })
  })

  it('maps unsupported to success:true, outcome:error (business state, not a transport failure)', () => {
    expect(
      toLegacyActivationOutcome({
        status: 'connected-with-firmware',
        anchorHex: '01020304',
        licenseStatus: 'unsupported',
        activation: 'unsupported',
      }),
    ).toEqual({
      success: true,
      outcome: 'error',
      anchorHex: '01020304',
      licenseStatus: 'unsupported',
      activation: 'unsupported',
      error: 'no on-device storage backend',
    })
  })

  // The runtime-v4 (WebSocket) license check reaches the license popover through
  // this shape; dropping the id here would leave network targets without one.
  it.each([
    ['already-licensed'],
    ['activated'],
    ['demo'],
    ['unsupported'],
    ['error'],
  ] as const)('carries the deviceId through the legacy shape (%s)', (activation) => {
    const out = toLegacyActivationOutcome({
      status: 'connected-with-firmware',
      anchorHex: '01020304',
      deviceId: DEVICE_ID_OF_01020304,
      activation,
    })
    expect(out.deviceId).toBe(DEVICE_ID_OF_01020304)
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
    ).toEqual({
      success: true,
      outcome: 'error',
      anchorHex: '01020304',
      licenseStatus: 'unlicensed',
      activation: 'error',
      error: 'crc mismatch',
    })
  })
})
