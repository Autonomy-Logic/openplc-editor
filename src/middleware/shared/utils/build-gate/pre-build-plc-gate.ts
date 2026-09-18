/**
 * The rule that decides whether a build may start while the PLC is running.
 *
 * A decision function: state in, verdict out. No dialogs, no HTTP, no store —
 * so the GUI and the CLI reach the same verdict from the same inputs and only
 * the CONSENT mechanism differs (a modal on one side, `--yes` on the other).
 *
 * It exists because the rule was written twice and the copies had already
 * diverged in substance: the GUI decided from cached store state and did not
 * handle a switch refusal at all, while the CLI probed live status and did. Two
 * answers to "may I build?" is one answer too many when the wrong one either
 * blocks a legitimate build or stalls a running plant.
 *
 * Why the rule exists at all: targets that are not flashed over USB run the
 * FINAL build step ON the device. Doing that while the PLC is scanning can stall
 * the build or make the running program miss its deadlines.
 */

/** Everything the decision needs. Deliberately primitives, not a store slice. */
export interface PreBuildPlcState {
  /**
   * False for a target the editor flashes over USB (arduino-cli). Those build
   * on the host, so a running PLC is irrelevant to them.
   */
  buildsOnDevice: boolean
  /** Is there a live connection to the target's runtime? */
  connected: boolean
  /** Is the PLC scanning a program right now? */
  running: boolean
}

export type PreBuildPlcVerdict =
  /** Nothing in the way — build. */
  | { kind: 'proceed' }
  /**
   * The PLC is running and must be stopped first. The caller obtains consent
   * however it can (a dialog, `--yes`) and then performs the stop.
   */
  | { kind: 'must-stop'; reason: string }

/**
 * May a build start?
 *
 * Not connected is `proceed`, deliberately: the build's own upload step reports
 * an unreachable target far better than a pre-flight guess, and refusing here
 * would block a compile-only build that never touches the device.
 */
export function evaluatePreBuildPlcGate(state: PreBuildPlcState): PreBuildPlcVerdict {
  if (!state.buildsOnDevice) return { kind: 'proceed' }
  if (!state.connected) return { kind: 'proceed' }
  if (!state.running) return { kind: 'proceed' }
  return {
    kind: 'must-stop',
    reason:
      'This target builds on the device, and its PLC is running. Building now can stall the build or make ' +
      'the running program miss scan deadlines.',
  }
}
