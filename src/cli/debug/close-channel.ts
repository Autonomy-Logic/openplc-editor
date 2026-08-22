/**
 * Closing a debug channel and waiting for it to really let go.
 *
 * `DeviceDebugChannel.disconnect()` is synchronous by contract, but the serial
 * transport's underlying `close()` is not: `@serialport/bindings-cpp` releases
 * the handle asynchronously and registers a NAPI async cleanup hook. Ending the
 * process inside that window makes the hook throw a C++ exception during
 * `node::Environment::CleanupHandles`, and an uncaught C++ exception aborts —
 * SIGABRT, which macOS reports as "Electron quit unexpectedly" with nothing of
 * ours in the log.
 *
 * The editor never hit this because a GUI keeps running after a disconnect. A
 * CLI whose whole job is to disconnect and exit hits it every time, so every
 * path that closes a channel before exiting goes through here.
 */

import type { DeviceDebugChannel } from '@root/backend/shared/debug/types'

/** Upper bound on the wait: a handle that never closes must not hang teardown. */
const CHANNEL_CLOSE_TIMEOUT_MS = 2000

export async function disconnectAndWait(channel: DeviceDebugChannel): Promise<void> {
  try {
    channel.disconnect()
  } catch {
    /* already disconnected */
  }

  // A declared optional member, checked by the compiler — the same pattern
  // `channelPlcControl` already uses for `setPlcState` / `getStatus`.
  if (!channel.closed) {
    // Still yield once, so any synchronous teardown the transport queued runs
    // before the caller exits.
    await delay(0)
    return
  }
  // Two hazards in this race, both of which turn a clean close into a mess:
  //
  //  - `closed()` can REJECT. `ModbusRtuClient.closed()` hands back the stored
  //    `closing` promise, and a failed native close rejects it. `SessionCore`
  //    awaits this call after it has already collected the forces it released,
  //    so a rejection here would throw that list away and report a failed close
  //    for a session that closed fine.
  //  - the loser of the race keeps running. A pending 2-second timer holds the
  //    event loop open after `closed()` has already won, which for a one-shot
  //    command is two seconds of doing nothing before it can exit.
  const timer = timeout(CHANNEL_CLOSE_TIMEOUT_MS)
  try {
    await Promise.race([channel.closed(), timer.expired])
  } catch {
    // The handle is gone either way; how it went is not this caller's business.
  } finally {
    timer.cancel()
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** A delay that can be called off, so losing a race costs nothing. */
function timeout(ms: number): { expired: Promise<void>; cancel: () => void } {
  let handle: NodeJS.Timeout | undefined
  const expired = new Promise<void>((resolve) => {
    handle = setTimeout(resolve, ms)
  })
  return {
    expired,
    cancel: () => {
      if (handle) clearTimeout(handle)
    },
  }
}
