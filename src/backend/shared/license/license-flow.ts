/**
 * Licence flow over a connected transport: read the stored licence (0x4A), verify it,
 * and when it is absent or invalid ask Edge and write the result (0x49). Never throws.
 */

import type { DeviceLicenseReport, DeviceLicenseState } from '../../../middleware/shared/ports/device-port'
import {
  bytesToHex,
  crc32IsoHdlc,
  deserializeLicenseBlob,
  hexToBytes,
  LIC_BLOB_SIZE,
  LIC_CRC_COVERAGE,
  LIC_MAGIC_LE,
  LIC_STATUS_SUCCESS,
  LIC_STATUS_UNSUPPORTED,
} from '../debug/license-blob'
import {
  type RuntimeLicenseKeys,
  type RuntimeLicenseVerdict,
  verifyRuntimeLicenseBlob,
} from '../debug/runtime-license-verify'
import type {
  DebugBoardIdProvisionResult,
  DebugDeviceIdResult,
  DebugLicenseReadResult,
  DebugLicenseWriteResult,
  DeviceIdSource,
} from '../debug/types'
import { deriveDeviceId, deriveVppId } from './device-identity'

/** Just enough of a transport to run the licensing FCs. */
export interface LicenseReadWritable {
  readLicense(): Promise<DebugLicenseReadResult>
  writeLicense(blob: Uint8Array): Promise<DebugLicenseWriteResult>
}

/** Activation request body. */
export interface DeviceActivationInput {
  /** 16-byte device id, LOWERCASE hex (from `deriveDeviceId`). */
  deviceId: string
  /** VPP package id (e.g. `com.openplc.espressif-licensed`) — `package.id`. */
  packageId: string
}

/** Activation result: `reason` is Edge's answer, `error` means no answer was obtained. */
export interface DeviceActivationResult {
  licensed: boolean
  /** License blob bytes (98 B) when `licensed` — ready to write via FC 0x49. */
  license?: number[]
  /** Backend-supplied reason (e.g. "no active subscription"). */
  reason?: string
  /** Populated on transport / backend failure (best-effort path). */
  error?: string
}

/** Asks the backend for this device's licence; never throws. */
export type DeviceActivation = (input: DeviceActivationInput) => Promise<DeviceActivationResult>

export type { DeviceLicenseReport, DeviceLicenseState }

/** Raw anchor from FC 0x48, hashed by `deriveDeviceId`. */
export type DeviceIdentity = { kind: 'anchor'; anchor: Uint8Array }

/** Board identity from its FC 0x48 sources: none gives an empty anchor; several are not supported. */
export function identityFromSources(sources: readonly DeviceIdSource[]): DeviceIdentity | { error: string } {
  if (sources.length > 1) {
    return {
      error:
        'This board reports its identity in a format this editor does not recognise. ' +
        'Update the editor to license this board.',
    }
  }
  return { kind: 'anchor', anchor: sources[0]?.bytes ?? new Uint8Array(0) }
}

/** Just enough of a bare-metal channel to read, and when needed provision, the board identity. */
export interface BoardIdentityChannel {
  getDeviceId(): Promise<DebugDeviceIdResult>
  provisionBoardId?(id: Uint8Array): Promise<DebugBoardIdProvisionResult>
}

/**
 * Read a bare-metal board's ID sources (FC 0x48). When it reports none, store a
 * generated ID (FC 0x4E) and read again. A board with no slot for one keeps
 * reporting none; a board that already holds one keeps it.
 */
export async function readBoardIdSources(
  channel: BoardIdentityChannel,
  generateId: () => Uint8Array,
): Promise<DebugDeviceIdResult> {
  const first = await channel.getDeviceId()
  if (!first.success || first.unsupported || (first.sources?.length ?? 0) > 0 || !channel.provisionBoardId) {
    return first
  }

  const provision = await channel.provisionBoardId(generateId())
  if (!provision.success) {
    return { success: false, error: provision.error ?? 'The board could not store its generated ID.' }
  }
  if (provision.unsupported) return first
  return channel.getDeviceId()
}

export interface DeviceLicenseInput {
  /** What the identity read (FC 0x48) returned, tagged with its kind. */
  identity: DeviceIdentity
  /** Reverse-domain VPP package id (`package.id`) from `resolveLicensingTarget`. */
  packageId: string
  /**
   * Set for the runtime licence of a built-in board: the stored blob is then
   * verified in full, signature included, against these keys.
   */
  runtimeKeys?: RuntimeLicenseKeys
}

