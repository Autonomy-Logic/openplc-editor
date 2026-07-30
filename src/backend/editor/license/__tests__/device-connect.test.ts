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

import { serializeLicenseBlob } from '../../../shared/debug/license-blob'
import { probeAndRecover, toLegacyActivationOutcome, verifyStoredLicenseBlob } from '../device-connect'
import { deriveVppId } from '../device-identity'

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

const PACKAGE_ID = 'com.vendor.board'

function bytesFromHex(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex, 'hex'))
}

/**
 * A blob that the D2 verifier must ACCEPT: correct magic, a crc32 the serializer
 * computed over 0..93, and the `device_id` / `product_id` this board and this
 * package derive to.
 *
 * Built with the shared `serializeLicenseBlob` — the same byte-identical module
 * `probeAndRecover` deserializes with, cross-pinned to the C struct by its own
 * golden vector — rather than a second hand-rolled layout here. The negative
 * cases below then MUTATE this known-good blob, which is what makes them mean
 * something: each one differs from an accepted blob in exactly one field.
 */
function validStoredBlob({
  deviceIdHex = DEVICE_ID_OF_01020304,
  packageId = PACKAGE_ID,
}: { deviceIdHex?: string; packageId?: string } = {}): Uint8Array {
  return serializeLicenseBlob({
    magic: 0, // forced to LIC_MAGIC_LE by the serializer
    fmtVersion: 1,
    keyId: 0,
    deviceId: bytesFromHex(deviceIdHex),
    productId: bytesFromHex(deriveVppId(packageId)),
    signature: new Uint8Array(64).fill(7),
    crc32: 0, // recomputed by the serializer
  })
}

