/**
 * When is a held serial link down, coming back, or gone for good?
 *
 * The I/O around the held baremetal link (open the port, read the status frame,
 * close a dead handle) lives in the main process, which owns the client. What
 * lives HERE is only the counting: how many silent polls mean the link is down,
 * how many failed reopens mean it is gone. That is where the off-by-ones hide,
 * and it is the one part that can be tested without a cable to pull.
 *
 * The machine has two states:
 *
 *   healthy    - polling a live client. Consecutive silent polls accumulate;
 *                `failuresBeforeRecovery` of them enter recovery. Any answer
 *                resets the count, so an occasional dropped frame is not a drop.
 *   recovering - the link is down and reopens are being attempted, one per tick.
 *                A reopen that answers restores the link; `maxRecoveryAttempts`
 *                failures declare it lost.
 *
 * Recovery is what makes a cable pulled and plugged back in a non-event: the
 * link stays claimed for the whole window, so nothing is torn down and the user
 * has nothing to click.
 */

/** What the caller should do after reporting a poll result. */
export type ProbeDecision =
  /** Still healthy (or not yet past the failure budget) — keep polling. */
  | 'continue'
  /** Link is down: drop the dead client, keep the link, start reopening. */
  | 'enter-recovery'

/** What the caller should do after reporting a reopen attempt. */
export type ReopenDecision =
  /** Not back yet, attempts remain — try again next tick. */
  | 'retry'
  /** Back: adopt the fresh client and report 'connected'. */
  | 'recovered'
  /** Out of attempts: tear the link down and warn the user. */
  | 'give-up'

export class SerialLinkPolicy {
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

  /** Report whether the held client answered this tick. */
  onProbeResult(alive: boolean): ProbeDecision {
    if (alive) {
      this.consecutiveFailures = 0
      return 'continue'
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
   * attempt, so a caller that could not even build a client (no remembered
   * connect params, port gone) must still report `false` — otherwise recovery
   * would retry forever and the user would never be told.
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
