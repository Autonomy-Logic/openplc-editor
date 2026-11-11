/**
 * Backup of a bare-metal board's generated ID and stored licence, taken over the
 * held link before an upload and written back on the first link after it when
 * the upload erased them.
 */

import { crc32IsoHdlc, deserializeLicenseBlob, LIC_BLOB_SIZE, LIC_MAGIC_LE } from '../../shared/debug/license-blob'
import type { DebugDeviceIdResult, DebugLicenseReadResult } from '../../shared/debug/types'
import { deriveDeviceId } from './device-identity'
import type { LicenseReadWritable } from './license-flow'

/** Status byte of a read-license (0x4A) reply that carries a blob. */
const LIC_STATUS_SUCCESS = 0x7e
/** Bytes covered by the blob's crc32. */
const LIC_CRC_COVERAGE = 94
/** How long a backup stays usable after it was taken. */
export const BOARD_BACKUP_TTL_MS = 15 * 60 * 1000

export interface BoardLicenceBackup {
  /** Serial path the board was on. */
  port: string
  /** Device ID derived from the identity read before the upload. */
  deviceId: string
  /** The generated board ID; absent on a board with a factory ID. */
  generatedId?: Uint8Array
  /** The stored licence blob, kept only when it is well formed and bound to `deviceId`. */
  blob?: Uint8Array
  takenAt: number
}

export interface BoardBackupChannel {
  getDeviceId(): Promise<DebugDeviceIdResult>
  readLicense(): Promise<DebugLicenseReadResult>
}

function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

/** Magic, crc32 and device binding; the signature is checked when the restored blob is read back. */
function blobBelongsTo(blob: Uint8Array | undefined, deviceId: string): blob is Uint8Array {
  if (!blob || blob.length !== LIC_BLOB_SIZE) return false
  const parsed = deserializeLicenseBlob(blob)
  if (parsed.magic !== LIC_MAGIC_LE) return false
  if (parsed.crc32 !== crc32IsoHdlc(blob.subarray(0, LIC_CRC_COVERAGE))) return false
  return bytesToHex(parsed.deviceId) === deviceId
}

/**
 * Read the board's identity and stored licence. Returns null when the board has
 * no single ID source, or holds neither a generated ID nor a licence worth keeping.
 */
export async function takeBoardLicenceBackup(
  channel: BoardBackupChannel,
  port: string,
  now: number = Date.now(),
): Promise<BoardLicenceBackup | null> {
  const ids = await channel.getDeviceId()
  if (!ids.success || ids.unsupported || ids.sources?.length !== 1) return null
  const source = ids.sources[0]
  if (source.bytes.length === 0) return null

  const deviceId = deriveDeviceId(source.bytes)
  const generatedId = source.kind === 'generated' ? Uint8Array.from(source.bytes) : undefined

  const stored = await channel.readLicense()
  const blob =
    stored.success && stored.status === LIC_STATUS_SUCCESS && blobBelongsTo(stored.blob, deviceId)
      ? Uint8Array.from(stored.blob)
      : undefined

  if (!generatedId && !blob) return null
  return { port, deviceId, generatedId, blob, takenAt: now }
}

/** The backup when it was taken on `port` and has not expired, else null. */
export function usableBoardBackup(
  backup: BoardLicenceBackup | null,
  port: string | null | undefined,
  now: number = Date.now(),
): BoardLicenceBackup | null {
  if (!backup || !port || backup.port !== port) return null
  if (now - backup.takenAt > BOARD_BACKUP_TTL_MS) return null
  return backup
}

/**
 * Write the backed-up licence back when the board answers with the same device ID
 * and an empty or corrupt store. Returns whether a write was made; the caller's
 * licence flow then reads the blob back and verifies it.
 */
export async function restoreBoardLicence(
  transport: LicenseReadWritable,
  backup: BoardLicenceBackup,
  deviceId: string,
): Promise<boolean> {
  if (!backup.blob || backup.deviceId !== deviceId) return false
  const stored = await transport.readLicense()
  if (!stored.success || !(stored.empty || stored.corrupt)) return false
  const write = await transport.writeLicense(backup.blob)
  return write.success && !write.unsupported
}
