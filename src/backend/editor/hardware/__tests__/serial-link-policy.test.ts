/**
 * The held serial link's counting rules. These are the thresholds a user feels
 * as "it recovered by itself" vs "it gave up too early", and the only part of the
 * connection manager that can be checked without pulling a real cable.
 */
import { SerialLinkPolicy } from '../serial-link-policy'

/** Production shape: 2 silent polls enter recovery, 12 failed reopens give up. */
const newPolicy = () => new SerialLinkPolicy(2, 12)

describe('SerialLinkPolicy', () => {
  describe('while healthy', () => {
    it('stays healthy as long as the device answers', () => {
      const policy = newPolicy()
      for (let i = 0; i < 50; i++) expect(policy.onProbeResult(true)).toBe('continue')
      expect(policy.recovering).toBe(false)
    })

    it('tolerates a single silent poll', () => {
      // One dropped frame is not a dropped cable.
      const policy = newPolicy()
      expect(policy.onProbeResult(false)).toBe('continue')
      expect(policy.recovering).toBe(false)
    })

    it('enters recovery on the configured number of consecutive failures', () => {
      const policy = newPolicy()
      policy.onProbeResult(false)
      expect(policy.onProbeResult(false)).toBe('enter-recovery')
      expect(policy.recovering).toBe(true)
    })

    it('requires the failures to be CONSECUTIVE', () => {
      // Alternating silence and answers is a noisy link, not a dead one; entering
      // recovery there would close a working port.
      const policy = newPolicy()
      for (let i = 0; i < 10; i++) {
        expect(policy.onProbeResult(false)).toBe('continue')
        expect(policy.onProbeResult(true)).toBe('continue')
      }
      expect(policy.recovering).toBe(false)
    })
  })

  describe('while recovering', () => {
    const enterRecovery = () => {
      const policy = newPolicy()
      policy.onProbeResult(false)
      policy.onProbeResult(false)
      return policy
    }

    it('retries without giving up inside the window', () => {
      const policy = enterRecovery()
      for (let i = 0; i < 11; i++) expect(policy.onReopenResult(false)).toBe('retry')
      expect(policy.recovering).toBe(true)
    })

    it('gives up on exactly the configured attempt', () => {
      const policy = enterRecovery()
      for (let i = 0; i < 11; i++) policy.onReopenResult(false)
      expect(policy.onReopenResult(false)).toBe('give-up')
      expect(policy.attempts).toBe(0)
      expect(policy.recovering).toBe(false)
    })

    it('recovers at any point in the window and returns to healthy', () => {
      // The cable came back on the 5th attempt: the link must be healthy again,
      // with a FULL failure budget — not one poll away from recovery.
      const policy = enterRecovery()
      for (let i = 0; i < 4; i++) policy.onReopenResult(false)

      expect(policy.onReopenResult(true)).toBe('recovered')
      expect(policy.recovering).toBe(false)
      expect(policy.attempts).toBe(0)
      expect(policy.onProbeResult(false)).toBe('continue')
    })

    it('gives a full window to a second outage', () => {
      const policy = enterRecovery()
      for (let i = 0; i < 8; i++) policy.onReopenResult(false)
      policy.onReopenResult(true)

      // Pulled again: the earlier 8 attempts must not count against this outage.
      policy.onProbeResult(false)
      expect(policy.onProbeResult(false)).toBe('enter-recovery')
      for (let i = 0; i < 11; i++) expect(policy.onReopenResult(false)).toBe('retry')
      expect(policy.onReopenResult(false)).toBe('give-up')
    })

    it('counts an attempt that could not even be made', () => {
      // No remembered connect params / port gone: the caller reports false. If
      // that did not count, recovery would spin forever and never warn.
      const policy = enterRecovery()
      for (let i = 0; i < 12; i++) {
        const decision = policy.onReopenResult(false)
        if (i < 11) expect(decision).toBe('retry')
        else expect(decision).toBe('give-up')
      }
    })
  })

  describe('reset', () => {
    it('returns a recovering policy to healthy', () => {
      // A fresh Connect supersedes whatever the previous link was doing.
      const policy = newPolicy()
      policy.onProbeResult(false)
      policy.onProbeResult(false)
      policy.onReopenResult(false)

      policy.reset()

      expect(policy.recovering).toBe(false)
      expect(policy.attempts).toBe(0)
      expect(policy.onProbeResult(false)).toBe('continue')
    })
  })

  describe('degenerate configuration', () => {
    it('enters recovery on the first failure when the budget is 1', () => {
      const policy = new SerialLinkPolicy(1, 1)
      expect(policy.onProbeResult(false)).toBe('enter-recovery')
      expect(policy.onReopenResult(false)).toBe('give-up')
    })
  })
})
