/**
 * @jest-environment node
 */
import { serializeLicenseBlob } from '../../../shared/debug/license-blob'
import type { DebugDeviceIdResult, DebugLicenseReadResult, DeviceIdSource } from '../../../shared/debug/types'
import {
  BOARD_BACKUP_TTL_MS,
  type BoardLicenceBackup,
  restoreBoardLicence,
  takeBoardLicenceBackup,
  usableBoardBackup,
} from '../board-licence-backup'
import { deriveDeviceId } from '../device-identity'

const LIC_SUCCESS = 0x7e
const LIC_EMPTY = 0x83
const LIC_CORRUPT = 0x84
const PORT = '/dev/cu.usbmodem1'

const GENERATED = Uint8Array.from({ length: 16 }, (_, i) => 0x10 + i)
const HARDWARE = Uint8Array.from({ length: 16 }, (_, i) => 0xa0 + i)

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex, 'hex'))
}

function blobFor(anchor: Uint8Array): Uint8Array {
  return serializeLicenseBlob({
    magic: 0,
    fmtVersion: 1,
    keyId: 7,
    deviceId: hexToBytes(deriveDeviceId(anchor)),
    productId: new Uint8Array(8).fill(0x33),
    signature: new Uint8Array(64).fill(0x55),
    crc32: 0,
  })
}

function channel(ids: DebugDeviceIdResult, stored: DebugLicenseReadResult) {
  return {
    getDeviceId: jest.fn(() => Promise.resolve(ids)),
    readLicense: jest.fn(() => Promise.resolve(stored)),
  }
}

const one = (source: DeviceIdSource): DebugDeviceIdResult => ({ success: true, sources: [source] })

describe('takeBoardLicenceBackup', () => {
  it('keeps the generated ID and the licence bound to it', async () => {
    const blob = blobFor(GENERATED)
    const c = channel(one({ kind: 'generated', bytes: GENERATED }), { success: true, status: LIC_SUCCESS, blob })

    const backup = await takeBoardLicenceBackup(c, PORT, 1000)

    expect(backup).toEqual({
      port: PORT,
      deviceId: deriveDeviceId(GENERATED),
      generatedId: GENERATED,
      blob,
      takenAt: 1000,
    })
  })

  it('keeps only the licence on a board with a factory ID', async () => {
    const blob = blobFor(HARDWARE)
    const c = channel(one({ kind: 'hardware', bytes: HARDWARE }), { success: true, status: LIC_SUCCESS, blob })

    const backup = await takeBoardLicenceBackup(c, PORT)

    expect(backup?.generatedId).toBeUndefined()
    expect(backup?.blob).toEqual(blob)
  })

  it('drops a stored licence issued for another board', async () => {
    const c = channel(one({ kind: 'generated', bytes: GENERATED }), {
      success: true,
      status: LIC_SUCCESS,
      blob: blobFor(HARDWARE),
    })

    const backup = await takeBoardLicenceBackup(c, PORT)

    expect(backup?.generatedId).toEqual(GENERATED)
    expect(backup?.blob).toBeUndefined()
  })

  it('drops a stored licence whose crc does not match', async () => {
    const blob = blobFor(HARDWARE)
    blob[40] ^= 0xff
    const c = channel(one({ kind: 'hardware', bytes: HARDWARE }), { success: true, status: LIC_SUCCESS, blob })

    expect(await takeBoardLicenceBackup(c, PORT)).toBeNull()
  })

  it('returns null for a factory-ID board with an empty store', async () => {
    const c = channel(one({ kind: 'hardware', bytes: HARDWARE }), { success: true, status: LIC_EMPTY, empty: true })

    expect(await takeBoardLicenceBackup(c, PORT)).toBeNull()
  })

  it('returns null without reading the store when the identity read fails or has no single source', async () => {
    for (const ids of [
      { success: false, error: 'timeout' },
      { success: true, sources: [] },
      {
        success: true,
        sources: [
          { kind: 'hardware' as const, bytes: HARDWARE },
          { kind: 'generated' as const, bytes: GENERATED },
        ],
      },
    ]) {
      const c = channel(ids, { success: true, status: LIC_EMPTY, empty: true })
      expect(await takeBoardLicenceBackup(c, PORT)).toBeNull()
      expect(c.readLicense).not.toHaveBeenCalled()
    }
  })
})

describe('usableBoardBackup', () => {
  const backup: BoardLicenceBackup = { port: PORT, deviceId: 'x', blob: new Uint8Array(98), takenAt: 1000 }

  it('returns the backup for the same port inside the time limit', () => {
    expect(usableBoardBackup(backup, PORT, 1000 + BOARD_BACKUP_TTL_MS)).toBe(backup)
  })

  it('ignores another port, no port, or an expired backup', () => {
    expect(usableBoardBackup(backup, '/dev/cu.other', 1000)).toBeNull()
    expect(usableBoardBackup(backup, null, 1000)).toBeNull()
    expect(usableBoardBackup(backup, PORT, 1001 + BOARD_BACKUP_TTL_MS)).toBeNull()
    expect(usableBoardBackup(null, PORT, 1000)).toBeNull()
  })
})

describe('restoreBoardLicence', () => {
  const deviceId = deriveDeviceId(HARDWARE)
  const blob = blobFor(HARDWARE)
  const backup: BoardLicenceBackup = { port: PORT, deviceId, blob, takenAt: 0 }

  function transport(stored: DebugLicenseReadResult) {
    return {
      readLicense: jest.fn(() => Promise.resolve(stored)),
      writeLicense: jest.fn(() => Promise.resolve({ success: true, status: LIC_SUCCESS })),
    }
  }

  it('writes the licence back into an empty or corrupt store of the same board', async () => {
    for (const stored of [
      { success: true, status: LIC_EMPTY, empty: true },
      { success: true, status: LIC_CORRUPT, corrupt: true },
    ]) {
      const t = transport(stored)
      expect(await restoreBoardLicence(t, backup, deviceId)).toBe(true)
      expect(t.writeLicense).toHaveBeenCalledWith(blob)
    }
  })

  it('leaves a store that still holds a licence alone', async () => {
    const t = transport({ success: true, status: LIC_SUCCESS, blob })

    expect(await restoreBoardLicence(t, backup, deviceId)).toBe(false)
    expect(t.writeLicense).not.toHaveBeenCalled()
  })

  it('never writes to another board or without a backed-up licence', async () => {
    const t = transport({ success: true, status: LIC_EMPTY, empty: true })

    expect(await restoreBoardLicence(t, backup, deriveDeviceId(GENERATED))).toBe(false)
    expect(await restoreBoardLicence(t, { ...backup, blob: undefined }, deviceId)).toBe(false)
    expect(t.readLicense).not.toHaveBeenCalled()
    expect(t.writeLicense).not.toHaveBeenCalled()
  })

  it('reports no restore when the write fails', async () => {
    const t = transport({ success: true, status: LIC_EMPTY, empty: true })
    t.writeLicense.mockResolvedValue({ success: false, status: 0x82 })

    expect(await restoreBoardLicence(t, backup, deviceId)).toBe(false)
  })
})
