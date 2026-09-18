/**
 * Debug poll pacing and batching, per medium — pure data plus its resolver.
 *
 * Split out of `useDebugPolling` so callers that are not React can reach it.
 * The headless CLI's debug session sizes its variable reads from this table,
 * and importing it from the hook would drag React and the Zustand store into a
 * Node process. Duplicating the numbers instead was the other option, and the
 * worse one: they encode physical frame budgets at the far end, so a CLI copy
 * that drifted would produce requests real firmware silently drops.
 */

import type { DebugMedium } from '../../middleware/shared/ports/types'

/**
 * How to pace and size the debug poll, per medium.
 *
 * These are two INDEPENDENT physical limits, which is why they live in one table
 * rather than being derived from each other:
 *
 * `batchSize` — the frame budget at the far end. The request packs 3 bytes per
 * variable (arr:u8 + elem:u16) and the response packs raw type-sized values after
 * a small header. It is a property of the TARGET, never of the board the user
 * picked, since the same board can be reached over RTU or TCP.
 *   rtu / simulator : 19, so the request stays ≤63 bytes and fits one 64-byte
 *                     USB-CDC packet (6 + 3·19 = 63). A 20-variable request is 66
 *                     bytes, which a SAMD21 / P1AM-100 receives split across two
 *                     packets — older firmware whose serial framer cannot
 *                     reassemble then drops it. The simulator's virtual serial
 *                     port mirrors the same framing.
 *   tcp             : the Arduino sketch's MAX_MB_FRAME caps it; 60 has headroom.
 *   websocket /     : the Linux runtime's MAX_DEBUG_FRAME=4096 — ~500 variables
 *   webrtc /          with room for value bytes. All three reach the SAME debug
 *   http-relay        socket on the runtime, so they share its budget; only the
 *                     number of hops in front of it differs.
 *
 * `pollIntervalMs` — round-trip latency of the link.
 *   rtu / simulator : 50ms, no network in the way; keep the UI responsive.
 *   tcp / websocket : 200ms, one network hop.
 *   webrtc          : 200ms, peer-to-peer to the agent — as direct as it gets.
 *   http-relay      : 1000ms. Every poll is browser -> Edge -> agent websocket ->
 *                     runtime and back. Polling this at the direct rate buries the
 *                     relay in requests for data that cannot arrive any faster.
 *                     Overridable per deployment via
 *                     `capabilities.debugRelayPollIntervalMs`.
 *
 * A medium the caller has not published yet reads as `tcp` — the middle of the
 * range, and what this defaulted to before the media were named.
 */
export const DEBUG_MEDIUM_PROFILE: Record<DebugMedium, { batchSize: number; pollIntervalMs: number }> = {
  rtu: { batchSize: 19, pollIntervalMs: 50 },
  simulator: { batchSize: 19, pollIntervalMs: 50 },
  tcp: { batchSize: 60, pollIntervalMs: 200 },
  websocket: { batchSize: 500, pollIntervalMs: 200 },
  webrtc: { batchSize: 500, pollIntervalMs: 200 },
  'http-relay': { batchSize: 500, pollIntervalMs: 1000 },
}

/** Assumed medium before a session publishes its own. */
export const DEFAULT_DEBUG_MEDIUM: DebugMedium = 'tcp'

/** The profile for a medium, tolerating one not yet published. */
export function debugProfileFor(medium: DebugMedium | null): { batchSize: number; pollIntervalMs: number } {
  return DEBUG_MEDIUM_PROFILE[medium ?? DEFAULT_DEBUG_MEDIUM]
}
