/**
 * The rule that decides whether a board provided by a vendor package (VPP) may
 * be used against the vPLC the IDE is pointed at.
 *
 * A decision function in the same shape as `pre-build-plc-gate`: state in,
 * verdict out, no store, no dialog, no HTTP — so the board picker and the
 * deploy pre-check refuse on the same grounds, in the same words, and cannot
 * drift apart.
 *
 * Why the rule exists: exactly one vPLC per Device may drive the local
 * backplane I/O, and which one is fixed when the vPLC is created. A vendor
 * package drives that hardware, so its boards are meaningless anywhere else.
 * Without this the choice looks legal all the way through the build and only
 * fails on the device, at HAL init — or, for a serial-only driver, not at all.
 */

/** Everything the decision needs. Deliberately primitives, not a store slice. */
export interface VppBackplaneState {
  /** Does this board come from a vendor package? `BoardInfo.vpp` is the marker. */
  isVppBoard: boolean
  /**
   * The target vPLC's flag, as the orchestrator listing reported it. `undefined`
   * covers two cases that both mean "do not gate": no vPLC is the target at all
   * (the simulator, a LAN runtime, the desktop editor), and a host that predates
   * the field. Absent is not `false`.
   */
  backplaneAccess: boolean | undefined
}

export type VppBackplaneVerdict =
  /** Nothing in the way — offer the board, run the deploy. */
  | { kind: 'allow' }
  /** The board needs backplane I/O this vPLC does not hold. */
  | { kind: 'refuse'; reason: string }

/** May this board be used on this vPLC? */
export function evaluateVppBackplaneGate(state: VppBackplaneState): VppBackplaneVerdict {
  if (!state.isVppBoard) return { kind: 'allow' }
  if (state.backplaneAccess !== false) return { kind: 'allow' }
  return {
    kind: 'refuse',
    reason:
      'This vPLC has no access to the local backplane I/O. Create a vPLC with that option, or select the one ' +
      'that has it.',
  }
}
