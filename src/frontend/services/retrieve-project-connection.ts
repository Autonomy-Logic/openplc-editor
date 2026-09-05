/**
 * What has to happen before a project can be retrieved from a device.
 *
 * `RuntimeApiClient` is deliberately single-device: one address, one token
 * authority, and signing in replaces the session. Retrieving from somewhere
 * else therefore costs the current connection, and the one thing that must
 * never happen is that cost being paid silently -- browsing another device
 * cannot quietly log someone out of the one they are working on.
 *
 * Kept out of the modal because this rule is the feature, not presentation.
 */

export type RetrieveConnectionStep =
  /** Already signed in to this exact device; the session in hand is the right one. */
  | 'retrieve'
  /** Signed in elsewhere; say what continuing costs before taking it. */
  | 'confirm-disconnect'
  /** No session to lose; just ask who to sign in as. */
  | 'credentials'

/**
 * `connected` identifies the device a live session is held for, empty when
 * there is none. `target` identifies the device the user picked.
 *
 * An identity, not an address, because the two platforms name devices
 * differently: desktop by IP, web by agent and device id. What matters is only
 * whether they are the same device, and whether there is a session at all --
 * a caller that holds a device context but no token must pass an empty
 * `connected`, because there is nothing to reuse or to lose.
 */
export function nextStepForDevice(connected: string, target: string): RetrieveConnectionStep {
  if (!connected) return 'credentials'
  if (connected === target) return 'retrieve'
  return 'confirm-disconnect'
}
