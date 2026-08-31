import type { PLCVariable } from '../../../middleware/shared/ports/types'
import {
  getArrayStartIndex,
  isArrayVariable,
  isVariableLengthArray,
  multiDimensionalContainerType,
} from '../PLC/array-codegen-helpers'
import { cBlockExternalVariables, cBlockInterfaceVariables } from './block-interface'

type STCodeGenerationParams = {
  pouName: string
  allVariables: PLCVariable[]
}

/**
 * Pointer assignment for the user-visible struct.
 *
 * - Scalars (including STRING / WSTRING): `vars.NAME = &NAME` — every
 *   base type, strings included, is an `IECVar<T>` / `IECStringVar<N>`
 *   on the strucpp side, and the struct field is the matching
 *   `strucpp::IEC_T*` / `strucpp::IEC_STRING*` pointer. The user's
 *   `*name = 5` / `name = "hi"` routes through the wrapper's
 *   `operator=`, which respects forcing.
 *
 * - One-dimensional arrays: `vars.NAME = &NAME[lower] - lower`. `Array1D<T>`
 *   stores `std::array<IECVar<T>, N>`; element 0 sits at `&NAME[lower]`.
 *   Subtracting `lower` shifts the pointer so `vars->NAME[iec_idx]`
 *   works for any IEC index in the declared range. Per-element forcing
 *   is preserved.
 *
 * - Multi-dimensional arrays: `vars.NAME = &NAME`. The offset trick does not
 *   extend past rank one — `IEC_ARRAY_2D` has no `operator[]` and takes every
 *   index in one `operator()` call — so the container itself is passed and the
 *   block indexes it as `grid(i, j)`, the same accessor the compiler's own
 *   generated code uses.
 *
 * - Variable-length arrays: `vars.NAME = &NAME`, for the same reason as a
 *   multi-dimensional one. The pin is an `ArrayView<n>D`, whose bounds are not
 *   known until the call, so passing the first element would drop the only
 *   record of how many elements there are — and there is no lower bound yet to
 *   offset by. Passing the view keeps `lower_bound()` / `upper_bound()` / `at()`
 *   reachable from the block.
 */
const generateVariableAssignment = (variable: PLCVariable): string => {
  const name = variable.name.toUpperCase()
  if (multiDimensionalContainerType(variable) || isVariableLengthArray(variable)) {
    return `vars.${name} = &${name};\n`
  }
  if (isArrayVariable(variable)) {
    const startIndex = getArrayStartIndex(variable)
    return `vars.${name} = &${name}[${startIndex}] - ${startIndex};\n`
  }
  return `vars.${name} = &${name};\n`
}

/**
 * Wrap a call to the block so every `VAR_EXTERNAL` pointer is taken, and held,
 * under its global's own lock.
 *
 * strucpp holds a global as a `GlobalVar<V>` — the value plus that global's
 * mutex — and hands out access through `with_lock`, which runs a callable with a
 * `V*` while the lock is held. So the call is nested inside one such callable
 * per external, and each `vars` field is filled from the pointer that arrives.
 *
 * The lambda parameter is `auto*`, deduced. That matters beyond brevity: `V` is
 * `IEC_DINT` for a scalar, `MOTOR` for a structure, `IEC_MODE` for an
 * enumeration and `Array1D<IEC_INT, 0, 3>` for an array, and writing those out
 * here would be this file restating the compiler's layout — the one thing that
 * has to stay stated in exactly one place. Deduction keeps it there.
 *
 * An array is offset the same way a non-global one is, so the field stays a
 * pointer to the element type and `name[i]` indexes by the declared IEC range.
 * The dereference is bound to a reference on its own line rather than written
 * inline as `(*g)[lo]`: this C++ sits inside an `{external}` block that the ST
 * front end still scans, and `(*` opens a block comment there — inline would
 * swallow the rest of the POU and fail as `Unclosed block comment`.
 *
 * Nesting is in name order (see `cBlockExternalVariables`), identical in every
 * block, so no two blocks can take the same pair of globals in opposite orders.
 * The lock is therefore held for the whole call rather than per access —
 * stronger than an ST body gets, and the right default for code that may read a
 * global, compute from it, and write it back.
 */
const wrapInGlobalLocks = (externals: PLCVariable[], call: string): string => {
  if (externals.length === 0) return call

  let open = ''
  let close = ''
  externals.forEach((variable, depth) => {
    const name = variable.name.toUpperCase()
    const held = `g${depth}`
    open += `${name}->with_lock([&](auto* ${held}) {\n`
    if (isArrayVariable(variable) && !multiDimensionalContainerType(variable)) {
      const startIndex = getArrayStartIndex(variable)
      open += `auto& ${held}_arr = *${held};\n`
      open += `vars.${name} = &${held}_arr[${startIndex}] - ${startIndex};\n`
    } else {
      // Scalars, structures, function block instances and multi-dimensional
      // arrays are all passed as the pointer `with_lock` already hands over.
      open += `vars.${name} = ${held};\n`
    }
    close = `});\n` + close
  })

  return `${open}${call}\n${close}`.trimEnd()
}

const generateSTCode = (params: STCodeGenerationParams): string => {
  const { pouName, allVariables } = params

  const structName = `${pouName.toUpperCase()}_VARS`
  const setupFunctionName = `${pouName.toLowerCase()}_setup`
  const loopFunctionName = `${pouName.toLowerCase()}_loop`

  let variableAssignments = ''
  for (const variable of cBlockInterfaceVariables(allVariables)) {
    variableAssignments += generateVariableAssignment(variable)
  }

  // Externals are filled inside the lock wrapper instead, immediately before
  // each call — their pointers are only valid while that lock is held.
  const externals = cBlockExternalVariables(allVariables)

  // Header `{external}` block: declare the user-visible struct, fill
  // the pointer fields. STruC++ emits this body verbatim into the
  // program's run() method, so unqualified UPPERCASE names resolve to
  // class members (the program's IEC variables). No boundary copy is
  // needed — every pin (numeric, bit-string, STRING, WSTRING) is a
  // `strucpp::IEC_*` wrapper on both sides of the call, so taking its
  // address is type-compatible with the struct field.
  return `{external
${structName} vars;
${variableAssignments}}
if hasBeenInitialized = False then
{external
${wrapInGlobalLocks(externals, `${setupFunctionName}(&vars);`)}
}
hasBeenInitialized := True;
end_if;
{external
${wrapInGlobalLocks(externals, `${loopFunctionName}(&vars);`)}
}`
}

export { generateSTCode, type STCodeGenerationParams }