const RUNTIME_VERDICT_REASONS: Record<Exclude<RuntimeLicenseVerdict, { ok: true }>['reason'], string> = {
  incomplete: 'The license stored on this device is incomplete.',
  damaged: 'The license stored on this device is damaged.',
  'not-a-license': 'The data stored on this device is not a license.',
  format: 'The license stored on this device has a format this editor does not recognise.',
  'other-device': 'The license stored on this device was issued for a different device.',
  'other-product': 'The license stored on this device was issued for a different product.',
  signature: 'The license stored on this device has a signature this editor does not accept.',
}

/** `verifyStoredLicenseBlob`, or the full runtime licence check when `input.runtimeKeys` is set. */
async function verifyBlobFor(
  blob: Uint8Array | undefined,
  deviceIdHex: string,
  input: { packageId: string; runtimeKeys?: RuntimeLicenseKeys },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!input.runtimeKeys) return await verifyStoredLicenseBlob(blob, deviceIdHex, input.packageId)
  if (!blob) return { ok: false, reason: RUNTIME_VERDICT_REASONS.incomplete }
  const verdict = await verifyRuntimeLicenseBlob(blob, hexToBytes(deviceIdHex), input.runtimeKeys)
  return verdict.ok ? verdict : { ok: false, reason: RUNTIME_VERDICT_REASONS[verdict.reason] }
}

/** Checks length, magic, crc32, device ID and, when `packageId` is set, product ID; not the signature. */
export async function verifyStoredLicenseBlob(
  blob: Uint8Array | undefined,
  deviceIdHex: string,
  packageId: string | undefined,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const structure = checkLicenseBlobStructure(blob, deviceIdHex)
  if (!structure.ok) return structure
  if (!packageId) return { ok: true }

  const expectedProductId = await deriveVppId(packageId)
  const blobProductId = bytesToHex(deserializeLicenseBlob(structure.blob).productId)
  if (blobProductId !== expectedProductId) {
    return { ok: false, reason: 'The license stored on this device was issued for a different VPP.' }
  }
  return { ok: true }
}

/** Length, magic, crc32 and device binding of a stored blob; no product or signature check. */
export function checkLicenseBlobStructure(
  blob: Uint8Array | undefined,
  deviceIdHex: string,
): { ok: true; blob: Uint8Array } | { ok: false; reason: string } {
  if (!blob || blob.length !== LIC_BLOB_SIZE) {
    return { ok: false, reason: 'The license stored on this device is incomplete.' }
  }

  const parsed = deserializeLicenseBlob(blob)

  if (parsed.magic !== LIC_MAGIC_LE) {
    return { ok: false, reason: 'The data stored on this device is not a license.' }
  }

  const expectedCrc = crc32IsoHdlc(blob.subarray(0, LIC_CRC_COVERAGE))
  if (parsed.crc32 !== expectedCrc) {
    return { ok: false, reason: 'The license stored on this device is damaged.' }
  }

  const blobDeviceId = bytesToHex(parsed.deviceId)
  if (blobDeviceId !== deviceIdHex) {
    return { ok: false, reason: 'The license stored on this device was issued for a different device.' }
  }

  return { ok: true, blob }
}

/** Resolve a board's licence: verify the stored one, else recover it from Edge, write it and re-verify. */
export async function resolveDeviceLicense(
  transport: LicenseReadWritable,
  input: DeviceLicenseInput,
  activate: DeviceActivation,
): Promise<DeviceLicenseReport> {
  const identity = await deriveIdentity(input.identity)
  if ('outcome' in identity) return identity
  const { deviceId } = identity

  try {
    const stored = await readAndVerify(transport, deviceId, input)
    if (stored.kind !== 'absent') return { deviceId, outcome: stored.outcome }

    return await recoverLicense(
      transport,
      { deviceId, packageId: input.packageId, runtimeKeys: input.runtimeKeys },
      activate,
    )
  } catch (error) {
    return { deviceId, outcome: { state: 'check-failed', error: errorMessage(error) } }
  }
}

