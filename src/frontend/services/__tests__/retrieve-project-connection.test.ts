/**
 * The three connection cases for Retrieve Project from PLC.
 *
 * The rule exists because `RuntimeApiClient` is single-device: signing in to
 * another device replaces the session. That is a property worth keeping, so
 * retrieving from elsewhere costs the current connection -- and the cost has to
 * be visible. Browsing another device must never quietly sign someone out of
 * the one they are working on.
 */

import { nextStepForDevice } from '../retrieve-project-connection'

describe('nextStepForDevice', () => {
  it('retrieves straight away from the device already connected', () => {
    // Nothing to ask and nothing to disconnect: the session in hand is already
    // authenticated against this device.
    expect(nextStepForDevice('192.168.2.4', '192.168.2.4')).toBe('retrieve')
  })

  it('asks before giving up a session on a different device', () => {
    expect(nextStepForDevice('192.168.2.4', '192.168.2.9')).toBe('confirm-disconnect')
  })

  it('goes straight to credentials when there is no session to lose', () => {
    expect(nextStepForDevice('', '192.168.2.4')).toBe('credentials')
  })

  it('never silently switches devices', () => {
    // The property, stated directly: any target that is not the connected
    // device stops for the user before the session moves.
    for (const target of ['192.168.2.9', '10.0.0.1', 'plc.local']) {
      expect(nextStepForDevice('192.168.2.4', target)).not.toBe('retrieve')
    }
  })

  it('treats an unknown connection as no connection rather than as a match', () => {
    // An empty address must not accidentally equal an empty target and let a
    // retrieve through with no session at all.
    expect(nextStepForDevice('', '')).toBe('credentials')
  })
})
