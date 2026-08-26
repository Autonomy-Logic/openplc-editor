import type { PLCVariable } from '../../../middleware/shared/ports/types'
import { getArrayStartIndex, isArrayVariable } from '../PLC/array-codegen-helpers'
import { getCppPouStateVariables } from './cppPouVariables'

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
 * - Base-type arrays: `vars.NAME = &NAME[lower] - lower`. `Array1D<T>`
 *   stores `std::array<IECVar<T>, N>`; element 0 sits at `&NAME[lower]`.
 *   Subtracting `lower` shifts the pointer so `vars->NAME[iec_idx]`
 *   works for any IEC index in the declared range. Per-element forcing
 *   is preserved.
 */
const generateVariableAssignment = (variable: PLCVariable): string => {
  const name = variable.name.toUpperCase()
  if (isArrayVariable(variable)) {
    const startIndex = getArrayStartIndex(variable)
    return `vars.${name} = &${name}[${startIndex}] - ${startIndex};\n`
  }
  return `vars.${name} = &${name};\n`
}

const generateSTCode = (params: STCodeGenerationParams): string => {
  const { pouName, allVariables } = params

  const stateVariables = getCppPouStateVariables(allVariables)

  const structName = `${pouName.toUpperCase()}_VARS`
  const setupFunctionName = `${pouName.toLowerCase()}_setup`
  const loopFunctionName = `${pouName.toLowerCase()}_loop`

  let variableAssignments = ''
  for (const variable of stateVariables) variableAssignments += generateVariableAssignment(variable)

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
${setupFunctionName}(&vars);
}
hasBeenInitialized := True;
end_if;
{external
${loopFunctionName}(&vars);
}`
}

export { generateSTCode, type STCodeGenerationParams }
