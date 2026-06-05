/**
 * Modifier extraction for LD/FBD contacts, coils, and variables.
 *
 * Mirrors `PouProgramGenerator.ExtractModifier` (PLCGenerator.py:1956) and
 * `AddTrigger` (PLCGenerator.py:1977).
 *
 * Three modifier kinds:
 *   - `@negated == "true"` → wrap expression in `NOT(...)`.
 *   - `@storage == "set" | "reset"` → emit `IF expr THEN TRUE; END_IF`
 *     directly to `state.program`; return a short success chunk.
 *   - `@edge == "rising" | "falling"` → synthesize an `R_TRIG`/`F_TRIG`
 *     instance variable, emit its `instance(CLK := expr);` call, return
 *     the trigger's `.Q` output reference.
 *
 * `extractModifier` has side effects on `state.program` and (via
 * `addTrigger`) on `state.iface`. The return is the chunk sequence that
 * the caller should substitute in place of the original expression.
 */

import { getedge, getnegated, getstorage } from '../plcopen/accessors'
import type { Element } from '../xmlclass/xsdschema'
import { type GenState, isAlreadyDefined } from './gen_state'
import type { Location, ProgramChunk } from './program'

/* ────────────────────────── ExtractModifier ─────────────────────────────── */

/**
 * Apply the variable's modifier (if any) to its expression.
 *
 * `varInfo` is the parent location tuple — e.g. for a coil at localId 42:
 *   `[tagName, "coil", 42]`. The modifier branches append a descriptor to
 *   it ("negated", "set", "reset", "rising", "falling") so editor cursor
 *   navigation can point at the modifier source.
 *
 * Returns the new chunk sequence the caller should treat as the variable's
 * effective expression — sometimes the same as input (no modifier), sometimes
 * `NOT(...)` wrapped, sometimes a short reference (set/reset) or `.Q` lookup
 * (rising/falling).
 */
export function extractModifier(
  state: GenState,
  variable: Element,
  expression: ProgramChunk[],
  varInfo: Location,
): ProgramChunk[] {
  if (getnegated(variable)) {
    return [['NOT(', [...varInfo, 'negated']], ...expression, [')', []]]
  }

  const storage = getstorage(variable)
  if (storage === 'set' || storage === 'reset') {
    state.program.push([`${state.currentIndent}IF `, [...varInfo, storage]])
    state.program.push(...expression)
    state.program.push([' THEN\n  ', []])
    const value = storage === 'set' ? 'TRUE' : 'FALSE'
    return [[`${value}; (*${storage}*)\n${state.currentIndent}END_IF`, []]]
  }

  const edge = getedge(variable)
  if (edge === 'rising') {
    return addTrigger(state, 'R_TRIG', expression, [...varInfo, 'rising'])
  }
  if (edge === 'falling') {
    return addTrigger(state, 'F_TRIG', expression, [...varInfo, 'falling'])
  }

  return expression
}

/* ────────────────────────── AddTrigger ──────────────────────────────────── */

/**
 * Inject an edge-trigger function block instance into the POU's interface
 * and emit its `instance(CLK := expr);` invocation into `state.program`.
 *
 * Mirrors `AddTrigger` (PLCGenerator.py:1977). The variable name is chosen
 * by incrementing `R_TRIG1`, `R_TRIG2`, … (or `F_TRIG1`, …) until
 * `IsAlreadyDefined` says it's free.
 *
 * Side effects on `state`:
 *   - `state.iface`: may append a new `VAR` entry if the last entry isn't
 *     a plain (no option, non-located) `VAR`. Then appends the trigger var
 *     to the last entry's `vars` list.
 *   - `state.program`: appends three chunks:
 *       `[currentIndent, ()] [name, varInfo] ["(CLK := ", ()]`
 *     followed by the expression chunks, then `[");\n", ()]`.
 *
 * Returns `[("<name>.Q", varInfo)]` — the single-chunk reference to the
 * trigger's Q output, which the caller substitutes for the original
 * expression.
 */
export function addTrigger(
  state: GenState,
  edge: 'R_TRIG' | 'F_TRIG',
  expression: ProgramChunk[],
  varInfo: Location,
): ProgramChunk[] {
  ensureTriggerVarSection(state)

  let i = 1
  let name = `${edge}${i}`
  while (isAlreadyDefined(state, name)) {
    i++
    name = `${edge}${i}`
  }
  // Append to the last interface entry (guaranteed to be a plain VAR after
  // ensureTriggerVarSection). Python uses `edge` as the var TYPE.
  state.iface[state.iface.length - 1].vars.push({
    type: edge,
    name,
    address: null,
    initial: null,
  })

  state.program.push([state.currentIndent, []])
  state.program.push([name, varInfo])
  state.program.push(['(CLK := ', []])
  state.program.push(...expression)
  state.program.push([');\n', []])

  return [[`${name}.Q`, varInfo]]
}

/**
 * Ensure the LAST interface entry is a plain `VAR` section (no option, not
 * located) so we can append a trigger var to it. If the last entry doesn't
 * match, append a fresh empty one. Mirrors PLCGenerator.py:1978-1983:
 *
 *     if (self.Interface[-1][0] != "VAR"
 *         or self.Interface[-1][1] is not None
 *         or self.Interface[-1][2]):
 *         self.Interface.append(("VAR", None, False, []))
 */
function ensureTriggerVarSection(state: GenState): void {
  const last = state.iface[state.iface.length - 1]
  if (last === undefined || last.keyword !== 'VAR' || last.option !== null || last.located) {
    state.iface.push({ keyword: 'VAR', option: null, located: false, vars: [] })
  }
}
