/**
 * Mutable state carried through the LD walker.
 *
 * Replaces `src/PLCGenerator/gen_state.ts` `GenState` for the
 * JSON-native walker.  Only the fields the LD walker actually
 * touches are surfaced here; FBD/SFC ports add their own.
 */

import type { ProgramChunk } from './path_tree'
import type { LdBody, LdInstance } from './types'

export interface TriggerVar {
  /** `R_TRIG1`, `R_TRIG2`, … or `F_TRIG1`, `F_TRIG2`, … */
  name: string
  type: 'R_TRIG' | 'F_TRIG'
}

/**
 * A `_TMP_<type><localId>_<formalParameter>` variable synthesised
 * during a function-call emission to hold one of the function's
 * outputs (`OUT`, `ENO`, or any other extra named output).  Mirrors
 * the `ensureFreshVarSection` + `iface.vars.push` side effect in
 * `xml-to-st/src/PLCGenerator/path_tree.ts:789-798`.  The caller is
 * responsible for emitting these into the POU's VAR section after
 * the walk completes.
 *
 * `type` is `BOOL` for `ENO`, or `'ANY'` for outputs whose type
 * isn't statically known by the walker (the driver runs a separate
 * type-inference pass against the standard block catalog to resolve
 * these — see `xml-to-st/src/PLCGenerator/connection_types.ts`).
 */
export interface FunctionTempVar {
  name: string
  /** `'BOOL'` for ENO temps; `'ANY'` for primary OUT and other
   *  outputs (the driver resolves these against `project.pous` /
   *  the standard block catalog using `originBlockTypeName`). */
  type: string
  /** Block's `typeName` (e.g. `'Eq_State'`, `'ADD'`).  Lets the
   *  driver replace `'ANY'` with the function's actual return
   *  type. */
  originBlockTypeName: string
  /** Which output of the block this temp represents (`'OUT'`,
   *  `'ENO'`, or any other formal parameter on multi-output
   *  functions). */
  originFormalParameter: string
}

export interface WalkerState {
  /** POU name (used as the first element of every location tuple). */
  tagName: string
  /** The LD body being walked, plus an id index built once on entry. */
  body: LdBody
  byId: Map<number, LdInstance>
  /** Accumulating ST chunk stream (the equivalent of `GenState.program`). */
  program: ProgramChunk[]
  /** Current indent string — top-level is `'  '` (2 spaces). */
  currentIndent: string
  /** Names already declared in the POU interface — used to avoid
   *  trigger-var name clashes.  Caller pre-populates from the POU's
   *  declared variables before the walk starts. */
  declaredVars: Set<string>
  /** Trigger vars synthesised during the walk; caller appends them
   *  to the POU's VAR section after the walk completes. */
  triggerVars: TriggerVar[]
  /** Block local-ids (FB-instance OR function) whose call statement
   *  has already been emitted — prevents double emission across
   *  multiple output reads of the same block.  Mirrors python's
   *  `state.computedBlocks[block] = True` flag (PLCGenerator.py:1467). */
  emittedBlocks: Set<number>
  /** `_TMP_<typeName><localId>_<formalParameter>` variables
   *  synthesised during function-call emission.  The caller appends
   *  these to the POU's VAR section after the walk. */
  functionTempVars: FunctionTempVar[]
  /** Connector → upstream chunks lookup, populated during
   *  `<connector>` iteration and consumed by `<continuation>`
   *  resolution.  Keyed by `name` attribute. */
  connectorExprs: Map<string, ProgramChunk[]>
  /** Warnings the walker raises that don't abort emission. */
  warnings: string[]
}

export function newWalkerState(tagName: string, body: LdBody, declaredVars: Set<string>): WalkerState {
  const byId = new Map<number, LdInstance>()
  for (const inst of body.instances) byId.set(inst.localId, inst)
  return {
    tagName,
    body,
    byId,
    program: [],
    currentIndent: '  ',
    declaredVars,
    triggerVars: [],
    emittedBlocks: new Set(),
    functionTempVars: [],
    connectorExprs: new Map(),
    warnings: [],
  }
}
