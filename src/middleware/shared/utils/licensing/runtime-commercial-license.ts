/**
 * Parsing for the hardware ID OpenPLC Runtime v4 reports on `GET /api/hardware-id`
 * and `GET /api/runtime-license`. It comes from the target, so it is checked before use.
 */

/** Commercial licence state of a runtime, as the editor verified it. */
export type RuntimeCommercialLicense = 'commercial' | 'gpl'

/** Where the runtime's hardware ID comes from: its own hardware, or the host of a vPLC. */
export type RuntimeHardwareIdSource = 'device' | 'orchestrator'

export interface RuntimeHardwareId {
  /** `hw2:` plus 64 lowercase hex, or null when the target cannot derive one. */
  hardwareId: string | null
  source: RuntimeHardwareIdSource | null
}

const HARDWARE_ID_PATTERN = /^hw2:[0-9a-f]{64}$/

export function isRuntimeHardwareId(value: unknown): value is string {
  return typeof value === 'string' && HARDWARE_ID_PATTERN.test(value)
}

/**
 * The hardware ID in a `GET /api/hardware-id` or `GET /api/runtime-license` body, or null when it is not that shape.
 * A malformed ID is reported as no ID rather than passed on.
 */
export function parseRuntimeHardwareId(body: unknown): RuntimeHardwareId | null {
  if (typeof body !== 'object' || body === null) return null
  const { hardwareId, source } = body as { hardwareId?: unknown; source?: unknown }
  if (hardwareId === null || hardwareId === undefined) return { hardwareId: null, source: null }
  if (!isRuntimeHardwareId(hardwareId)) return null
  return {
    hardwareId,
    source: source === 'device' || source === 'orchestrator' ? source : null,
  }
}
