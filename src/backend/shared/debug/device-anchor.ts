/**
 * Device anchor (device-id) acquisition — pure mapping/decision helpers.
 *
 * The "anchor" is the target's hardware-unique id, acquired the SAME way on
 * every target (D70d): the raw bytes from the always-on debugger FC 0x48
 * (GET_BOARD_ID), carried by whichever transport the target uses:
 *   - `websocket` → OpenPLC runtime (Linux v4): 0x48 over the debug WebSocket
 *     (the runtime answers it at the webserver level; the raw bytes are the SoC
 *     serial from /proc/device-tree/serial-number).
 *   - `tcp` | `rtu` | `simulator` → arduino-cli targets (ESP32/AVR/avr8js).
 *
 * The bytes are used RAW (never hex-decoded) so the editor derives the same
 * device_id the closed .so/.a hashes. `source` is only a display label.
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
 * Map an FC 0x48 (GET_BOARD_ID) result into the unified anchor result. Used for
 * every transport (D70d) — the raw board-id bytes are taken verbatim, never
 * hex-decoded, so they hash to the same device_id the closed artifact expects.
 * `source` is a display label only (defaults to `arduino`; pass `runtime` for
 * the WebSocket target).
 */
export function mapArduinoAnchorResult(
  result: DebugBoardIdResult,
  source: DeviceAnchorSource = 'arduino',
): DeviceAnchorResult {
  if (!result.success) {
    return { success: false, source, error: result.error }
  }
  return {
    success: true,
    source,
    anchorHex: result.boardIdHex,
    anchor: result.boardId ? Array.from(result.boardId) : [],
  }
}
