/**
 * @jest-environment node
 */
import { createHash, generateKeyPairSync, type KeyObject, sign } from 'node:crypto'

import { LIC_PAYLOAD_SIZE, serializeLicenseBlob } from '../../debug/license-blob'
import { BAREMETAL_RUNTIME_LICENSE_PRODUCT_ID } from '@root/middleware/shared/utils/licensing/runtime-license-keys'
import type { DebugLicenseReadResult, DebugLicenseWriteResult } from '../../debug/types'
import {
  type DeviceActivationInput,
  type DeviceActivationResult,
  inspectDeviceLicense,
  type LicenseReadWritable,
  resolveDeviceLicense as resolveWith,
} from '../license-flow'

const checkDeviceActivation = vi.fn<Promise<DeviceActivationResult>, [DeviceActivationInput]>()

function resolveDeviceLicense(link: LicenseReadWritable, input: Parameters<typeof resolveWith>[1]) {
  return resolveWith(link, input, checkDeviceActivation)
}

const LIC_SUCCESS = 0x7e
const LIC_EMPTY = 0x83

const ANCHOR = Uint8Array.from({ length: 16 }, (_, i) => 0xa0 + i)
const DEVICE_ID_HEX = createHash('sha256').update('openplc-dev-v1|').update(ANCHOR).digest('hex').slice(0, 32)
const DEVICE_ID = Uint8Array.from(Buffer.from(DEVICE_ID_HEX, 'hex'))
const RUNTIME_PRODUCT_ID = Uint8Array.from(
  createHash('sha256').update(BAREMETAL_RUNTIME_LICENSE_PRODUCT_ID).digest().subarray(0, 8),
)

function rawPublicKeyHex(publicKey: KeyObject): string {
  const jwk = publicKey.export({ format: 'jwk' })
  const hex = (b64: string | undefined) => Buffer.from(b64 ?? '', 'base64url').toString('hex')
  return hex(jwk.x) + hex(jwk.y)
}

const signer = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const other = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const KEY_ID = 3
const KEYS = { [KEY_ID]: rawPublicKeyHex(signer.publicKey) }

function issue(opts: { deviceId?: Uint8Array; productId?: Uint8Array; key?: KeyObject } = {}): Uint8Array {
  const fields = {
    magic: 0,
    fmtVersion: 1,
    keyId: KEY_ID,
    deviceId: opts.deviceId ?? DEVICE_ID,
    productId: opts.productId ?? RUNTIME_PRODUCT_ID,
    signature: new Uint8Array(64),
    crc32: 0,
  }
  const unsigned = serializeLicenseBlob(fields)
  const signature = sign('sha256', unsigned.subarray(0, LIC_PAYLOAD_SIZE), {
    key: opts.key ?? signer.privateKey,
    dsaEncoding: 'ieee-p1363',
  })
  return serializeLicenseBlob({ ...fields, signature: Uint8Array.from(signature) })
}