/** Verify the stored licence without contacting Edge; `unlicensed` here has `entitlementChecked: false`. */
export async function inspectDeviceLicense(
  transport: LicenseReadWritable,
  input: DeviceLicenseInput,
): Promise<DeviceLicenseReport> {
  const identity = await deriveIdentity(input.identity)
  if ('outcome' in identity) return identity
  const { deviceId } = identity

  try {
    const stored = await readAndVerify(transport, deviceId, input)
    if (stored.kind === 'absent') {
      return { deviceId, outcome: { state: 'unlicensed', entitlementChecked: false, ...stored.detail } }
    }
    return { deviceId, outcome: stored.outcome }
  } catch (error) {
    return { deviceId, outcome: { state: 'check-failed', error: errorMessage(error) } }
  }
}

/** Device ID from the anchor; an empty anchor is refused because its digest would be shared by every such board. */
async function deriveIdentity(identity: DeviceIdentity): Promise<{ deviceId: string } | DeviceLicenseReport> {
  if (identity.anchor.length === 0) {
    return {
      outcome: {
        state: 'check-failed',
        error:
          'This board did not report an identity a license can be issued for. ' +
          'Its firmware was built without licensing support, so rebuild and upload the program to this board.',
        retryable: false,
      },
    }
  }

  return { deviceId: await deriveDeviceId(identity.anchor) }
}

/** Stored licence verdict; `absent` means nothing usable is stored. */
type StoredLicenseVerdict =
  | { kind: 'settled'; outcome: DeviceLicenseState }
  | { kind: 'absent'; detail?: { backendReason?: string } }

async function readAndVerify(
  transport: LicenseReadWritable,
  deviceId: string,
  input: DeviceLicenseInput,
): Promise<StoredLicenseVerdict> {
  const stored = await transport.readLicense()

  if (!stored.success) {
    return {
      kind: 'settled',
      outcome: {
        state: 'check-failed',
        error: stored.error ?? 'The device did not answer when asked for its stored license.',
      },
    }
  }

  if (stored.status === LIC_STATUS_UNSUPPORTED || stored.unsupported) {
    return { kind: 'settled', outcome: { state: 'unsupported' } }
  }

  if (stored.status === LIC_STATUS_SUCCESS) {
    const verdict = await verifyBlobFor(stored.blob, deviceId, input)
    if (verdict.ok) return { kind: 'settled', outcome: { state: 'licensed', how: 'already-stored' } }

    console.warn(
      `[license] the device reported a stored license but it did not verify (${verdict.reason}) — ` +
        'treating it as absent.',
    )
  }

  return { kind: 'absent' }
}

/** Asks the backend for a licence and writes it, then reads it back and verifies it. */
async function recoverLicense(
  transport: LicenseReadWritable,
  input: { deviceId: string; packageId: string; runtimeKeys?: RuntimeLicenseKeys },
  activate: DeviceActivation,
): Promise<DeviceLicenseReport> {
  const { deviceId, packageId } = input
  const activation = await activate({ deviceId, packageId })

  if (!activation.licensed) {
    if (activation.error) {
      return { deviceId, outcome: { state: 'check-failed', error: activation.error } }
    }
    return { deviceId, outcome: { state: 'unlicensed', entitlementChecked: true, backendReason: activation.reason } }
  }

  if (!activation.license) {
    return {
      deviceId,
      outcome: { state: 'check-failed', error: 'The license server reported a license but sent no license data.' },
    }
  }

  const write = await transport.writeLicense(Uint8Array.from(activation.license))

  if (write.unsupported) {
    return { deviceId, outcome: { state: 'unsupported' } }
  }
  if (!write.success) {
    return {
      deviceId,
      outcome: { state: 'check-failed', error: write.error ?? 'The license could not be written to the device.' },
    }
  }

  const readBack = await transport.readLicense()
  if (!readBack.success) {
    return {
      deviceId,
      outcome: {
        state: 'check-failed',
        error: `The license was written but could not be confirmed. Reading it back from the device failed: ${readBack.error ?? 'the device did not reply'}.`,
      },
    }
  }

  const verdict = await verifyBlobFor(
    readBack.status === LIC_STATUS_SUCCESS ? readBack.blob : undefined,
    deviceId,
    input,
  )
  if (verdict.ok) return { deviceId, outcome: { state: 'licensed', how: 'activated' } }

  return {
    deviceId,
    outcome: {
      state: 'check-failed',
      error: `The license was written but could not be confirmed on the device. ${verdict.reason}`,
    },
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
