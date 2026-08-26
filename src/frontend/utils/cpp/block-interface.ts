import type { PLCVariable, VariableClass } from '../../../middleware/shared/ports/types'
import { CPP_RUNTIME_INTERNAL_VARIABLE } from './addCppLocalVariables'

/**
 * Which of a C++ block's variables cross into its `<POU>_VARS` struct, and in
 * what order.
 *
 * Three emitters have to describe the same interface: `generateCBlocksHeader`
 * writes the struct, `generateSTCode` writes the pointer assignments that fill
 * it, and `generateCBlocksCode` writes the macros that bind the user's names to
 * it. If any one of them selects a different set, the mismatch is not a caught
 * error — a field the assignments skip is a dangling pointer the user's first
 * write follows. So the selection is made once, here, and all three read it.
 *
 * Selection rule: everything the user declared, minus what this toolchain
 * injected. That is the whole point of the parity work — a native block should
 * see its own Variables Table the way an ST block does, not a curated subset.
 *
 * `external` is deliberately absent. A `VAR_EXTERNAL` is not a plain member on
 * the strucpp side but a `GlobalVar<V>*` carrying the global's mutex, so it
 * needs a pointer of a different shape and an accessor that holds the lock —
 * handled separately rather than folded in here, where it would silently lose
 * the lock. `global` is absent for the same reason it is absent from a POU: it
 * is a configuration-level declaration, not a POU variable.
 */
const INTERFACE_CLASSES: readonly VariableClass[] = ['input', 'output', 'inOut', 'local', 'temp']

/**
 * Rank used to group struct fields by class.
 *
 * Grouping is cosmetic — the struct is filled by name, so order changes nothing
 * about correctness — but a stable order keeps the generated header readable and
 * keeps its diffs meaningful when a user adds a variable. Declaration order is
 * preserved inside each class.
 */
const CLASS_ORDER = new Map<VariableClass, number>(INTERFACE_CLASSES.map((cls, index) => [cls, index]))

/**
 * The variables that cross into the C block, grouped by class and stable within
 * each group.
 *
 * `hasBeenInitialized` is filtered out: the toolchain adds it to every C++ POU
 * to drive the one-shot `setup()` call, so it is machinery rather than something
 * the user declared, and exposing it would both clutter the struct and let a
 * block overwrite its own initialisation latch.
 */
const cBlockInterfaceVariables = (variables: readonly PLCVariable[]): PLCVariable[] => {
  // The rank is captured while filtering rather than looked up again in the
  // comparator: there it would need a fallback for a class that cannot occur,
  // which is an unreachable branch and a lie about what the data can be.
  const ranked: Array<{ variable: PLCVariable; rank: number; position: number }> = []

  variables.forEach((variable, position) => {
    if (variable.name === CPP_RUNTIME_INTERNAL_VARIABLE) return
    const rank = variable.class === undefined ? undefined : CLASS_ORDER.get(variable.class)
    if (rank === undefined) return
    ranked.push({ variable, rank, position })
  })

  return ranked
    .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.position - b.position))
    .map(({ variable }) => variable)
}

export { cBlockInterfaceVariables, INTERFACE_CLASSES }
