/**
 * The held link's counting rules — what a user feels as "it recovered by itself"
 * vs "it gave up too early", and the only part of the connection manager that can
 * be checked without a cable to pull.
 */
import { DeviceLinkPolicy } from '../device-link-policy'

/** Production shape: 2 silent polls enter recovery, 2 failed reopens give up. */
const newPolicy = () => new DeviceLinkPolicy(2, 2)

const enterRecovery = () => {
  const policy = newPolicy()
  policy.onProbeResult('unresponsive')
  policy.onProbeResult('unresponsive')
  return policy
}

describe('DeviceLinkPolicy', () => {
  describe('a vanished endpoint fails immediately', () => {
    it('does not spend the failure budget first', () => {
      // A pulled USB cable is not a slow device. There is nothing to retry
      // against, so the user hears about it on the very first tick.
      const policy = newPolicy()
      expect(policy.onProbeResult('gone')).toBe('fail-now')
      expect(policy.recovering).toBe(false)
    })

    it('fails immediately even mid-recovery', () => {
      // Recovering from noise, and then the port disappears outright: stop
      // retrying and say so.
      const policy = enterRecovery()
      expect(policy.onProbeResult('gone')).toBe('fail-now')
      expect(policy.recovering).toBe(false)
    })

    it('leaves the policy reusable for the next connect', () => {
      const policy = newPolicy()
      policy.onProbeResult('gone')
      expect(policy.attempts).toBe(0)
      expect(policy.onProbeResult('alive')).toBe('continue')
    })
  })

  describe('while healthy', () => {
    it('stays healthy as long as the device answers', () => {
      const policy = newPolicy()
      for (let i = 0; i < 50; i++) expect(policy.onProbeResult('alive')).toBe('continue')
      expect(policy.recovering).toBe(false)
    })

    it('tolerates a single silent poll', () => {
      // Reopening a serial port resets an AVR board, so one dropped frame must
      // not restart the user's program.
      const policy = newPolicy()
      expect(policy.onProbeResult('unresponsive')).toBe('continue')
      expect(policy.recovering).toBe(false)
    })

    it('enters recovery on the configured number of consecutive failures', () => {
      const policy = newPolicy()
      policy.onProbeResult('unresponsive')
      expect(policy.onProbeResult('unresponsive')).toBe('enter-recovery')
      expect(policy.recovering).toBe(true)
    })

    it('requires the failures to be CONSECUTIVE', () => {
      // Alternating silence and answers is a noisy link, not a dead one.
      const policy = newPolicy()
      for (let i = 0; i < 10; i++) {
        expect(policy.onProbeResult('unresponsive')).toBe('continue')
        expect(policy.onProbeResult('alive')).toBe('continue')
      }
      expect(policy.recovering).toBe(false)
    })
  })

  describe('while recovering', () => {
    it('gives up quickly rather than retrying for half a minute', () => {
      const policy = enterRecovery()
      expect(policy.onReopenResult(false)).toBe('retry')
      expect(policy.onReopenResult(false)).toBe('give-up')
      expect(policy.recovering).toBe(false)
    })

    it('recovers at any point in the window and returns to healthy', () => {
      const policy = enterRecovery()
      policy.onReopenResult(false)

      expect(policy.onReopenResult(true)).toBe('recovered')
      expect(policy.recovering).toBe(false)
      expect(policy.attempts).toBe(0)
      // Full budget again, not one poll away from another recovery.
      expect(policy.onProbeResult('unresponsive')).toBe('continue')
    })

    it('gives a full window to a second outage', () => {
      const policy = enterRecovery()
      policy.onReopenResult(false)
      policy.onReopenResult(true)

      policy.onProbeResult('unresponsive')
      expect(policy.onProbeResult('unresponsive')).toBe('enter-recovery')
      expect(policy.onReopenResult(false)).toBe('retry')
      expect(policy.onReopenResult(false)).toBe('give-up')
    })

    it('counts an attempt that could not even be made', () => {
      // No candidate could be built: if that did not count, recovery would spin
      // forever and the user would never be told.
      const policy = enterRecovery()
      policy.onReopenResult(false)
      expect(policy.onReopenResult(false)).toBe('give-up')
    })
  })

  describe('reset', () => {
    it('returns a recovering policy to healthy', () => {
      // A fresh Connect supersedes whatever the previous link was doing.
      const policy = enterRecovery()
      policy.onReopenResult(false)

      policy.reset()

      expect(policy.recovering).toBe(false)
      expect(policy.attempts).toBe(0)
      expect(policy.onProbeResult('unresponsive')).toBe('continue')
    })
  })
})
