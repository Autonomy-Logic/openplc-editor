/**
 * Connect/activation retry helpers shared over a `LicenseCapableTransport`.
 * Pure orchestration so both `probeAndRecover` (device-connect.ts) and
 * `handleActivateDeviceLicense` (main.ts) share one definition.
 */
import { mapArduinoAnchorResult } from '../../shared/debug/device-anchor'
import type { LicenseCapableTransport } from '../../shared/debug/types'

export type DeviceLicenseStatus = 'licensed' | 'unlicensed' | 'unsupported' | 'unknown'

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
