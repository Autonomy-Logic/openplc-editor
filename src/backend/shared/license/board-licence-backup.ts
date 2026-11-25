/**
 * Backup of a bare-metal board's generated ID and stored licence, taken over the
 * held link before an upload and written back on the reconnect after it when
 * the upload erased them.
 */

import { LIC_STATUS_SUCCESS } from '../debug/license-blob'
import type { DebugDeviceIdResult, DebugLicenseReadResult } from '../debug/types'
import { deriveDeviceId, generateBoardId } from './device-identity'
import {
  type BoardIdentityChannel,
  checkLicenseBlobStructure,
  type LicenseReadWritable,
  readBoardIdSources,
} from './license-flow'

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
 * What a restore did: `restored` wrote the licence back; `skipped` is a definitive no (no licence kept,
 * another board, a store that still holds a licence, a board that cannot store one); `failed` is a
 * transport error, after which the backup is worth another try.
 */
export type BoardRestoreVerdict =
  | { status: 'restored' }
  | { status: 'skipped'; reason: 'no-licence' | 'other-board' | 'store-in-use' | 'unsupported' }
  | { status: 'failed'; error: string }

/**
 * Write the backed-up licence back when the board answers with the same device ID
 * and an empty or corrupt store. The caller's licence flow then reads the blob back
 * and verifies it. Never throws.
 */
export async function restoreBoardLicence(
  transport: LicenseReadWritable,
  backup: BoardLicenceBackup,
  deviceId: string,
): Promise<BoardRestoreVerdict> {
  if (!backup.blob) return { status: 'skipped', reason: 'no-licence' }
  if (backup.deviceId !== deviceId) return { status: 'skipped', reason: 'other-board' }
  try {
    const stored = await transport.readLicense()
    if (stored.unsupported) return { status: 'skipped', reason: 'unsupported' }
    if (!stored.success) return { status: 'failed', error: stored.error ?? 'the licence store could not be read' }
    if (!(stored.empty || stored.corrupt)) return { status: 'skipped', reason: 'store-in-use' }
    const write = await transport.writeLicense(backup.blob)
    if (write.unsupported) return { status: 'skipped', reason: 'unsupported' }
    if (!write.success) return { status: 'failed', error: write.error ?? 'the licence could not be written' }
    return { status: 'restored' }
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
  }
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

  /** A link opened; only the first one after a successful upload keeps the backup. */
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

/** The held link as the backup coordinator needs it. */
export interface BoardLinkInfo {
  transport: string
  descriptor: string
}

/**
 * Arm `holder` for the upload that follows the release of `port`: with a backup of the board on `link`
 * when that link is the serial link on `port` (any port when `port` is absent), else with none. Returns
 * the backup taken, null when none applies, or the read error. Never throws.
 */
export async function armBoardLicenceBackup(
  holder: BoardBackupHolder,
  channel: BoardBackupChannel | null,
  link: BoardLinkInfo | null,
  port: string | null | undefined,
  now: number = Date.now(),
): Promise<{ backup: BoardLicenceBackup | null } | { error: string } | null> {
  holder.arm(null)
  if (!link || link.transport !== 'rtu' || !channel) return null
  if (port !== undefined && port !== null && link.descriptor !== String(port)) return null
  try {
    const backup = await takeBoardLicenceBackup(channel, link.descriptor, now)
    holder.arm(backup)
    return { backup }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/** Open a link through `open` and report it to `holder` only once it opened, so a failed attempt keeps the backup. */
export async function openLinkWithBackup<T extends { ok: boolean }>(
  holder: BoardBackupHolder,
  open: () => Promise<T>,
): Promise<T> {
  const result = await open()
  if (result.ok) holder.linkOpened()
  return result
}

/**
 * Read the board's ID sources on the link on `port`. A board that reports none is given the backed-up
 * generated ID when a backup is usable, else a new one.
 */
export async function readBoardIdentityWithBackup(
  holder: BoardBackupHolder,
  channel: BoardIdentityChannel,
  port: string | null | undefined,
  now: number = Date.now(),
): Promise<DebugDeviceIdResult> {
  const backup = holder.usable(port, now)
  return readBoardIdSources(channel, () => backup?.generatedId ?? generateBoardId())
}

/**
 * Write the backed-up licence back to the board with identity `anchor` on the link on `port`. The
 * backup is dropped after a restore or a definitive no, and kept within its TTL after a transport
 * error. Returns null when no backup applies.
 */
export async function restoreBoardLicenceFromBackup(
  holder: BoardBackupHolder,
  transport: LicenseReadWritable,
  port: string | null | undefined,
  anchor: Uint8Array,
  now: number = Date.now(),
): Promise<BoardRestoreVerdict | null> {
  const backup = holder.usable(port, now)
  if (!backup || anchor.length === 0) return null
  const verdict = await restoreBoardLicence(transport, backup, await deriveDeviceId(anchor))
  if (verdict.status !== 'failed') holder.consume()
  return verdict
}
