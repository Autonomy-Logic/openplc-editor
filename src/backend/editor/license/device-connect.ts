/**
 * Persistent-connection probe + license recover (D72), operating over an
 * ALREADY-CONNECTED `LicenseCapableTransport`: it neither connects nor
 * disconnects — the caller holds the client open for the live serial link, so
 * classification, the on-device license read (0x4A), and the auto-recover
 * (derive -> backend -> write 0x49) all happen over a SINGLE port open.
 *
 * Pure orchestration over the transport + the activation client, so it is
 * unit-testable with mocks. Never throws — failures resolve to a status.
 */
import { getErrorMessage } from '../../../frontend/utils/get-error-message'
import type { LicenseCapableTransport } from '../../shared/debug/types'
import { deriveDeviceId, deriveVppId } from './device-identity'
import { checkDeviceActivation } from './license-activation-client'
import { type DeviceLicenseStatus, readBoardIdWithRetries } from './license-probe'

export type DeviceConnectStatus = 'connected-with-firmware' | 'no-firmware' | 'no-response' | 'error'

/** What the recover step did (only when the target is licensable). */
export type DeviceActivationSummary = 'already-licensed' | 'activated' | 'demo' | 'unsupported' | 'error'

export interface DeviceConnectResult {
  status: DeviceConnectStatus
  /** Present when a firmware answered 0x48: the raw hardware id, lowercase hex. */
  anchorHex?: string
  /** On-device license state after the (optional) recover. */
  licenseStatus?: DeviceLicenseStatus
  /** What the recover attempt concluded (licensable targets only). */
  activation?: DeviceActivationSummary
  error?: string
}

/** SUCCESS status byte of a read-license (0x4A) response = a stored license. */
const LIC_STATUS_SUCCESS = 0x7e
/** LIC_UNSUPPORTED status byte (no on-device storage backend). */
const LIC_STATUS_UNSUPPORTED = 0x85

/**
 * Classify the connected device and, for a licensable target, recover its
 * license from the backend when absent. Assumes `client` is already connected;
 * the caller owns its lifecycle (this never disconnects it).
 */
export async function probeAndRecover(
  client: LicenseCapableTransport,
  opts: { isLicensable?: boolean; packageId?: string; keyId?: string },
): Promise<DeviceConnectResult> {
  try {
    const anchor = await readBoardIdWithRetries(client, { attempts: 6, backoffMs: 500 })
    if (!anchor.success || !anchor.anchor || anchor.anchor.length === 0) {
      // Channel opened but nothing spoke the debug protocol -> blank/non-OpenPLC.
      return { status: 'no-firmware' }
    }
    const anchorHex = anchor.anchorHex

    // Free VPP — no licensing step.
    if (!opts.isLicensable) return { status: 'connected-with-firmware', anchorHex }

    const lic = await client.readLicense()
    if (lic.status === LIC_STATUS_SUCCESS) {
      // A valid license blob is already stored — nothing to recover.
      return { status: 'connected-with-firmware', anchorHex, licenseStatus: 'licensed', activation: 'already-licensed' }
    }
    if (lic.status === LIC_STATUS_UNSUPPORTED || lic.unsupported) {
      // Declares isLicensable but has no on-device storage backend.
      return { status: 'connected-with-firmware', anchorHex, licenseStatus: 'unsupported', activation: 'unsupported' }
    }

    // Empty / corrupt on-device license -> attempt recover. Needs the package id.
    if (!opts.packageId) return { status: 'connected-with-firmware', anchorHex, licenseStatus: 'unlicensed' }

    const deviceId = deriveDeviceId(Uint8Array.from(anchor.anchor))
    const vppId = deriveVppId(opts.packageId)
    const act = await checkDeviceActivation({ deviceId, vppId, packageId: opts.packageId, keyId: opts.keyId })

    if (!act.licensed) {
      // Backend has no license for this device -> demo. The renderer prompts buy.
      return { status: 'connected-with-firmware', anchorHex, licenseStatus: 'unlicensed', activation: 'demo' }
    }

    if (act.license) {
      const write = await client.writeLicense(Uint8Array.from(act.license))
      if (write.unsupported) {
        return { status: 'connected-with-firmware', anchorHex, licenseStatus: 'unsupported', activation: 'unsupported' }
      }
      if (write.success) {
        return { status: 'connected-with-firmware', anchorHex, licenseStatus: 'licensed', activation: 'activated' }
      }
      return { status: 'connected-with-firmware', anchorHex, licenseStatus: 'unlicensed', activation: 'error', error: write.error }
    }

    // Licensed but the backend returned no blob — nothing to write; run as demo.
    return { status: 'connected-with-firmware', anchorHex, licenseStatus: 'unlicensed', activation: 'demo' }
  } catch (error) {
    return { status: 'error', error: getErrorMessage(error) }
  }
}

/** The legacy `device:activate-license` (P0-2/D62) outcome shape, kept for
 *  `DeviceActivationResult` (shared port surface) back-compat. */
export interface LegacyActivationOutcome {
  success: boolean
  outcome: 'already-licensed' | 'activated' | 'demo' | 'error' | 'no-id'
  anchorHex?: string
  license?: { present: boolean }
  error?: string
}

/**
 * Adapt a `probeAndRecover` result to the legacy one-shot activation outcome
 * (`handleActivateDeviceLicense`), so both IPC handlers share one
 * classify+recover implementation instead of two independently-maintained
 * copies. `deviceId`/`vppId`/`license.blob` are dropped: `DeviceActivationResult`
 * declares them optional and no consumer (frontend or tests) reads them off
 * this response — only `outcome`/`anchorHex` drive the UI.
 */
export function toLegacyActivationOutcome(result: DeviceConnectResult): LegacyActivationOutcome {
  switch (result.status) {
    case 'no-firmware':
      return { success: true, outcome: 'no-id' }
    case 'no-response':
      return { success: false, outcome: 'error', error: result.error ?? 'device did not respond' }
    case 'error':
      return { success: false, outcome: 'error', error: result.error }
    case 'connected-with-firmware':
      return mapConnectedActivation(result)
  }
}

function mapConnectedActivation(result: DeviceConnectResult): LegacyActivationOutcome {
  const anchorHex = result.anchorHex
  switch (result.activation) {
    case 'already-licensed':
      return { success: true, outcome: 'already-licensed', anchorHex, license: { present: true } }
    case 'activated':
      return { success: true, outcome: 'activated', anchorHex, license: { present: true } }
    case 'demo':
      return { success: true, outcome: 'demo', anchorHex }
    case 'unsupported':
      return { success: true, outcome: 'error', anchorHex, error: 'no on-device storage backend' }
    case 'error':
      return { success: true, outcome: 'error', anchorHex, error: result.error ?? 'License write failed' }
    default:
      // Unreachable from handleActivateDeviceLicense (always calls with
      // isLicensable: true), which always sets `activation` for a connected
      // licensable target. Kept for exhaustiveness against the shared type.
      return { success: true, outcome: 'error', anchorHex, error: 'unexpected: no activation outcome' }
  }
}
