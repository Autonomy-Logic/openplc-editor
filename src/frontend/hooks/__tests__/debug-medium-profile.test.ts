/**
 * How the debug poll is paced and sized, per medium.
 *
 * This table is the whole reason the poller no longer asks which platform it is
 * running on. It replaced two independent sources — a copy of the spec's channel
 * kind (for batch size) and a WebRTC-slice flag behind an `isNativeApplication`
 * check (for cadence) — which could and did disagree.
 *
 * The invariants below are the ones that were violated in practice, so they are
 * asserted as properties rather than as a snapshot of the numbers.
 */
import type { DebugMedium } from '@root/middleware/shared/ports/types'

import { DEBUG_MEDIUM_PROFILE, debugProfileFor } from '../useDebugPolling'

/** Every medium the type admits. A new one must be added here deliberately. */
const ALL_MEDIA: DebugMedium[] = ['rtu', 'simulator', 'tcp', 'websocket', 'webrtc', 'http-relay']

describe('DEBUG_MEDIUM_PROFILE', () => {
  it('covers every medium, with no extras', () => {
    // A medium with no row would fall through to `undefined` and crash the poller
    // on `profile.batchSize`.
    expect(Object.keys(DEBUG_MEDIUM_PROFILE).sort()).toEqual([...ALL_MEDIA].sort())
  })

  it.each(ALL_MEDIA)('%s has a usable batch size and cadence', (medium) => {
    const { batchSize, pollIntervalMs } = DEBUG_MEDIUM_PROFILE[medium]
    expect(batchSize).toBeGreaterThan(1)
    expect(pollIntervalMs).toBeGreaterThan(0)
  })

  it('sizes serial-framed media to one USB-CDC packet', () => {
    // 6 + 3·19 = 63 ≤ 64. A 20th variable splits the request across two packets,
    // which older serial framers drop.
    for (const medium of ['rtu', 'simulator'] as const) {
      expect(DEBUG_MEDIUM_PROFILE[medium].batchSize).toBe(19)
      expect(6 + 3 * DEBUG_MEDIUM_PROFILE[medium].batchSize).toBeLessThanOrEqual(64)
    }
  })

  it('gives every runtime medium the same batch size', () => {
    // websocket / webrtc / http-relay all terminate at the SAME debug socket on the
    // runtime, so they share its frame budget. Only the hops in front of it differ.
    const runtimeMedia = ['websocket', 'webrtc', 'http-relay'] as const
    const sizes = new Set(runtimeMedia.map((m) => DEBUG_MEDIUM_PROFILE[m].batchSize))
    expect(sizes.size).toBe(1)
    expect(DEBUG_MEDIUM_PROFILE.websocket.batchSize).toBe(500)
  })

  it('backs the relay cadence off well below the direct media', () => {
    // The regression this guards: a v4 web session fell through to the simulator
    // row, polling the Edge relay every 50ms instead of every 1000ms.
    expect(DEBUG_MEDIUM_PROFILE['http-relay'].pollIntervalMs).toBeGreaterThan(
      DEBUG_MEDIUM_PROFILE.webrtc.pollIntervalMs,
    )
    expect(DEBUG_MEDIUM_PROFILE['http-relay'].pollIntervalMs).toBe(1000)
  })

  it('paces a peer-to-peer data channel like any other direct link', () => {
    // WebRTC reaches the agent directly, so it is not the relay's problem.
    expect(DEBUG_MEDIUM_PROFILE.webrtc.pollIntervalMs).toBe(DEBUG_MEDIUM_PROFILE.websocket.pollIntervalMs)
    expect(DEBUG_MEDIUM_PROFILE.webrtc.pollIntervalMs).toBe(200)
  })
})

describe('debugProfileFor', () => {
  it.each(ALL_MEDIA)('returns the %s row', (medium) => {
    expect(debugProfileFor(medium)).toBe(DEBUG_MEDIUM_PROFILE[medium])
  })

  it('falls back to tcp when the manager has published no medium yet', () => {
    // Middle of the range, and what the poller defaulted to before the media were
    // named. Deliberately NOT the simulator row, which is the fastest cadence and
    // the smallest batch — the worst possible guess for an unknown remote link.
    expect(debugProfileFor(null)).toBe(DEBUG_MEDIUM_PROFILE.tcp)
  })
})
