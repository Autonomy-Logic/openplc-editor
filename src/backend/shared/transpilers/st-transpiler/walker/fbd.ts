/**
 * React Flow FBD body → Structured Text.
 *
 * FBD is a strict subset of LD's node vocabulary (no contacts, no
 * coils, no power rails, no parallel-branch markers) plus connector
 * / continuation pairs.  Both subsets feed the same execution-order
 * driven sink iteration and the same block-call / variable emission
 * code paths, so the FBD entry point is a thin adapter that wraps
 * the body's single `rung` into the `RFBody.rungs[]` shape the LD
 * walker consumes.
 *
 * FBD-specific behaviour (ENO gating on outVariable assignments,
 * connector caching, continuation lookup, executionOrderId-bucketed
 * sink sort) all live in the LD walker — they're no-ops for LD
 * bodies that don't exercise them.
 */
import { emitLdBody, type EmitResult } from './ld'
import type { RFRung } from './types'

export type { EmitResult } from './ld'

/** FBD body shape — a single `rung` container of nodes + edges. */
export interface RFFbdBody {
  rung: RFRung
}

export function emitFbdBody(body: RFFbdBody): EmitResult {
  return emitLdBody({ rungs: [body.rung] })
}
