/**
 * Backup of a bare-metal board's generated ID and stored licence, taken over the
 * held link before an upload and written back on the reconnect after it when
 * the upload erased them.
 */

import { LIC_STATUS_SUCCESS } from '../debug/license-blob'
import type { DebugDeviceIdResult, DebugLicenseReadResult } from '../debug/types'
import { deriveDeviceId } from './device-identity'
import { checkLicenseBlobStructure, type LicenseReadWritable } from './license-flow'

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

  const deviceId = await deriveDeviceId(source.bytes)
  const generatedId = source.kind === 'generated' ? Uint8Array.from(source.bytes) : undefined

  const stored = await channel.readLicense()
  const structure =
    stored.success && stored.status === LIC_STATUS_SUCCESS ? checkLicenseBlobStructure(stored.blob, deviceId) : null
  const blob = structure?.ok ? Uint8Array.from(structure.blob) : undefined

  if (!generatedId && !blob) return null
  return { port, deviceId, generatedId, blob, takenAt: now }
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

/**
 * Holds one backup through an upload: armed at the port release, kept only when
 * the upload succeeds, usable only on the next link, and dropped once used.
 */
export class BoardBackupHolder {
  private backup: BoardLicenceBackup | null = null
  private phase: 'armed' | 'uploaded' | 'linked' = 'armed'

  /** Keep `backup` (or none, when null) for the upload that follows. */
  arm(backup: BoardLicenceBackup | null): void {
    this.backup = backup
    this.phase = 'armed'
  }

  /** The upload's verdict; a failed build or upload drops the backup. */
  uploadFinished(success: boolean): void {
    if (!this.backup || this.phase !== 'armed') return
    if (success) this.phase = 'uploaded'
    else this.clear()
  }

  /** A link is opening; only the first one after a successful upload keeps the backup. */
  linkOpened(): void {
    if (this.backup && this.phase === 'uploaded') this.phase = 'linked'
    else this.clear()
  }

  /** The link was closed on request. */
  linkClosed(): void {
    this.clear()
  }

  /** The backup when the current link is the reconnect on `port` and the TTL holds, else null. */
  usable(port: string | null | undefined, now: number = Date.now()): BoardLicenceBackup | null {
    const backup = this.backup
    if (!backup || this.phase !== 'linked' || !port || backup.port !== port) return null
    if (now - backup.takenAt > BOARD_BACKUP_TTL_MS) return null
    return backup
  }

  /** Drop the backup after it was used. */
  consume(): void {
    this.clear()
  }

  private clear(): void {
    this.backup = null
    this.phase = 'armed'
  }
}
