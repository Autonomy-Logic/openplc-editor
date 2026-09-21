/**
 * The rule that decides whether a board provided by a vendor package (VPP) may
 * be used against the vPLC the IDE is pointed at.
 *
 * A decision function in the same shape as `pre-build-plc-gate`: state in,
 * verdict out, no store, no dialog, no HTTP — so the board picker and the
 * deploy pre-check refuse on the same grounds, in the same words, and cannot
 * drift apart.
 *
 * Why the rule exists: a vendor package is chosen when the vPLC is created and
 * belongs to it. Its boards drive that vPLC's hardware and mean nothing
 * anywhere else, and exactly one vPLC per Device may reach the local backplane
 * at all. Without this the choice looks legal all the way through the build and
 * only fails on the device, at HAL init — or, for a serial-only driver, not at
 * all.
 */

import type { DeviceVpp } from '../../ports/vpp-types'

/** Everything the decision needs. Deliberately primitives, not a store slice. */
export interface VppBackplaneState {
  /** Does this board come from a vendor package? `BoardInfo.vpp` is the marker. */
  isVppBoard: boolean
  /**
   * The project names a board the IDE cannot resolve at all.
   *
   * The ordinary cause on web: the project was written against a vendor board
   * and the selected vPLC runs a different package, so the board is not in the
   * list any more. It must not vanish quietly — the picker keeps it visible
   * and selected, and the build says why rather than compiling something else.
   */
  boardMissing?: boolean
  /** What the project calls the board, for the missing-board message. */
  boardName?: string
  /**
   * The package id the board comes from, when it comes from one. Undefined for
   * a board that is not a VPP board, where the whole question does not arise.
   */
  boardPackageId?: string | undefined
  /**
   * Is a vPLC the target at all?
   *
   * False for the in-process simulator, a runtime on the LAN and the whole
   * desktop editor.
   */
  hasTargetVplc: boolean
  /**
   * Does a vendor board only exist here because a vPLC provides it?
   *
   * True on web, where the board list IS the selected vPLC's package, so a
   * vendor board with no vPLC behind it is a board that came from a selection
   * since cleared. False on the desktop, which installs packages locally and
   * connects to a board directly — there, "no vPLC" is the normal state and
   * gating on it would refuse every vendor build.
   */
  vplcProvidesVendorBoards: boolean
  /**
   * The target vPLC's flag, as the orchestrator listing reported it.
   * `undefined` means a host that predates the field said nothing — absent is
   * not `false`, and a silent host gates nothing.
   */
  backplaneAccess: boolean | undefined
  /**
   * The package the target vPLC was created with, as the host reported it.
   *
   * `null` means the host said the vPLC runs none. `undefined` means the host
   * said nothing at all, which a host predating the field does; that gates
   * nothing, exactly as an absent `backplaneAccess` does.
   */
  targetPackageId?: string | null | undefined
}

export type VppBackplaneVerdict =
  /** Nothing in the way — offer the board, run the deploy. */
  | { kind: 'allow' }
  /** The board cannot be used on this target. */
  | { kind: 'refuse'; reason: string }

/** May this board be used on this vPLC? */
export function evaluateVppBackplaneGate(state: VppBackplaneState): VppBackplaneVerdict {
  // Checked before `isVppBoard`, which a board nobody can resolve cannot answer.
  // Only against a vPLC: on the desktop an unresolved board is a different
  // problem with its own message, and this one would be the wrong explanation.
  if (state.boardMissing && state.hasTargetVplc) {
    return {
      kind: 'refuse',
      reason:
        `This project was written for ${state.boardName ?? 'a board'}, which the selected vPLC does not have. ` +
        'Select a vPLC created with the package that board comes from, or choose another board.',
    }
  }

  if (!state.isVppBoard) return { kind: 'allow' }

  // Where packages are installed locally, "no vPLC" is the normal state and
  // says nothing about the board.
  if (!state.hasTargetVplc) {
    if (!state.vplcProvidesVendorBoards) return { kind: 'allow' }
    return {
      kind: 'refuse',
      reason:
        'Select a vPLC before building for a vendor board. Vendor boards come from the package the vPLC was ' +
        'created with.',
    }
  }

  if (state.backplaneAccess === false) {
    return {
      kind: 'refuse',
      reason:
        'This vPLC has no access to the local backplane I/O. Create a vPLC with that option, or select the one ' +
        'that has it.',
    }
  }

  // A host that predates the field says nothing about the binding, and a
  // silent host must not read as one that answered "no package".
  if (state.targetPackageId === undefined) return { kind: 'allow' }

  if (state.targetPackageId === null) {
    return {
      kind: 'refuse',
      reason:
        'This vPLC was created without a vendor package, so it runs no vendor board. Create a vPLC with the ' +
        'package this board comes from.',
    }
  }

  if (state.boardPackageId !== undefined && state.boardPackageId !== state.targetPackageId) {
    return {
      kind: 'refuse',
      reason:
        `This vPLC runs ${state.targetPackageId}. ${state.boardPackageId} is not installed on it — create a ` +
        'vPLC with that package, or select one that has it.',
    }
  }

  return { kind: 'allow' }
}

/**
 * What the three callers have in hand — a board and the selected vPLC — turned
 * into the decision's inputs.
 *
 * Structural on purpose: the gate lives on the shared surface and must not
 * import a store slice. The caller passes whatever it holds that has these
 * shapes, which is what keeps the board picker, the build and the second
 * upload path asking the identical question.
 */
export function vppGateStateFor(args: {
  /** `BoardInfo.vpp` — its presence is what makes a board a vendor board. */
  board: { vpp?: { packageId: string } } | undefined
  /** What the project calls the board; only used when `board` is absent. */
  boardName?: string
  /** The selected vPLC, or null when the target is not a vPLC at all. */
  target: { backplaneAccess?: boolean; vpp?: DeviceVpp | null } | null | undefined
  /** `capabilities.hasOrchestratorDevices`: true on web, false on the desktop. */
  vplcProvidesVendorBoards: boolean
}): VppBackplaneState {
  return {
    vplcProvidesVendorBoards: args.vplcProvidesVendorBoards,
    isVppBoard: args.board?.vpp !== undefined,
    // A board name with nothing behind it: only meaningful when one was asked
    // for, and only decidable where the vPLC is what provides the board.
    boardMissing: args.vplcProvidesVendorBoards && args.board === undefined && Boolean(args.boardName),
    ...(args.boardName !== undefined && { boardName: args.boardName }),
    boardPackageId: args.board?.vpp?.packageId,
    hasTargetVplc: Boolean(args.target),
    backplaneAccess: args.target?.backplaneAccess,
    targetPackageId: args.target?.vpp === undefined ? undefined : (args.target.vpp?.packageId ?? null),
  }
}
