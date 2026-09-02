import { serializeLicenseBlob } from '../../../shared/debug/license-blob'
import type { DebugLicenseReadResult, DebugLicenseWriteResult } from '../../../shared/debug/types'
import { deriveDeviceId, deriveVppId } from '../device-identity'
import {
  inspectDeviceLicense,
  type LicenseReadWritable,
  resolveDeviceLicense,
  verifyStoredLicenseBlob,
} from '../license-flow'

jest.mock('../license-activation-client', () => ({
  checkDeviceActivation: jest.fn(),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { checkDeviceActivation } = require('../license-activation-client') as {
  checkDeviceActivation: jest.Mock
}

const LIC_SUCCESS = 0x7e
const LIC_EMPTY = 0x83
const LIC_UNSUPPORTED = 0x85

/** The real NodeMCU hardware anchor, and the ids that derive from it. */
const ANCHOR = Uint8Array.from([0, 177, 140, 237])
const PACKAGE_ID = 'com.openplc.espressif-licensed'
const DEVICE_ID = deriveDeviceId(ANCHOR)

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** A well-formed 98-byte blob for the given device + package. */
function blobFor({ deviceId = DEVICE_ID, packageId = PACKAGE_ID }: { deviceId?: string; packageId?: string } = {}) {
  return serializeLicenseBlob({
    magic: 0, // forced to the canonical magic by the serializer
    fmtVersion: 1,
    keyId: 0,
    deviceId: hexToBytes(deviceId),
    productId: hexToBytes(deriveVppId(packageId)),
    signature: new Uint8Array(64).fill(7),
    crc32: 0, // recomputed by the serializer
  })
}

/** A scripted transport: successive readLicense() calls pop the queue. */
function transport(script: {
  reads: DebugLicenseReadResult[]
  write?: DebugLicenseWriteResult
}): LicenseReadWritable & { writes: Uint8Array[]; readCount: () => number } {
  const reads = [...script.reads]
  const writes: Uint8Array[] = []
  let readCount = 0
  return {
    writes,
    readCount: () => readCount,
    readLicense: () => {
      readCount++
      const next = reads.shift()
      if (!next) throw new Error('test transport: unexpected extra readLicense()')
      return Promise.resolve(next)
    },
    writeLicense: (blob: Uint8Array) => {
      writes.push(blob)
      return Promise.resolve(script.write ?? { success: true, status: LIC_SUCCESS })
    },
  }
}

beforeEach(() => {
  checkDeviceActivation.mockReset()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// verifyStoredLicenseBlob
// ---------------------------------------------------------------------------

describe('verifyStoredLicenseBlob', () => {
  it('accepts a blob bound to this device and this package', () => {
    expect(verifyStoredLicenseBlob(blobFor(), DEVICE_ID, PACKAGE_ID)).toEqual({ ok: true })
  })

  it('rejects a blob bound to ANOTHER device (the clone case)', () => {
    // Valid bytes, wrong board. The device answers 0x7E for it and the closed
    // gate answers DEVICE_MISMATCH — believing the status byte here is what makes
    // the badge say "Licensed" on a board running demo.
    const other = deriveDeviceId(Uint8Array.from([9, 9, 9, 9]))
    const verdict = verifyStoredLicenseBlob(blobFor({ deviceId: other }), DEVICE_ID, PACKAGE_ID)

    // The reason reaches the user verbatim, so it must not carry the two 32-hex
    // ids — it says WHICH device, not which bytes.
    expect(verdict).toEqual({ ok: false, reason: 'the stored licence was issued for a different device' })
  })

  it('rejects a blob issued for another VPP', () => {
    const verdict = verifyStoredLicenseBlob(blobFor({ packageId: 'com.openplc.other-licensed' }), DEVICE_ID, PACKAGE_ID)

    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toBe('the stored licence was issued for a different VPP')
  })

  it('rejects a blob whose crc32 does not cover its bytes (tampered or truncated in place)', () => {
    const tampered = blobFor()
    tampered[40] ^= 0xff // flip a signature byte; the stored crc32 no longer matches

    const verdict = verifyStoredLicenseBlob(tampered, DEVICE_ID, PACKAGE_ID)

    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toMatch(/checksum/)
  })

  it('rejects a blob with no OPLC magic', () => {
    const noMagic = blobFor()
    noMagic[0] = 0x00

    const verdict = verifyStoredLicenseBlob(noMagic, DEVICE_ID, PACKAGE_ID)

    expect(verdict.ok).toBe(false)
    // Magic is checked before crc32, so the message names the real problem.
    if (!verdict.ok) expect(verdict.reason).toMatch(/no OPLC magic/)
  })

  it('rejects a short or absent blob rather than parsing past the end', () => {
    expect(verifyStoredLicenseBlob(undefined, DEVICE_ID, PACKAGE_ID)).toEqual({
      ok: false,
      reason: 'the stored licence is not a complete licence record',
    })
    expect(verifyStoredLicenseBlob(blobFor().subarray(0, 40), DEVICE_ID, PACKAGE_ID)).toEqual({
      ok: false,
      reason: 'the stored licence is not a complete licence record',
    })
  })

  it('leaves productId unverified when no package id is known, rather than assuming it good', () => {
    const foreign = blobFor({ packageId: 'com.openplc.other-licensed' })

    expect(verifyStoredLicenseBlob(foreign, DEVICE_ID, undefined)).toEqual({ ok: true })
  })
})

// ---------------------------------------------------------------------------
// resolveDeviceLicense
// ---------------------------------------------------------------------------

describe('resolveDeviceLicense', () => {
  it('reports an already-stored license without asking the backend', async () => {
    const link = transport({ reads: [{ success: true, status: LIC_SUCCESS, blob: blobFor() }] })

    const result = await resolveDeviceLicense(link, {
      identity: { kind: 'anchor', anchor: ANCHOR },
      packageId: PACKAGE_ID,
    })

    expect(result).toEqual({ deviceId: DEVICE_ID, outcome: { state: 'licensed', how: 'already-stored' } })
    expect(checkDeviceActivation).not.toHaveBeenCalled()
    expect(link.writes).toHaveLength(0)
  })

  it('recovers from the backend when storage is empty, then re-reads to confirm', async () => {
    const blob = blobFor()
    checkDeviceActivation.mockResolvedValue({ licensed: true, license: Array.from(blob) })
    const link = transport({
      reads: [
        { success: true, status: LIC_EMPTY, empty: true },
        { success: true, status: LIC_SUCCESS, blob },
      ],
    })

    const result = await resolveDeviceLicense(link, {
      identity: { kind: 'anchor', anchor: ANCHOR },
      packageId: PACKAGE_ID,
    })

    expect(result).toEqual({ deviceId: DEVICE_ID, outcome: { state: 'licensed', how: 'activated' } })
    expect(checkDeviceActivation).toHaveBeenCalledWith({ deviceId: DEVICE_ID, packageId: PACKAGE_ID })
    expect(Array.from(link.writes[0])).toEqual(Array.from(blob))
    // Two reads: the initial probe and the mandatory read-back.
    expect(link.readCount()).toBe(2)
  })

  it('FALLS THROUGH to recovery when the device reports a license that does not verify', async () => {
    // 0x7E with a blob for another board. This is the case recovery exists for:
    // believing the status byte would skip the only automatic repair path and
    // leave the board in demo with a "Licensed" badge.
    const foreign = blobFor({ deviceId: deriveDeviceId(Uint8Array.from([1, 2, 3, 4])) })
    const good = blobFor()
    checkDeviceActivation.mockResolvedValue({ licensed: true, license: Array.from(good) })
    const link = transport({
      reads: [
        { success: true, status: LIC_SUCCESS, blob: foreign },
        { success: true, status: LIC_SUCCESS, blob: good },
      ],
    })

    const result = await resolveDeviceLicense(link, {
      identity: { kind: 'anchor', anchor: ANCHOR },
      packageId: PACKAGE_ID,
    })

    expect(checkDeviceActivation).toHaveBeenCalled()
    expect(result.outcome).toEqual({ state: 'licensed', how: 'activated' })
  })

  it('reports unlicensed (demo + buy) when the backend says there is no purchase', async () => {
    checkDeviceActivation.mockResolvedValue({ licensed: false, reason: 'no active subscription' })
    const link = transport({ reads: [{ success: true, status: LIC_EMPTY, empty: true }] })

    const result = await resolveDeviceLicense(link, {
      identity: { kind: 'anchor', anchor: ANCHOR },
      packageId: PACKAGE_ID,
    })

    // `entitlementChecked: true` is what earns the UI the right to offer a
    // purchase: the backend WAS asked and said no.
    expect(result.outcome).toEqual({
      state: 'unlicensed',
      entitlementChecked: true,
      backendReason: 'no active subscription',
    })
    expect(link.writes).toHaveLength(0)
  })

  it('reports check-failed — NOT unlicensed — when the backend could not be reached', async () => {
    // The distinction that matters most in this module: collapsing a transport
    // failure into "no purchase" tells someone who already paid to buy again.
    checkDeviceActivation.mockResolvedValue({ licensed: false, error: 'Activation request failed: 429' })
    const link = transport({ reads: [{ success: true, status: LIC_EMPTY, empty: true }] })

    const result = await resolveDeviceLicense(link, {
      identity: { kind: 'anchor', anchor: ANCHOR },
      packageId: PACKAGE_ID,
    })

    expect(result.outcome).toEqual({ state: 'check-failed', error: 'Activation request failed: 429' })
  })

  it('reports unsupported when the device has no storage backend', async () => {
    const link = transport({ reads: [{ success: true, status: LIC_UNSUPPORTED, unsupported: true }] })

    const result = await resolveDeviceLicense(link, {
      identity: { kind: 'anchor', anchor: ANCHOR },
      packageId: PACKAGE_ID,
    })

    expect(result).toEqual({ deviceId: DEVICE_ID, outcome: { state: 'unsupported' } })
    expect(checkDeviceActivation).not.toHaveBeenCalled()
  })

  it('never derives an id from an empty anchor', async () => {
    // sha256(prefix || <nothing>) is a CONSTANT: every board without an identity
    // would share one device id, so one purchase would license the whole fleet.
    const link = transport({ reads: [] })

    const result = await resolveDeviceLicense(link, {
      identity: { kind: 'anchor', anchor: new Uint8Array(0) },
      packageId: PACKAGE_ID,
    })

    expect(result.deviceId).toBeUndefined()
    expect(result.outcome.state).toBe('check-failed')
    if (result.outcome.state === 'check-failed') {
      expect(result.outcome.error).toMatch(/did not report an identity a licence can be issued for/)
      // Terminal: re-asking cannot change it, so the UI must not offer a retry.
      expect(result.outcome.retryable).toBe(false)
      // The message names the ACTION (rebuild), not the internals. "license-core"
      // is a component the user cannot act on.
      expect(result.outcome.error).toMatch(/rebuild and upload/i)
      expect(result.outcome.error).not.toMatch(/license-core/i)
    }
    expect(link.readCount()).toBe(0)
    expect(checkDeviceActivation).not.toHaveBeenCalled()
  })

  /*
   * The baremetal half of the union (DOPE-589). The board reports an id the
   * closed license-core already derived, so the editor must USE it, not hash it
   * again: a second hash would produce an identity the device can never
   * reproduce and no licence was ever issued for.
   */
  it('uses a reported device id as-is, without hashing it again', async () => {
    const reported = Uint8Array.from(Buffer.from(DEVICE_ID, 'hex'))
    const link = transport({ reads: [] })

    const result = await resolveDeviceLicense(link, {
      identity: { kind: 'device-id', deviceId: reported },
      packageId: PACKAGE_ID,
    })

    // Same hex the anchor path derives for this board: the two halves of the
    // union agree on the identity, which is the whole point of the move.
    expect(result.deviceId).toBe(DEVICE_ID)
    expect(deriveDeviceId(reported)).not.toBe(DEVICE_ID) // hashing again WOULD differ
  })

  it('refuses an empty reported device id', async () => {
    const link = transport({ reads: [] })

    const result = await resolveDeviceLicense(link, {
      identity: { kind: 'device-id', deviceId: new Uint8Array(0) },
      packageId: PACKAGE_ID,
    })

    expect(result.deviceId).toBeUndefined()
    expect(result.outcome.state).toBe('check-failed')
    if (result.outcome.state === 'check-failed') {
      expect(result.outcome.error).toMatch(/did not report an identity a licence can be issued for/)
      // Terminal: re-asking cannot change it, so the UI must not offer a retry.
      expect(result.outcome.retryable).toBe(false)
      // The message names the ACTION (rebuild), not the internals. "license-core"
      // is a component the user cannot act on.
      expect(result.outcome.error).toMatch(/rebuild and upload/i)
      expect(result.outcome.error).not.toMatch(/license-core/i)
    }
    expect(link.readCount()).toBe(0)
    expect(checkDeviceActivation).not.toHaveBeenCalled()
  })

  it('refuses a reported device id of the wrong length', async () => {
    // 9 bytes is what an AVR ArduinoUniqueID used to report on 0x48. A firmware
    // that still answers a raw anchor there, against a license-core that
    // derives, would send a customer to checkout for an id no device holds.
    const link = transport({ reads: [] })

    const result = await resolveDeviceLicense(link, {
      identity: { kind: 'device-id', deviceId: new Uint8Array(9) },
      packageId: PACKAGE_ID,
    })

    expect(result.deviceId).toBeUndefined()
    expect(result.outcome.state).toBe('check-failed')
    if (result.outcome.state === 'check-failed') {
      // The width is an internal contract; it used to be the FIRST thing a user
      // saw when connecting a board flashed by an older editor.
      expect(result.outcome.error).toMatch(/format this editor does not recognise/)
      expect(result.outcome.error).toMatch(/rebuild and upload/i)
      expect(result.outcome.error).not.toMatch(/\d+-byte|expected 16/)
      expect(result.outcome.retryable).toBe(false)
    }
    expect(link.readCount()).toBe(0)
    expect(checkDeviceActivation).not.toHaveBeenCalled()
  })

  it('reports check-failed when the device does not answer the read at all', async () => {
    const link = transport({ reads: [{ success: false, error: 'Request timeout' }] })

    const result = await resolveDeviceLicense(link, {
      identity: { kind: 'anchor', anchor: ANCHOR },
      packageId: PACKAGE_ID,
    })

    expect(result).toEqual({ deviceId: DEVICE_ID, outcome: { state: 'check-failed', error: 'Request timeout' } })
  })

  it('does not assert possession when the write succeeds but the read-back does not verify', async () => {
    // 0x49 only stores bytes — no target validates them on write. A blob truncated
    // in flight would otherwise read as "Licensed" while the board runs demo.
    const good = blobFor()
    const truncated = blobFor().subarray(0, 60)
    checkDeviceActivation.mockResolvedValue({ licensed: true, license: Array.from(good) })
    const link = transport({
      reads: [
        { success: true, status: LIC_EMPTY, empty: true },
        { success: true, status: LIC_SUCCESS, blob: truncated },
      ],
    })

    const result = await resolveDeviceLicense(link, {
      identity: { kind: 'anchor', anchor: ANCHOR },
      packageId: PACKAGE_ID,
    })

    expect(result.outcome.state).toBe('check-failed')
    if (result.outcome.state === 'check-failed') {
      expect(result.outcome.error).toMatch(/written but could not be confirmed on the device/)
    }
  })

  it('does not assert possession when the read-back itself fails', async () => {
    checkDeviceActivation.mockResolvedValue({ licensed: true, license: Array.from(blobFor()) })
    const link = transport({
      reads: [
        { success: true, status: LIC_EMPTY, empty: true },
        { success: false, error: 'Request timeout' },
      ],
    })

    const result = await resolveDeviceLicense(link, {
      identity: { kind: 'anchor', anchor: ANCHOR },
      packageId: PACKAGE_ID,
    })

    expect(result.outcome.state).toBe('check-failed')
    if (result.outcome.state === 'check-failed') {
      expect(result.outcome.error).toMatch(/reading it back failed/)
    }
  })

  it('reports unsupported when the WRITE is the thing that reveals no storage backend', async () => {
    checkDeviceActivation.mockResolvedValue({ licensed: true, license: Array.from(blobFor()) })
    const link = transport({
      reads: [{ success: true, status: LIC_EMPTY, empty: true }],
      write: { success: true, status: LIC_UNSUPPORTED, unsupported: true },
    })

    const result = await resolveDeviceLicense(link, {
      identity: { kind: 'anchor', anchor: ANCHOR },
      packageId: PACKAGE_ID,
    })

    expect(result.outcome).toEqual({ state: 'unsupported' })
  })

  it('reports check-failed when the write is refused', async () => {
    checkDeviceActivation.mockResolvedValue({ licensed: true, license: Array.from(blobFor()) })
    const link = transport({
      reads: [{ success: true, status: LIC_EMPTY, empty: true }],
      write: { success: false, error: 'ERROR_OUT_OF_MEMORY' },
    })

    const result = await resolveDeviceLicense(link, {
      identity: { kind: 'anchor', anchor: ANCHOR },
      packageId: PACKAGE_ID,
    })

    expect(result.outcome).toEqual({ state: 'check-failed', error: 'ERROR_OUT_OF_MEMORY' })
  })

  it('reports check-failed when the backend claims licensed but returns no blob', async () => {
    checkDeviceActivation.mockResolvedValue({ licensed: true })
    const link = transport({ reads: [{ success: true, status: LIC_EMPTY, empty: true }] })

    const result = await resolveDeviceLicense(link, {
      identity: { kind: 'anchor', anchor: ANCHOR },
      packageId: PACKAGE_ID,
    })

    expect(result.outcome.state).toBe('check-failed')
    if (result.outcome.state === 'check-failed') {
      expect(result.outcome.error).toMatch(/returned nothing to write/)
    }
    expect(link.writes).toHaveLength(0)
  })

  it('turns an unexpected throw from the transport into check-failed, never a rejection', async () => {
    const link: LicenseReadWritable = {
      readLicense: () => Promise.reject(new Error('port closed')),
      writeLicense: () => Promise.resolve({ success: true }),
    }

    const result = await resolveDeviceLicense(link, {
      identity: { kind: 'anchor', anchor: ANCHOR },
      packageId: PACKAGE_ID,
    })

    expect(result).toEqual({ deviceId: DEVICE_ID, outcome: { state: 'check-failed', error: 'port closed' } })
  })
})

// ---------------------------------------------------------------------------
// inspectDeviceLicense — read + verify, never the network
// ---------------------------------------------------------------------------

describe('inspectDeviceLicense', () => {
  it('confirms a stored, verified license', async () => {
    const link = transport({ reads: [{ success: true, status: LIC_SUCCESS, blob: blobFor() }] })

    const result = await inspectDeviceLicense(link, {
      identity: { kind: 'anchor', anchor: ANCHOR },
      packageId: PACKAGE_ID,
    })

    expect(result).toEqual({ deviceId: DEVICE_ID, outcome: { state: 'licensed', how: 'already-stored' } })
  })

  it('NEVER contacts the backend, even when the device holds nothing', async () => {
    const link = transport({ reads: [{ success: true, status: LIC_EMPTY, empty: true }] })

    await inspectDeviceLicense(link, { identity: { kind: 'anchor', anchor: ANCHOR }, packageId: PACKAGE_ID })

    // The whole point of this entry point: cheap enough for a screen open.
    expect(checkDeviceActivation).not.toHaveBeenCalled()
    expect(link.writes).toHaveLength(0)
  })

  it('reports unlicensed with entitlementChecked:false, so the UI offers a refresh and not a purchase', async () => {
    // Nobody has asked whether a purchase exists. Rendering this as "buy a
    // license" would be a guess, and the wrong one for anyone who already paid.
    const link = transport({ reads: [{ success: true, status: LIC_EMPTY, empty: true }] })

    const result = await inspectDeviceLicense(link, {
      identity: { kind: 'anchor', anchor: ANCHOR },
      packageId: PACKAGE_ID,
    })

    expect(result.outcome).toEqual({ state: 'unlicensed', entitlementChecked: false })
  })

  it('treats a stored blob that fails verification as not licensed, not as licensed', async () => {
    const foreign = blobFor({ deviceId: deriveDeviceId(Uint8Array.from([1, 2, 3, 4])) })
    const link = transport({ reads: [{ success: true, status: LIC_SUCCESS, blob: foreign }] })

    const result = await inspectDeviceLicense(link, {
      identity: { kind: 'anchor', anchor: ANCHOR },
      packageId: PACKAGE_ID,
    })

    expect(result.outcome).toEqual({ state: 'unlicensed', entitlementChecked: false })
  })

  it('reports unsupported when the device has no storage backend', async () => {
    const link = transport({ reads: [{ success: true, status: LIC_UNSUPPORTED, unsupported: true }] })

    const result = await inspectDeviceLicense(link, {
      identity: { kind: 'anchor', anchor: ANCHOR },
      packageId: PACKAGE_ID,
    })

    expect(result.outcome).toEqual({ state: 'unsupported' })
  })

  it('reports check-failed when the device does not answer', async () => {
    const link = transport({ reads: [{ success: false, error: 'Request timeout' }] })

    const result = await inspectDeviceLicense(link, {
      identity: { kind: 'anchor', anchor: ANCHOR },
      packageId: PACKAGE_ID,
    })

    expect(result.outcome).toEqual({ state: 'check-failed', error: 'Request timeout' })
  })

  it('refuses an empty anchor without reading anything', async () => {
    const link = transport({ reads: [] })

    const result = await inspectDeviceLicense(link, {
      identity: { kind: 'anchor', anchor: new Uint8Array(0) },
      packageId: PACKAGE_ID,
    })

    expect(result.deviceId).toBeUndefined()
    expect(result.outcome.state).toBe('check-failed')
    expect(link.readCount()).toBe(0)
  })

  it('turns an unexpected throw into check-failed', async () => {
    const link: LicenseReadWritable = {
      readLicense: () => Promise.reject(new Error('port closed')),
      writeLicense: () => Promise.resolve({ success: true }),
    }

    const result = await inspectDeviceLicense(link, {
      identity: { kind: 'anchor', anchor: ANCHOR },
      packageId: PACKAGE_ID,
    })

    expect(result).toEqual({ deviceId: DEVICE_ID, outcome: { state: 'check-failed', error: 'port closed' } })
  })
})
