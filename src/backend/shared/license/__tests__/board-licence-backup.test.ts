/**
 * @jest-environment node
 */
import { createHash } from 'node:crypto'

import { hexToBytes, serializeLicenseBlob } from '../../debug/license-blob'
import type { DebugDeviceIdResult, DebugLicenseReadResult, DeviceIdSource } from '../../debug/types'
import {
  armBoardLicenceBackup,
  BOARD_BACKUP_TTL_MS,
  BoardBackupHolder,
  type BoardLicenceBackup,
  openLinkWithBackup,
  readBoardIdentityWithBackup,
  restoreBoardLicence,
  restoreBoardLicenceFromBackup,
  takeBoardLicenceBackup,
} from '../board-licence-backup'

const LIC_SUCCESS = 0x7e
const LIC_EMPTY = 0x83
const LIC_CORRUPT = 0x84
const PORT = '/dev/cu.usbmodem1'

const GENERATED = Uint8Array.from({ length: 16 }, (_, i) => 0x10 + i)
const HARDWARE = Uint8Array.from({ length: 16 }, (_, i) => 0xa0 + i)

/** Reference derivation through node:crypto. */
function deriveDeviceId(anchor: Uint8Array): string {
  return createHash('sha256').update('openplc-dev-v1|').update(anchor).digest('hex').slice(0, 32)
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
    getDeviceId: vi.fn(() => Promise.resolve(ids)),
    readLicense: vi.fn(() => Promise.resolve(stored)),
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

describe('BoardBackupHolder', () => {
  const backup: BoardLicenceBackup = { port: PORT, deviceId: 'x', blob: new Uint8Array(98), takenAt: 1000 }

  function uploadedAndLinked(): BoardBackupHolder {
    const holder = new BoardBackupHolder()
    holder.arm(backup)
    holder.uploadFinished(true)
    holder.linkOpened()
    return holder
  }

  it('hands the backup out on the first link after a successful upload, for the same port and inside the TTL', () => {
    expect(uploadedAndLinked().usable(PORT, 1000 + BOARD_BACKUP_TTL_MS)).toBe(backup)
  })

  it('is not usable before the upload finished or before the link opened', () => {
    const holder = new BoardBackupHolder()
    holder.arm(backup)
    expect(holder.usable(PORT, 1000)).toBeNull()
    holder.uploadFinished(true)
    expect(holder.usable(PORT, 1000)).toBeNull()
  })

  it('drops the backup when the upload fails', () => {
    const holder = new BoardBackupHolder()
    holder.arm(backup)
    holder.uploadFinished(false)
    holder.linkOpened()
    expect(holder.usable(PORT, 1000)).toBeNull()
  })

  it('drops the backup on a link opened before the upload finished', () => {
    const holder = new BoardBackupHolder()
    holder.arm(backup)
    holder.linkOpened()
    holder.uploadFinished(true)
    holder.linkOpened()
    expect(holder.usable(PORT, 1000)).toBeNull()
  })

  it('drops the backup on a second link, on close and once consumed', () => {
    const second = uploadedAndLinked()
    second.linkOpened()
    expect(second.usable(PORT, 1000)).toBeNull()

    const closed = uploadedAndLinked()
    closed.linkClosed()
    expect(closed.usable(PORT, 1000)).toBeNull()

    const used = uploadedAndLinked()
    used.consume()
    expect(used.usable(PORT, 1000)).toBeNull()
  })

  it('ignores another port, no port, or an expired backup without dropping it', () => {
    const holder = uploadedAndLinked()
    expect(holder.usable('/dev/cu.other', 1000)).toBeNull()
    expect(holder.usable(null, 1000)).toBeNull()
    expect(holder.usable(PORT, 1001 + BOARD_BACKUP_TTL_MS)).toBeNull()
    expect(holder.usable(PORT, 1000)).toBe(backup)
  })

  it('arming with null drops a previous backup', () => {
    const holder = uploadedAndLinked()
    holder.arm(null)
    holder.uploadFinished(true)
    holder.linkOpened()
    expect(holder.usable(PORT, 1000)).toBeNull()
  })
})

describe('restoreBoardLicence', () => {
  const deviceId = deriveDeviceId(HARDWARE)
  const blob = blobFor(HARDWARE)
  const backup: BoardLicenceBackup = { port: PORT, deviceId, blob, takenAt: 0 }

  function transport(stored: DebugLicenseReadResult) {
    return {
      readLicense: vi.fn(() => Promise.resolve(stored)),
      writeLicense: vi.fn(() => Promise.resolve({ success: true, status: LIC_SUCCESS })),
    }
  }

  it('writes the licence back into an empty or corrupt store of the same board', async () => {
    for (const stored of [
      { success: true, status: LIC_EMPTY, empty: true },
      { success: true, status: LIC_CORRUPT, corrupt: true },
    ]) {
      const t = transport(stored)
      expect(await restoreBoardLicence(t, backup, deviceId)).toEqual({ status: 'restored' })
      expect(t.writeLicense).toHaveBeenCalledWith(blob)
    }
  })

  it('leaves a store that still holds a licence alone', async () => {
    const t = transport({ success: true, status: LIC_SUCCESS, blob })

    expect(await restoreBoardLicence(t, backup, deviceId)).toEqual({ status: 'skipped', reason: 'store-in-use' })
    expect(t.writeLicense).not.toHaveBeenCalled()
  })

  it('never writes to another board or without a backed-up licence', async () => {
    const t = transport({ success: true, status: LIC_EMPTY, empty: true })

    expect(await restoreBoardLicence(t, backup, deriveDeviceId(GENERATED))).toEqual({
      status: 'skipped',
      reason: 'other-board',
    })
    expect(await restoreBoardLicence(t, { ...backup, blob: undefined }, deviceId)).toEqual({
      status: 'skipped',
      reason: 'no-licence',
    })
    expect(t.readLicense).not.toHaveBeenCalled()
    expect(t.writeLicense).not.toHaveBeenCalled()
  })

  it('reports a failed write, a failed read and a thrown read as failures', async () => {
    const failedWrite = transport({ success: true, status: LIC_EMPTY, empty: true })
    failedWrite.writeLicense.mockResolvedValue({ success: false, status: 0x82 })
    expect(await restoreBoardLicence(failedWrite, backup, deviceId)).toMatchObject({ status: 'failed' })

    const failedRead = transport({ success: false, error: 'timeout' })
    expect(await restoreBoardLicence(failedRead, backup, deviceId)).toEqual({ status: 'failed', error: 'timeout' })

    const thrown = transport({ success: true, status: LIC_EMPTY, empty: true })
    thrown.readLicense.mockRejectedValue(new Error('port closed'))
    expect(await restoreBoardLicence(thrown, backup, deviceId)).toEqual({ status: 'failed', error: 'port closed' })
  })

  it('reports a board that cannot store a licence as a definitive no', async () => {
    const t = transport({ success: true, status: 0x85, unsupported: true })
    expect(await restoreBoardLicence(t, backup, deviceId)).toEqual({ status: 'skipped', reason: 'unsupported' })
    expect(t.writeLicense).not.toHaveBeenCalled()
  })
})

describe('backup coordinator', () => {
  const blob = blobFor(GENERATED)
  const backup: BoardLicenceBackup = {
    port: PORT,
    deviceId: deriveDeviceId(GENERATED),
    generatedId: GENERATED,
    blob,
    takenAt: 1000,
  }

  function linkedHolder(): BoardBackupHolder {
    const holder = new BoardBackupHolder()
    holder.arm(backup)
    holder.uploadFinished(true)
    holder.linkOpened()
    return holder
  }

  function wiped(stored: DebugLicenseReadResult = { success: true, status: LIC_EMPTY, empty: true }) {
    return {
      readLicense: vi.fn(() => Promise.resolve(stored)),
      writeLicense: vi.fn(() => Promise.resolve({ success: true, status: LIC_SUCCESS })),
    }
  }

  describe('armBoardLicenceBackup', () => {
    const licensed = () =>
      channel(one({ kind: 'generated', bytes: GENERATED }), { success: true, status: LIC_SUCCESS, blob })

    it('backs up the board on the serial link being released', async () => {
      const holder = new BoardBackupHolder()
      const result = await armBoardLicenceBackup(holder, licensed(), { transport: 'rtu', descriptor: PORT }, PORT, 1000)
      expect(result).toEqual({ backup })
      holder.uploadFinished(true)
      holder.linkOpened()
      expect(holder.usable(PORT, 1000)).toEqual(backup)
    })

    it('arms no backup for a TCP link, another port or no client, and drops the previous one', async () => {
      for (const [link, port, hasChannel] of [
        [{ transport: 'tcp', descriptor: '192.168.0.10:502' }, PORT, true],
        [{ transport: 'rtu', descriptor: PORT }, '/dev/cu.other', true],
        [{ transport: 'rtu', descriptor: PORT }, PORT, false],
        [null, PORT, true],
      ] as const) {
        const holder = linkedHolder()
        const c = licensed()
        expect(await armBoardLicenceBackup(holder, hasChannel ? c : null, link, port, 1000)).toBeNull()
        expect(c.getDeviceId).not.toHaveBeenCalled()
        expect(holder.usable(PORT, 1000)).toBeNull()
      }
    })

    it('reports a read that throws and arms nothing', async () => {
      const holder = new BoardBackupHolder()
      const c = licensed()
      c.getDeviceId.mockRejectedValue(new Error('timeout'))
      expect(await armBoardLicenceBackup(holder, c, { transport: 'rtu', descriptor: PORT }, undefined)).toEqual({
        error: 'timeout',
      })
      holder.uploadFinished(true)
      holder.linkOpened()
      expect(holder.usable(PORT, 1000)).toBeNull()
    })
  })

  describe('readBoardIdentityWithBackup', () => {
    function blank() {
      let id: Uint8Array | null = null
      return {
        getDeviceId: vi.fn(() =>
          Promise.resolve<DebugDeviceIdResult>({
            success: true,
            sources: id ? [{ kind: 'generated', bytes: id }] : [],
          }),
        ),
        provisionBoardId: vi.fn((next: Uint8Array) => {
          id = next
          return Promise.resolve({ success: true, status: LIC_SUCCESS })
        }),
      }
    }

    it('gives a blank board the backed-up generated ID', async () => {
      const board = blank()
      const read = await readBoardIdentityWithBackup(linkedHolder(), board, PORT, 1000)
      expect(board.provisionBoardId).toHaveBeenCalledWith(GENERATED)
      expect(read.sources).toEqual([{ kind: 'generated', bytes: GENERATED }])
    })

    it('gives a blank board a new ID without a usable backup', async () => {
      const board = blank()
      await readBoardIdentityWithBackup(linkedHolder(), board, '/dev/cu.other', 1000)
      expect(board.provisionBoardId).toHaveBeenCalledTimes(1)
      expect(board.provisionBoardId.mock.calls[0][0]).not.toEqual(GENERATED)
    })
  })

  describe('restoreBoardLicenceFromBackup', () => {
    it('writes the licence back and drops the backup', async () => {
      const holder = linkedHolder()
      const t = wiped()
      expect(await restoreBoardLicenceFromBackup(holder, t, PORT, GENERATED, 1000)).toEqual({ status: 'restored' })
      expect(t.writeLicense).toHaveBeenCalledWith(blob)
      expect(holder.usable(PORT, 1000)).toBeNull()
    })

    it('drops the backup without writing when the board is another one', async () => {
      const holder = linkedHolder()
      const t = wiped()
      expect(await restoreBoardLicenceFromBackup(holder, t, PORT, HARDWARE, 1000)).toEqual({
        status: 'skipped',
        reason: 'other-board',
      })
      expect(t.writeLicense).not.toHaveBeenCalled()
      expect(holder.usable(PORT, 1000)).toBeNull()
    })

    it('drops the backup when the store still holds a licence', async () => {
      const holder = linkedHolder()
      const t = wiped({ success: true, status: LIC_SUCCESS, blob })
      expect(await restoreBoardLicenceFromBackup(holder, t, PORT, GENERATED, 1000)).toEqual({
        status: 'skipped',
        reason: 'store-in-use',
      })
      expect(holder.usable(PORT, 1000)).toBeNull()
    })

    it('keeps the backup within its TTL after a transport error, for the next try', async () => {
      const holder = linkedHolder()
      const t = wiped()
      t.readLicense.mockRejectedValueOnce(new Error('timeout'))
      expect(await restoreBoardLicenceFromBackup(holder, t, PORT, GENERATED, 1000)).toEqual({
        status: 'failed',
        error: 'timeout',
      })
      expect(holder.usable(PORT, 1000)).toBe(backup)

      t.writeLicense.mockResolvedValueOnce({ success: false, status: 0x82 })
      expect(await restoreBoardLicenceFromBackup(holder, t, PORT, GENERATED, 1000)).toMatchObject({ status: 'failed' })
      expect(holder.usable(PORT, 1000)).toBe(backup)

      expect(await restoreBoardLicenceFromBackup(holder, t, PORT, GENERATED, 1000)).toEqual({ status: 'restored' })
      expect(holder.usable(PORT, 1000)).toBeNull()
    })

    it('does nothing without a usable backup or with an empty identity', async () => {
      const t = wiped()
      expect(await restoreBoardLicenceFromBackup(new BoardBackupHolder(), t, PORT, GENERATED, 1000)).toBeNull()
      const holder = linkedHolder()
      expect(await restoreBoardLicenceFromBackup(holder, t, PORT, new Uint8Array(0), 1000)).toBeNull()
      expect(await restoreBoardLicenceFromBackup(holder, t, PORT, GENERATED, 1001 + BOARD_BACKUP_TTL_MS)).toBeNull()
      expect(t.readLicense).not.toHaveBeenCalled()
      expect(holder.usable(PORT, 1000)).toBe(backup)
    })
  })

  describe('openLinkWithBackup', () => {
    it('keeps the backup across a connect that fails, for the retry that opens', async () => {
      const holder = new BoardBackupHolder()
      holder.arm(backup)
      holder.uploadFinished(true)

      const failed = await openLinkWithBackup(holder, () => Promise.resolve({ ok: false }))
      expect(failed).toEqual({ ok: false })
      expect(holder.usable(PORT, 1000)).toBeNull()

      await openLinkWithBackup(holder, () => Promise.resolve({ ok: true }))
      expect(holder.usable(PORT, 1000)).toBe(backup)
    })

    it('drops the backup on a second link that opens', async () => {
      const holder = new BoardBackupHolder()
      holder.arm(backup)
      holder.uploadFinished(true)
      await openLinkWithBackup(holder, () => Promise.resolve({ ok: true }))
      await openLinkWithBackup(holder, () => Promise.resolve({ ok: true }))
      expect(holder.usable(PORT, 1000)).toBeNull()
    })
  })
})