function transport(script: {
  reads: DebugLicenseReadResult[]
  write?: DebugLicenseWriteResult
}): LicenseReadWritable & {
  writes: Uint8Array[]
} {
  const reads = [...script.reads]
  const writes: Uint8Array[] = []
  return {
    writes,
    readLicense: () => {
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

const input = {
  identity: { kind: 'anchor' as const, anchor: ANCHOR },
  packageId: BAREMETAL_RUNTIME_LICENSE_PRODUCT_ID,
  runtimeKeys: KEYS,
}

beforeEach(() => {
  checkDeviceActivation.mockReset()
})

describe('runtime licence on a built-in board', () => {
  it('accepts a stored licence signed by a trusted key without asking Edge', async () => {
    const t = transport({ reads: [{ success: true, status: LIC_SUCCESS, blob: issue() }] })
    const report = await resolveDeviceLicense(t, input)
    expect(report).toEqual({ deviceId: DEVICE_ID_HEX, outcome: { state: 'licensed', how: 'already-stored' } })
    expect(checkDeviceActivation).not.toHaveBeenCalled()
  })

  it('treats a licence signed by an unknown key as absent and recovers from Edge', async () => {
    const good = issue()
    checkDeviceActivation.mockResolvedValue({ licensed: true, license: Array.from(good) })
    const t = transport({
      reads: [
        { success: true, status: LIC_SUCCESS, blob: issue({ key: other.privateKey }) },
        { success: true, status: LIC_SUCCESS, blob: good },
      ],
    })
    const report = await resolveDeviceLicense(t, input)
    expect(checkDeviceActivation).toHaveBeenCalledWith({
      deviceId: DEVICE_ID_HEX,
      packageId: BAREMETAL_RUNTIME_LICENSE_PRODUCT_ID,
    })
    expect(t.writes).toEqual([good])
    expect(report.outcome).toEqual({ state: 'licensed', how: 'activated' })
  })

  it('refuses a licence for another board, or a VPP licence for this one', async () => {
    const otherBoard = issue({ deviceId: new Uint8Array(16).fill(0x42) })
    const vppLicence = issue({
      productId: Uint8Array.from(createHash('sha256').update('com.openplc.esp32plc').digest().subarray(0, 8)),
    })
    for (const blob of [otherBoard, vppLicence]) {
      const t = transport({ reads: [{ success: true, status: LIC_SUCCESS, blob }] })
      const report = await inspectDeviceLicense(t, input)
      expect(report.outcome).toEqual({ state: 'unlicensed', entitlementChecked: false })
    }
  })

  it('reports unlicensed when Edge holds no licence for the board', async () => {
    checkDeviceActivation.mockResolvedValue({ licensed: false, reason: 'no license' })
    const t = transport({ reads: [{ success: true, status: LIC_EMPTY }] })
    const report = await resolveDeviceLicense(t, input)
    expect(report.outcome).toEqual({ state: 'unlicensed', entitlementChecked: true, backendReason: 'no license' })
    expect(t.writes).toEqual([])
  })

  it('does not write a licence from Edge whose signature does not verify', async () => {
    const forged = issue({ key: other.privateKey })
    checkDeviceActivation.mockResolvedValue({ licensed: true, license: Array.from(forged) })
    const t = transport({ reads: [{ success: true, status: LIC_EMPTY }] })
    const report = await resolveDeviceLicense(t, input)
    expect(t.writes).toEqual([])
    expect(report.outcome).toEqual({
      state: 'unlicensed',
      entitlementChecked: false,
      detail:
        'The license server sent a license that does not verify. ' +
        'The license stored on this device has a signature this editor does not accept.',
    })
  })

  it('reports unlicensed when the stored licence fails and Edge cannot be reached', async () => {
    const changed = issue()
    changed[40] ^= 0x01
    const stored = [
      issue({ deviceId: new Uint8Array(16).fill(0x42) }),
      issue({ productId: new Uint8Array(8).fill(0x11) }),
      issue({ key: other.privateKey }),
      changed,
    ]
    checkDeviceActivation.mockResolvedValue({ licensed: false, error: 'Edge unreachable' })
    for (const blob of stored) {
      const t = transport({ reads: [{ success: true, status: LIC_SUCCESS, blob }] })
      const report = await resolveDeviceLicense(t, input)
      expect(report.outcome).toEqual({ state: 'unlicensed', entitlementChecked: false, detail: 'Edge unreachable' })
      expect(t.writes).toEqual([])
    }
  })

  it('reports unlicensed when Edge says licensed but sends no licence data', async () => {
    checkDeviceActivation.mockResolvedValue({ licensed: true })
    const t = transport({ reads: [{ success: true, status: LIC_EMPTY }] })
    const report = await resolveDeviceLicense(t, input)
    expect(report.outcome).toEqual({
      state: 'unlicensed',
      entitlementChecked: false,
      detail: 'The license server reported a license but sent no license data.',
    })
  })

  it('reports unlicensed for a board that reports no device ID', async () => {
    const t = transport({ reads: [] })
    const report = await resolveDeviceLicense(t, { ...input, identity: { kind: 'anchor', anchor: new Uint8Array(0) } })
    expect(report).toEqual({
      outcome: { state: 'unlicensed', entitlementChecked: false, detail: 'This board reports no device ID.' },
    })
    expect(checkDeviceActivation).not.toHaveBeenCalled()
  })

  it('keeps check-failed when the board cannot be read or written', async () => {
    const unread = transport({ reads: [{ success: false, error: 'timeout' }] })
    expect((await resolveDeviceLicense(unread, input)).outcome).toEqual({ state: 'check-failed', error: 'timeout' })

    checkDeviceActivation.mockResolvedValue({ licensed: true, license: Array.from(issue()) })
    const unwritable = transport({
      reads: [{ success: true, status: LIC_EMPTY }],
      write: { success: false, error: 'busy' },
    })
    expect((await resolveDeviceLicense(unwritable, input)).outcome).toEqual({ state: 'check-failed', error: 'busy' })
  })

  it('for a VPP package, an unreachable Edge stays check-failed', async () => {
    checkDeviceActivation.mockResolvedValue({ licensed: false, error: 'Edge unreachable' })
    const t = transport({ reads: [{ success: true, status: LIC_EMPTY }] })
    const vpp = { ...input, packageId: 'com.openplc.espressif-licensed', runtimeKeys: undefined }
    const report = await resolveDeviceLicense(t, vpp)
    expect(report.outcome).toEqual({ state: 'check-failed', error: 'Edge unreachable' })
  })

  it('with no keys given, checks the baremetal product against the shipped production keys', async () => {
    const t = transport({ reads: [{ success: true, status: LIC_SUCCESS, blob: issue({}) }] })
    const report = await inspectDeviceLicense(t, { ...input, runtimeKeys: undefined })
    expect(report.outcome).toMatchObject({ state: 'unlicensed', entitlementChecked: false })
  })
})
