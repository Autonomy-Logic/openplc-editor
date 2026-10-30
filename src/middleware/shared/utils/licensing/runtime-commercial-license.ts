/**
 * Parsing for the runtime commercial licence surface of OpenPLC Runtime v4:
 * the `license` key of `GET /api/status` and the body of `GET /api/hardware-id`.
 * Both come from the target, so every value is checked before it is used.
 */

/** Commercial licence state reported by the runtime on `/api/status`. */
export type RuntimeCommercialLicense = 'commercial' | 'gpl'

/** Where the runtime's hardware ID comes from: its own hardware, or the host of a vPLC. */
export type RuntimeHardwareIdSource = 'device' | 'orchestrator'

export interface RuntimeHardwareId {
  /** `hw2:` plus 64 lowercase hex, or null when the target cannot derive one. */
  hardwareId: string | null
  source: RuntimeHardwareIdSource | null
}

const HARDWARE_ID_PATTERN = /^hw2:[0-9a-f]{64}$/

/** The `license` value, or undefined for a missing or unknown one (runtimes that predate it). */
export function parseRuntimeCommercialLicense(value: unknown): RuntimeCommercialLicense | undefined {
  return value === 'commercial' || value === 'gpl' ? value : undefined
}

export function isRuntimeHardwareId(value: unknown): value is string {
  return typeof value === 'string' && HARDWARE_ID_PATTERN.test(value)
}

/**
 * The body of `GET /api/hardware-id`, or null when it is not that shape.
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
