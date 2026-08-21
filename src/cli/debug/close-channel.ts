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

  // Probed rather than declared on `DeviceDebugChannel`: only transports with a
  // native handle have anything to wait for, and widening the interface would
  // oblige the WebSocket and the simulator to implement a no-op.
  const closed = readCloseSignal(channel)
  if (!closed) {
    // Still yield once, so any synchronous teardown the transport queued runs
    // before the caller exits.
    await delay(0)
    return
  }
  await Promise.race([closed(), delay(CHANNEL_CLOSE_TIMEOUT_MS)])
}

function readCloseSignal(channel: DeviceDebugChannel): (() => Promise<void>) | undefined {
  const candidate: unknown = Reflect.get(channel, 'closed')
  return typeof candidate === 'function' ? () => Promise.resolve(Reflect.apply(candidate, channel, [])) : undefined
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
