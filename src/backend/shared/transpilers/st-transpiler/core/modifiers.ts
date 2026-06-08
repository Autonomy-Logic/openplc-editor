/**
 * Modifier extraction for contacts and coils.
 *
 * Mirrors `src/PLCGenerator/modifiers.ts` exactly — three modifier
 * kinds, byte-faithful emission:
 *
 *   - `negated` → wrap expression in `NOT(...)`
 *   - `storage` (`set` / `reset`) → side-effect on the trailing
 *     program chunks; return a short "TRUE; END_IF" / "FALSE; END_IF"
 *     reference the caller substitutes
 *   - `edge` (`rising` / `falling`) → synthesize an `R_TRIG_N` /
 *     `F_TRIG_N` instance variable, emit its `(CLK := expr);`
 *     invocation, return `.Q` reference
 *
 * State carried via `WalkerState` (defined in `walker.ts`).
 */

import type { CoilModifier, ContactModifier } from './modifier-types'
import type { Location, ProgramChunk } from './path-tree'
import type { TriggerVar } from './trigger-var'

/**
 * Subset of `WalkerState` that the modifier helpers actually read or
 * mutate.  Lets the React Flow walker (which carries its own state
 * shape without `body` / `connectorExprs`) share this module without
 * type casts.  `WalkerState` itself satisfies `ModifierState`
 * structurally — no migration needed for the legacy walker.
 */
export interface ModifierState {
  program: ProgramChunk[]
  currentIndent: string
  declaredVars: Set<string>
  triggerVars: TriggerVar[]
}

export function extractModifier(
  state: ModifierState,
  modifier: ContactModifier | CoilModifier,
  expression: ProgramChunk[],
  varInfo: Location,
): ProgramChunk[] {
  if (modifier.negated) {
    return [['NOT(', [...varInfo, 'negated']], ...expression, [')', []]]
  }
  if ('storage' in modifier) {
    const storage = modifier.storage
    if (storage === 'set' || storage === 'reset') {
      state.program.push([`${state.currentIndent}IF `, [...varInfo, storage]])
      state.program.push(...expression)
      state.program.push([' THEN\n  ', []])
      const value = storage === 'set' ? 'TRUE' : 'FALSE'
      return [[`${value}; (*${storage}*)\n${state.currentIndent}END_IF`, []]]
    }
  }
  if (modifier.edge === 'rising') {
    return addTrigger(state, 'R_TRIG', expression, [...varInfo, 'rising'])
  }
  if (modifier.edge === 'falling') {
    return addTrigger(state, 'F_TRIG', expression, [...varInfo, 'falling'])
  }
  return expression
}

/** Inject a `R_TRIG`/`F_TRIG` instance var into the POU's interface
 *  and emit its `(CLK := expr);` invocation.  Returns `[`<name>.Q`]`
 *  for the caller to substitute. */
function addTrigger(
  state: ModifierState,
  edge: 'R_TRIG' | 'F_TRIG',
  expression: ProgramChunk[],
  varInfo: Location,
): ProgramChunk[] {
  ensureTriggerVarSection(state)
  let i = 1
  let name = `${edge}${i}`
  while (state.declaredVars.has(name)) {
    i++
    name = `${edge}${i}`
  }
  state.declaredVars.add(name)
  state.triggerVars.push({ name, type: edge })

  state.program.push([state.currentIndent, []])
  state.program.push([name, varInfo])
  state.program.push(['(CLK := ', []])
  state.program.push(...expression)
  state.program.push([');\n', []])

  return [[`${name}.Q`, varInfo]]
}

function ensureTriggerVarSection(state: ModifierState): void {
  // Trigger vars accumulate into `state.triggerVars`; the caller
  // flushes them into the POU's `VAR` block before final assembly.
  // No-op here beyond ensuring the array exists (always does).
  void state
}