/** A 0x4A response carrying `blob` with the SUCCESS status byte. */
function storedLicense(blob: Uint8Array): jest.Mock {
  return jest.fn(async (): Promise<DebugLicenseReadResult> => ({ success: true, status: 0x7e, blob }))
}

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
    const r = await probeAndRecover(mockTransport({ readLicense: storedLicense(validStoredBlob()) }), {
      isLicensable: true,
      packageId: PACKAGE_ID,
    })
    expect(r).toMatchObject({ status: 'connected-with-firmware', licenseStatus: 'licensed', activation: 'already-licensed' })
    expect(mockCheckDeviceActivation).not.toHaveBeenCalled()
  })

  // D2/A2. `0x7E` is NOT a verdict: the Linux runtime returns it for any 98-byte
  // file, so a cloned, truncated or foreign blob used to land `already-licensed`
  // and return BEFORE the backend was asked — skipping the only automatic repair
  // path there is, while the badge said "Licensed" and the closed gate ran demo.
  describe('the stored blob is verified before it is believed (D2)', () => {
    /** Each case mutates ONE field of a blob that would otherwise be accepted. */
    const rejected: Array<[string, Uint8Array | undefined]> = [
      ['no blob at all despite the 0x7E status', undefined],
      ['a 97-byte blob (truncated in flight)', validStoredBlob().subarray(0, 97)],
      ['an all-zero 98-byte blob (virgin file the runtime happily reports)', new Uint8Array(98)],
      [
        'the OPLC magic replaced',
        (() => {
          const b = validStoredBlob()
          b[0] = 0x00
          return b
        })(),
      ],
      [
        'one payload byte flipped, so the crc32 no longer matches',
        (() => {
          const b = validStoredBlob()
          b[4] ^= 0xff
          return b
        })(),
      ],
      [
        'a valid license CLONED FROM ANOTHER BOARD (crc fine, device_id foreign)',
        validStoredBlob({ deviceIdHex: 'ffffffffffffffffffffffffffffffff' }),
      ],
      ['a valid license for a DIFFERENT VPP (product_id mismatch)', validStoredBlob({ packageId: 'com.vendor.other' })],
    ]

    it.each(rejected)('asks the backend anyway when the device returns %s', async (_label, blob) => {
      mockCheckDeviceActivation.mockResolvedValue({ licensed: false })
      const readLicense = jest.fn(async (): Promise<DebugLicenseReadResult> => ({ success: true, status: 0x7e, blob }))
      const r = await probeAndRecover(mockTransport({ readLicense }), { isLicensable: true, packageId: PACKAGE_ID })
      expect(mockCheckDeviceActivation).toHaveBeenCalledTimes(1)
      expect(r).toMatchObject({ licenseStatus: 'unlicensed', activation: 'demo' })
    })

    // Without a packageId there is nothing to compare `product_id` against, so it
    // is left UNVERIFIED rather than assumed wrong — the alternative would refuse
    // every genuinely licensed board whose VPP declares no package id.
    it('accepts a valid blob with no packageId to check product_id against', async () => {
      const r = await probeAndRecover(mockTransport({ readLicense: storedLicense(validStoredBlob()) }), {
        isLicensable: true,
      })
      expect(r).toMatchObject({ licenseStatus: 'licensed', activation: 'already-licensed' })
      expect(mockCheckDeviceActivation).not.toHaveBeenCalled()
    })
  })

  // The function is exported and tested directly as well as through the flow: it
  // is the one place that decides whether "Licensed" may be shown at all.
  describe('verifyStoredLicenseBlob', () => {
    it('accepts a blob bound to this device and this product', () => {
      expect(verifyStoredLicenseBlob(validStoredBlob(), DEVICE_ID_OF_01020304, PACKAGE_ID)).toEqual({ ok: true })
    })

    it('names the foreign device id in the reason, so a support log says which board', () => {
      const verdict = verifyStoredLicenseBlob(
        validStoredBlob({ deviceIdHex: 'ffffffffffffffffffffffffffffffff' }),
        DEVICE_ID_OF_01020304,
        PACKAGE_ID,
      )
      expect(verdict).toEqual({
        ok: false,
        reason: `stored license is bound to device ffffffffffffffffffffffffffffffff, not ${DEVICE_ID_OF_01020304}`,
      })
    })

    it('rejects a bad crc32 rather than reading fields out of corrupted bytes', () => {
      const blob = validStoredBlob()
      blob[94] ^= 0xff
      expect(verifyStoredLicenseBlob(blob, DEVICE_ID_OF_01020304, PACKAGE_ID)).toMatchObject({ ok: false })
    })
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

  /**
   * A 0x4A that answers "empty" first and `blob` after the write — the real
   * sequence for a recover, and what lets the post-write read-back be asserted.
   */
  function readEmptyThen(blob: Uint8Array | undefined, statusAfter = 0x7e): jest.Mock {
    let calls = 0
    return jest.fn(async (): Promise<DebugLicenseReadResult> => {
      calls += 1
      if (calls === 1) return { success: true, status: 0x83, empty: true }
      return { success: true, status: statusAfter, blob }
    })
  }

  it('recovers and writes a license the backend returns (activated)', async () => {
    mockCheckDeviceActivation.mockResolvedValue({ licensed: true, license: Array.from(validStoredBlob()) })
    const writeLicense = jest.fn(async () => ({ success: true }))
    const readLicense = readEmptyThen(validStoredBlob())
    const r = await probeAndRecover(mockTransport({ writeLicense, readLicense }), {
      isLicensable: true,
      packageId: PACKAGE_ID,
    })
    expect(writeLicense).toHaveBeenCalledTimes(1)
    // Read twice: once to classify, once to CONFIRM what the board now holds.
    expect(readLicense).toHaveBeenCalledTimes(2)
    expect(r).toMatchObject({ licenseStatus: 'licensed', activation: 'activated' })
  })

  // A16. `0x49` only STORES bytes — no target validates them on write — so
  // `write.success` never meant "this board now holds a valid license", and the
  // popover asserted possession from it anyway. A blob signed for another
  // `device_id`, or a store that silently kept the old file, now surfaces as a
  // failed check instead of a green "Licensed" on a board running demo.
  describe('the write is confirmed by re-reading 0x4A (A16)', () => {
    const unconfirmed: Array<[string, () => jest.Mock]> = [
      ['the board still reports no license', () => readEmptyThen(undefined, 0x83)],
      ['the board reports a corrupt license', () => readEmptyThen(undefined, 0x84)],
      [
        'the stored blob is bound to another device',
        () => readEmptyThen(validStoredBlob({ deviceIdHex: 'ffffffffffffffffffffffffffffffff' })),
      ],
      ['the stored blob is for another VPP', () => readEmptyThen(validStoredBlob({ packageId: 'com.vendor.other' }))],
    ]

    it.each(unconfirmed)('reports a check failure, not "Licensed", when %s', async (_label, makeRead) => {
      mockCheckDeviceActivation.mockResolvedValue({ licensed: true, license: Array.from(validStoredBlob()) })
      const r = await probeAndRecover(mockTransport({ readLicense: makeRead() }), {
        isLicensable: true,
        packageId: PACKAGE_ID,
      })
      expect(r).toMatchObject({ licenseStatus: 'unlicensed', activation: 'error' })
      expect(r.error).toContain('could not be confirmed on the device')
    })

    it('says the READ-BACK failed when the confirming read never answered', async () => {
      mockCheckDeviceActivation.mockResolvedValue({ licensed: true, license: Array.from(validStoredBlob()) })
      let calls = 0
      const readLicense = jest.fn(async (): Promise<DebugLicenseReadResult> => {
        calls += 1
        if (calls === 1) return { success: true, status: 0x83, empty: true }
        return { success: false, error: 'serial timeout' }
      })
      const r = await probeAndRecover(mockTransport({ readLicense }), { isLicensable: true, packageId: PACKAGE_ID })
      expect(r).toMatchObject({ activation: 'error' })
      expect(r.error).toContain('read-back failed (serial timeout)')
    })
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
    ['already licensed (no recover ran)', { readLicense: storedLicense(validStoredBlob()) }, undefined],
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
        { isLicensable: true, packageId: PACKAGE_ID },
        { readLicense: storedLicense(validStoredBlob()) },
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

  // D6/A19. A backend that requires the proof refuses an unproven request with the
  // byte-identical answer "no purchase on record" gets, so `demo` alone cannot be
  // shown as "you have no license" — the renderer needs to know which it was, and
  // a `console.warn` in the main process is not a channel to a user.
  describe('whether the activation carried proof of possession travels out (D6)', () => {
    it.each([
      ['demo', { licensed: false, proofOfPossession: 'unproven' as const }, 'demo'],
      ['a check failure', { licensed: false, error: 'boom', proofOfPossession: 'unproven' as const }, 'error'],
    ])('reports unproven on %s', async (_label, activation, expected) => {
      mockCheckDeviceActivation.mockResolvedValue(activation)
      const r = await probeAndRecover(mockTransport(), { isLicensable: true, packageId: PACKAGE_ID })
      expect(r).toMatchObject({ activation: expected, proofOfPossession: 'unproven' })
    })

    it('reports proved when the challenge round-trip happened', async () => {
      mockCheckDeviceActivation.mockResolvedValue({ licensed: false, proofOfPossession: 'proved' })
      const r = await probeAndRecover(mockTransport(), { isLicensable: true, packageId: PACKAGE_ID })
      expect(r).toMatchObject({ activation: 'demo', proofOfPossession: 'proved' })
    })

    // Nothing was asked, so there is nothing to report — the renderer must not
    // read "we could not prove it" out of a request that never went out.
    it('leaves it undefined when the backend was never asked', async () => {
      const r = await probeAndRecover(mockTransport({ readLicense: storedLicense(validStoredBlob()) }), {
        isLicensable: true,
        packageId: PACKAGE_ID,
      })
      expect(r.proofOfPossession).toBeUndefined()
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

  // The runtime-v4 path shows the SAME "License Required" prompt, which must not
  // push a purchase when the request never carried proof (A19/D6).
  it('carries proofOfPossession through to the network path', () => {
    expect(
      toLegacyActivationOutcome({
        status: 'connected-with-firmware',
        anchorHex: '01020304',
        deviceId: DEVICE_ID_OF_01020304,
        licenseStatus: 'unlicensed',
        activation: 'demo',
        proofOfPossession: 'unproven',
      }),
    ).toMatchObject({ outcome: 'demo', proofOfPossession: 'unproven' })
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
