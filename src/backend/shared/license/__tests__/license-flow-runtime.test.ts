/**
 * @jest-environment node
 */
import { createHash, generateKeyPairSync, type KeyObject, sign } from 'node:crypto'

import { LIC_PAYLOAD_SIZE, serializeLicenseBlob } from '../../../shared/debug/license-blob'
import { RUNTIME_LICENSE_PRODUCT } from '../../../shared/debug/runtime-license-verify'
import type { DebugLicenseReadResult, DebugLicenseWriteResult } from '../../../shared/debug/types'
import { deriveDeviceId, deriveVppId } from '../device-identity'
import { inspectDeviceLicense, type LicenseReadWritable, resolveDeviceLicense } from '../license-flow'

jest.mock('../license-activation-client', () => ({
  checkDeviceActivation: jest.fn(),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { checkDeviceActivation } = require('../license-activation-client') as {
  checkDeviceActivation: jest.Mock
}

const LIC_SUCCESS = 0x7e
const LIC_EMPTY = 0x83

const ANCHOR = Uint8Array.from({ length: 16 }, (_, i) => 0xa0 + i)
const DEVICE_ID_HEX = deriveDeviceId(ANCHOR)
const DEVICE_ID = Uint8Array.from(Buffer.from(DEVICE_ID_HEX, 'hex'))
const RUNTIME_PRODUCT_ID = Uint8Array.from(createHash('sha256').update(RUNTIME_LICENSE_PRODUCT).digest().subarray(0, 8))

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
  packageId: RUNTIME_LICENSE_PRODUCT,
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
    expect(checkDeviceActivation).toHaveBeenCalledWith({ deviceId: DEVICE_ID_HEX, packageId: RUNTIME_LICENSE_PRODUCT })
    expect(t.writes).toEqual([good])
    expect(report.outcome).toEqual({ state: 'licensed', how: 'activated' })
  })

  it('refuses a licence for another board, or a VPP licence for this one', async () => {
    const otherBoard = issue({ deviceId: new Uint8Array(16).fill(0x42) })
    const vppLicence = issue({ productId: Uint8Array.from(Buffer.from(deriveVppId('com.openplc.esp32plc'), 'hex')) })
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

  it('does not confirm a written licence whose signature does not verify', async () => {
    const forged = issue({ key: other.privateKey })
    checkDeviceActivation.mockResolvedValue({ licensed: true, license: Array.from(forged) })
    const t = transport({
      reads: [
        { success: true, status: LIC_EMPTY },
        { success: true, status: LIC_SUCCESS, blob: forged },
      ],
    })
    const report = await resolveDeviceLicense(t, input)
    expect(report.outcome).toEqual({
      state: 'check-failed',
      error:
        'The license was written but could not be confirmed on the device. ' +
        'The license stored on this device has a signature this editor does not accept.',
    })
  })

  it('without runtime keys, keeps the VPP check, which does not look at the signature', async () => {
    const t = transport({ reads: [{ success: true, status: LIC_SUCCESS, blob: issue({ key: other.privateKey }) }] })
    const report = await inspectDeviceLicense(t, { ...input, runtimeKeys: undefined })
    expect(report.outcome).toEqual({ state: 'licensed', how: 'already-stored' })
  })
})
