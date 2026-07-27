/**
 * Device connect-probe (F1). Pure orchestration over a `LicenseCapableTransport`
 * so it is unit-testable with a mock client. Classifies a freshly-opened channel
 * as `no-response` (couldn't open), `no-firmware` (opened but no OpenPLC debug
 * reply -> blank board), or `connected-with-firmware`; for a licensable target it
 * additionally READS the on-device license status (0x4A) WITHOUT calling the
 * backend or writing -- that write/activate step is `handleActivateDeviceLicense`.
 *
 * This is the CONNECT-time classification the device screens use (D72 / D69d).
 * The retry helpers live here so both the probe and the activation handler share
 * one definition.
 */
import { getErrorMessage } from '../../../frontend/utils/get-error-message'
import { mapArduinoAnchorResult } from '../../shared/debug/device-anchor'
import type { LicenseCapableTransport } from '../../shared/debug/types'

export type DeviceProbeStatus = 'connected-with-firmware' | 'no-firmware' | 'no-response' | 'error'
export type DeviceLicenseStatus = 'licensed' | 'unlicensed' | 'unsupported' | 'unknown'

export interface DeviceProbeResult {
  status: DeviceProbeStatus
  /** Present when a firmware answered 0x48: the raw hardware id, lowercase hex. */
  anchorHex?: string
  /** On-device license state (0x4A), only for a licensable connected device. */
  licenseStatus?: DeviceLicenseStatus
  error?: string
}

/** SUCCESS status byte of a read-license (0x4A) response = a stored license. */
const LIC_STATUS_SUCCESS = 0x7e

/**
 * Connect with a bounded retry/backoff loop. A device flashed over arduino-cli
 * serial reboots as the programmer releases the port, so the first connect right
 * after an upload frequently races the reboot; retry, rethrowing the last error
 * only once every attempt is exhausted.
 */
export async function connectWithRetries(
  client: LicenseCapableTransport,
  { attempts, backoffMs }: { attempts: number; backoffMs: number },
): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await client.connect()
      return
    } catch (error) {
      lastError = error
      if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, backoffMs))
    }
  }
  throw lastError
}

/**
 * Read the board id (FC 0x48) with a bounded retry/backoff loop -- a readiness
 * probe for the firmware itself (the serial open auto-resets ESP8266/AVR boards).
 * Returns the unified anchor result; a non-empty anchor means a firmware answered.
 */
export async function readBoardIdWithRetries(
  client: LicenseCapableTransport,
  { attempts, backoffMs }: { attempts: number; backoffMs: number },
): Promise<ReturnType<typeof mapArduinoAnchorResult>> {
  let last = mapArduinoAnchorResult({ success: false })
  for (let attempt = 0; attempt < attempts; attempt++) {
    last = mapArduinoAnchorResult(await client.getBoardId())
    if (last.success && !!last.anchor && last.anchor.length > 0) return last
    if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, backoffMs))
  }
  return last
}

/**
 * Probe a device over the given transport and classify it. Never throws: any
 * failure resolves to a status. Closes the transport in `finally`.
 */
export async function probeDevice(
  client: LicenseCapableTransport,
  opts: { isLicensable?: boolean },
): Promise<DeviceProbeResult> {
  try {
    await connectWithRetries(client, { attempts: 5, backoffMs: 800 })
  } catch {
    // The channel/port could not be opened at all.
    return { status: 'no-response' }
  }

  try {
    const anchor = await readBoardIdWithRetries(client, { attempts: 6, backoffMs: 500 })
    if (!anchor.success || !anchor.anchor || anchor.anchor.length === 0) {
      // Channel opened but nothing spoke the debug protocol -> blank/non-OpenPLC.
      return { status: 'no-firmware' }
    }

    let licenseStatus: DeviceLicenseStatus | undefined
    if (opts.isLicensable) {
      const lic = await client.readLicense()
      licenseStatus = !lic.success
        ? 'unknown'
        : lic.status === LIC_STATUS_SUCCESS
          ? 'licensed'
          : lic.unsupported
            ? 'unsupported'
            : 'unlicensed'
    }

    return { status: 'connected-with-firmware', anchorHex: anchor.anchorHex, licenseStatus }
  } catch (error) {
    return { status: 'error', error: getErrorMessage(error) }
  } finally {
    client.disconnect()
  }
}
