/**
 * Device anchor (device-id) acquisition — pure mapping/decision helpers.
 *
 * The "anchor" is the target's hardware-unique id. How it is acquired depends
 * on the debug target type (dispatched on `connectionType`):
 *   - `websocket` → OpenPLC runtime (Linux v4): fetched over the runtime
 *     webserver HTTP API, which returns `{ device_id: "<hex>" }`.
 *   - `tcp` | `rtu` | `simulator` → arduino-cli targets (ESP32/AVR/avr8js):
 *     read via the always-on debugger FC 0x48 (GET_BOARD_ID).
 *
 * Both paths converge on the same unified `DeviceAnchorResult` so callers do
 * not care which transport produced the id.
 */

import type { DebugBoardIdResult } from './types'

/** Where the anchor was acquired from. */
export type DeviceAnchorSource = 'runtime' | 'arduino'

/**
 * Unified device-anchor result. `anchorHex` is the lowercase hex string of the
 * raw hardware id; `anchor` is the same bytes as a plain number[] (IPC-safe,
 * rehydrated to Uint8Array on the renderer side if needed).
 */
export interface DeviceAnchorResult {
  success: boolean
  source: DeviceAnchorSource
  anchorHex?: string
  anchor?: number[]
  error?: string
}

/** Debug connection types that resolve the anchor over the runtime HTTP API. */
export function selectAnchorSource(connectionType: string): DeviceAnchorSource {
  return connectionType === 'websocket' ? 'runtime' : 'arduino'
}

/**
 * Decode a hex string (as returned by the runtime `device_id` field) into its
 * raw bytes. Tolerant of an optional `0x` prefix and surrounding whitespace.
 * Returns `null` when the string is not valid hex (odd length or non-hex chars)
 * so the caller can surface an error instead of a corrupt anchor.
 */
export function decodeHexAnchor(hex: string): number[] | null {
  const cleaned = hex.trim().replace(/^0x/i, '')
  if (cleaned.length === 0) {
    return []
  }
  if (cleaned.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(cleaned)) {
    return null
  }
  const bytes: number[] = []
  for (let i = 0; i < cleaned.length; i += 2) {
    bytes.push(parseInt(cleaned.slice(i, i + 2), 16))
  }
  return bytes
}

/**
 * Map a runtime HTTP response (`{ device_id }`) into the unified result.
 * `device_id` is the hex string of the raw hardware id.
 */
export function mapRuntimeAnchorResult(deviceId: string | undefined): DeviceAnchorResult {
  if (typeof deviceId !== 'string' || deviceId.trim().length === 0) {
    return { success: false, source: 'runtime', error: 'Runtime returned no device_id' }
  }
  const decoded = decodeHexAnchor(deviceId)
  if (decoded === null) {
    return { success: false, source: 'runtime', error: `Runtime returned a malformed device_id: ${deviceId}` }
  }
  const anchorHex = deviceId.trim().replace(/^0x/i, '').toLowerCase()
  return { success: true, source: 'runtime', anchorHex, anchor: decoded }
}

/** Map an arduino-cli FC 0x48 result into the unified result. */
export function mapArduinoAnchorResult(result: DebugBoardIdResult): DeviceAnchorResult {
  if (!result.success) {
    return { success: false, source: 'arduino', error: result.error }
  }
  return {
    success: true,
    source: 'arduino',
    anchorHex: result.boardIdHex,
    anchor: result.boardId ? Array.from(result.boardId) : [],
  }
}
