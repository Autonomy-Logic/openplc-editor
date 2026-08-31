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
 * `connectedIp` is the device the editor currently holds a session for, empty
 * when there is none. `targetIp` is the device the user picked.
 */
export function nextStepForDevice(connectedIp: string, targetIp: string): RetrieveConnectionStep {
  if (!connectedIp) return 'credentials'
  if (connectedIp === targetIp) return 'retrieve'
  return 'confirm-disconnect'
}
