import type { PLCVariable, VariableClass } from '../../../middleware/shared/ports/types'
import { PYTHON_RUNTIME_INTERNAL_VARIABLES } from './addPythonLocalVariables'

/**
 * Which of a Python block's variables cross each way through shared memory.
 *
 * A Python block is a separate process, so unlike a C++ block it cannot be
 * handed a pointer into the PLC's own storage. Every variable is marshalled: the
 * stub packs one struct on the way in and unpacks another on the way out, and
 * the Python driver decodes and re-encodes them by `struct` format string. Four
 * emitters have to agree on the contents and the order of those two structs —
 * the C stub's `shm_data_in_t` / `shm_data_out_t`, its copy loops, the format
 * strings, and the driver's unpack/pack. A disagreement is not a caught error: a
 * field one side omits shifts every later field's offset, so the corruption
 * surfaces on unrelated variables. Hence one selection rule, here.
 *
 * The direction each class travels follows from what it means, not from what is
 * convenient:
 *
 *   - `input` goes in only. The caller supplies it; the block reads it.
 *   - `output` comes back only. The block produces it.
 *   - `inOut` travels both ways, which is what VAR_IN_OUT is.
 *   - `local` also travels both ways, though for a different reason: the PLC
 *     owns the storage, so round-tripping is what makes a VAR survive as the
 *     block's own state, stay visible to the debugger, and — once NODE-94 lands
 *     — be retainable. A block that never assigns one sends back what it
 *     received, unchanged.
 *   - `external` travels both ways for the same reason as `local`; the stub
 *     reads and writes it through the global's own lock.
 *
 * One consequence of marshalling an `external` is worth stating plainly, because
 * it differs from every other language a block can be written in. Each access is
 * atomic — the stub takes the global's lock to read and again to write — but the
 * read-modify-write as a whole is not, because the "modify" happens in another
 * process a cycle later. So `g := g + 1` in a Python block loses updates that
 * another task makes in between, where the same line in ST or C++ completes
 * inside one scan under one lock.
 *
 * Measured on hardware: a Python block and a C++ block each adding 2 to the same
 * global reached about 70% of the total both had added. With a single writer —
 * the ordinary case — the count is exact.
 *
 * The alternative is holding the lock from the Python read to the Python write,
 * which would stall every other task touching that global for a whole Python
 * cycle. Lost updates under contention is the better trade, but it is a real
 * difference and belongs in the user documentation.
 *
 * `temp` is absent deliberately: see `PYTHON_UNSUPPORTED_CLASSES`. `global` is
 * absent for the reason it is absent from a POU at all — it is a
 * configuration-level declaration, not a POU variable. So are the toolchain's
 * own injected locals (`PYTHON_RUNTIME_INTERNAL_VARIABLES`): the first-run latch
 * and the two mapped segment addresses are declared as `local`, and sweeping
 * them into the structs would hand the block its own segment pointers to
 * overwrite.
 */
const INBOUND_CLASSES: readonly VariableClass[] = ['input', 'inOut', 'local', 'external']

/** Classes the block sends back to the PLC each cycle. */
const OUTBOUND_CLASSES: readonly VariableClass[] = ['output', 'inOut', 'local', 'external']

/**
 * Classes a Python block cannot express, with the reason to show the user.
 *
 * VAR_TEMP means storage that does not survive the POU invocation. Python has
 * no equivalent: the block's variables are module globals in a process that
 * outlives every scan, so a value written to one would still be there on the
 * next call. Marshalling it would not make it temporary, it would only make it a
 * `local` wearing the wrong name — and the user would have written VAR to get
 * that. Refusing says what is true.
 */
const PYTHON_UNSUPPORTED_CLASSES: Readonly<Record<string, string>> = {
  temp: 'VAR_TEMP has no meaning in a Python block — its variables are module globals in a process that outlives the scan. Declare it under VAR instead.',
}

/**
 * Select and order the variables travelling one direction.
 *
 * Ordering is by class, then by declaration order within a class. The order
 * itself carries no meaning — it only has to be the same everywhere, because the
 * struct layout and the format string are positional.
 */
const selectOrdered = (variables: readonly PLCVariable[], classes: readonly VariableClass[]): PLCVariable[] => {
  const rankOf = new Map<VariableClass, number>(classes.map((cls, index) => [cls, index]))
  const ranked: Array<{ variable: PLCVariable; rank: number; position: number }> = []

  variables.forEach((variable, position) => {
    if (PYTHON_RUNTIME_INTERNAL_VARIABLES.has(variable.name)) return
    const rank = variable.class === undefined ? undefined : rankOf.get(variable.class)
    if (rank === undefined) return
    ranked.push({ variable, rank, position })
  })

  return ranked
    .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.position - b.position))
    .map(({ variable }) => variable)
}

/** What the PLC packs into `shm_data_in_t` for the block to read. */
const pythonInboundVariables = (variables: readonly PLCVariable[]): PLCVariable[] =>
  selectOrdered(variables, INBOUND_CLASSES)

/** What the block packs into `shm_data_out_t` for the PLC to read back. */
const pythonOutboundVariables = (variables: readonly PLCVariable[]): PLCVariable[] =>
  selectOrdered(variables, OUTBOUND_CLASSES)

/** Every variable that crosses the boundary at all, in inbound order. */
const pythonInterfaceVariables = (variables: readonly PLCVariable[]): PLCVariable[] => {
  const inbound = pythonInboundVariables(variables)
  const seen = new Set(inbound)
  return [...inbound, ...pythonOutboundVariables(variables).filter((variable) => !seen.has(variable))]
}

/** The variables declared in a class a Python block cannot express. */
const pythonRefusedVariables = (variables: readonly PLCVariable[]): Array<{ variable: PLCVariable; reason: string }> =>
  variables.flatMap((variable) => {
    const reason = variable.class === undefined ? undefined : PYTHON_UNSUPPORTED_CLASSES[variable.class]
    return reason ? [{ variable, reason }] : []
  })

export {
  INBOUND_CLASSES,
  OUTBOUND_CLASSES,
  PYTHON_UNSUPPORTED_CLASSES,
  pythonInboundVariables,
  pythonInterfaceVariables,
  pythonOutboundVariables,
  pythonRefusedVariables,
}
