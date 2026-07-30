/**
 * When is a held device link down, coming back, or gone for good?
 *
 * The I/O around the link (open a port or socket, read the status frame, close a
 * dead handle) lives in `DeviceLinkManager`. What lives HERE is only the
 * counting, because that is where the off-by-ones hide and it is the one part
 * that can be tested without a cable to pull.
 *
 * Two states:
 *
 *   healthy    - polling a live client. Consecutive silent polls accumulate;
 *                `failuresBeforeRecovery` of them enter recovery. Any answer
 *                resets the count, so one dropped frame is not a dropped link.
 *   recovering - the link is down and reopens are attempted, one per tick. A
 *                reopen that answers restores the link; `maxRecoveryAttempts`
 *                failures declare it lost.
 *
 * Two things set the pace, and they pull in opposite directions:
 *
 *   - Failing fast is good. A link that is definitely gone should say so at once,
 *     not after half a minute of pointless retries.
 *   - Reopening is NOT free. Opening a serial port asserts DTR, which resets an
 *     AVR board — so a trigger-happy reconnect would restart the user's PLC
 *     program over a single dropped frame. (Native-USB parts like the SAMD in a
 *     P1AM do not reset, but the policy cannot know which board it is talking to.)
 *
 * Hence: a `gone` verdict — the serial port is no longer enumerated, so there is
 * nothing to reset and nothing to wait for — fails IMMEDIATELY, bypassing the
 * budget entirely. An `unresponsive` verdict, which may be noise, spends the
 * budget first and only then reopens.
 */

/** What a single probe of the held link concluded. */
export type LinkProbeVerdict =
  /** Answered. */
  | 'alive'
  /** Open but silent: timed out, bad reply, or an unexplained error. */
  | 'unresponsive'
  /** The endpoint itself is no longer there (serial port vanished from the OS). */
  | 'gone'

/** What the caller should do after reporting a probe. */
export type ProbeDecision =
  /** Healthy, or not yet past the failure budget — keep polling. */
  | 'continue'
  /** Link is down: drop the dead client, keep the link, start reopening. */
  | 'enter-recovery'
  /** Endpoint is gone: tear down and tell the user now. No retries. */
  | 'fail-now'

/** What the caller should do after reporting a reopen attempt. */
export type ReopenDecision =
  /** Not back yet, attempts remain — try again next tick. */
  | 'retry'
  /** Back: adopt the fresh client and report connected. */
  | 'recovered'
  /** Out of attempts: tear down and tell the user. */
  | 'give-up'

export class DeviceLinkPolicy {
  private consecutiveFailures = 0
  private recoveryAttempts = 0
  private inRecovery = false

  constructor(
    private readonly failuresBeforeRecovery: number,
    private readonly maxRecoveryAttempts: number,
  ) {}

  /** True while reopens are being attempted rather than the client polled. */
  get recovering(): boolean {
    return this.inRecovery
  }

  /** Attempts made in the current recovery window (0 when healthy). */
  get attempts(): number {
    return this.recoveryAttempts
  }

  /** Back to a freshly connected, healthy link. */
  reset(): void {
    this.consecutiveFailures = 0
    this.recoveryAttempts = 0
    this.inRecovery = false
  }

  /** Report what this tick's probe of the held client concluded. */
  onProbeResult(verdict: LinkProbeVerdict): ProbeDecision {
    if (verdict === 'alive') {
      this.consecutiveFailures = 0
      return 'continue'
    }
    if (verdict === 'gone') {
      // Nothing to retry against and nothing to reset: the endpoint is not there.
      this.reset()
      return 'fail-now'
    }
    this.consecutiveFailures += 1
    if (this.consecutiveFailures < this.failuresBeforeRecovery) return 'continue'

    this.inRecovery = true
    this.recoveryAttempts = 0
    this.consecutiveFailures = 0
    return 'enter-recovery'
  }

  /**
   * Report whether this tick's reopen produced a link that answers. Counts the
   * attempt, so a caller that could not even build a client (no candidates left,
   * port gone) must still report `false` — otherwise recovery would retry forever
   * and the user would never be told.
   */
  onReopenResult(recovered: boolean): ReopenDecision {
    this.recoveryAttempts += 1
    if (recovered) {
      this.reset()
      return 'recovered'
    }
    if (this.recoveryAttempts >= this.maxRecoveryAttempts) {
      this.reset()
      return 'give-up'
    }
    return 'retry'
  }
}
