import type { PLCVariable } from '../../../middleware/shared/ports/types'
import { getArrayStartIndex, getVariableIECType, isArrayVariable } from '../PLC/array-codegen-helpers'

type STCodeGenerationParams = {
  pouName: string
  allVariables: PLCVariable[]
}

/**
 * Detect a STRING / WSTRING base-type variable. The C++ stub copies these
 * through a flat raw struct (matching c_blocks_code.cpp's typedef) so the
 * user keeps the `name.len` / `name.body[i]` syntax. Every other base type
 * (and arrays of base types) is passed by direct IECVar pointer.
 */
const isStringVariable = (variable: PLCVariable): boolean => {
  if (variable.type.definition !== 'base-type') return false
  const v = variable.type.value.toLowerCase()
  return v === 'string' || v === 'wstring'
}

/**
 * Per-string flat staging structs the user code reads/writes through. The
 * struct mirrors c_blocks_code.cpp's raw `IEC_STRING` typedef. We allocate
 * one per STRING/WSTRING variable on the stack of the program method, fill
 * it from the strucpp IECStringVar before the user runs, and write back
 * after.
 */
const generateStringStaging = (stringVariables: PLCVariable[]): string => {
  if (stringVariables.length === 0) return ''
  let code = ''
  for (const variable of stringVariables) {
    const iecType = getVariableIECType(variable) // IEC_STRING / IEC_WSTRING
    const name = variable.name.toUpperCase()
    code += `${iecType} __${name}_stage;\n`
  }
  return code
}

const generateStringCopyIn = (stringVariables: PLCVariable[]): string => {
  let code = ''
  for (const variable of stringVariables) {
    const name = variable.name.toUpperCase()
    code += `{ auto __s = ${name}.get();\n`
    code += `  __${name}_stage.len = (__strlen_t)__s.length();\n`
    code += `  std::memcpy(__${name}_stage.body, __s.c_str(), STR_MAX_LEN); }\n`
  }
  return code
}

const generateStringCopyOut = (stringVariables: PLCVariable[]): string => {
  let code = ''
  for (const variable of stringVariables) {
    const name = variable.name.toUpperCase()
    const iecType = getVariableIECType(variable)
    // strucpp::IEC_STRING is IECStringVar<254>; build an IECString<254>
    // from the staged bytes and assign — operator= → set() respects
    // forcing on the IEC side, so a forced output's user write is a
    // no-op for IEC reads (matching how scalar/array writes behave).
    const innerType = iecType === 'IEC_WSTRING' ? 'strucpp::IECWString<254>' : 'strucpp::IECString<254>'
    code += `${name} = ${innerType}(reinterpret_cast<const char*>(__${name}_stage.body), __${name}_stage.len);\n`
  }
  return code
}

/**
 * Pointer assignment for the user-visible struct.
 *
 * - Scalars: `vars.NAME = &NAME` — `&NAME` is `IECVar<T>*`, struct field
 *   is `strucpp::IEC_T*`, types match. The user's `*name = 5` then
 *   routes through `IECVar::operator=`, which respects forcing.
 *
 * - Base-type arrays: `vars.NAME = &NAME[lower] - lower`. `Array1D<T>`
 *   stores `std::array<IECVar<T>, N>`; element 0 of that std::array
 *   sits at `&NAME[lower]`. Subtracting `lower` shifts the pointer so
 *   `vars->NAME[iec_idx]` works for any IEC index in the declared
 *   range. Per-element forcing is preserved.
 *
 * - Strings: `vars.NAME = &__NAME_stage` — point at the flat staging
 *   struct, NOT the IECStringVar. The boundary copy in/out happens
 *   around the user's setup/loop calls.
 */
const generateVariableAssignment = (variable: PLCVariable): string => {
  const name = variable.name.toUpperCase()
  if (isArrayVariable(variable)) {
    const startIndex = getArrayStartIndex(variable)
    return `vars.${name} = &${name}[${startIndex}] - ${startIndex};\n`
  }
  if (isStringVariable(variable)) {
    return `vars.${name} = &__${name}_stage;\n`
  }
  return `vars.${name} = &${name};\n`
}

const generateSTCode = (params: STCodeGenerationParams): string => {
  const { pouName, allVariables } = params

  const inputVariables = allVariables.filter((v) => v.class === 'input')
  const outputVariables = allVariables.filter((v) => v.class === 'output')

  const structName = `${pouName.toUpperCase()}_VARS`
  const setupFunctionName = `${pouName.toLowerCase()}_setup`
  const loopFunctionName = `${pouName.toLowerCase()}_loop`

  // Strings need flat staging on the program method's stack — see
  // generateStringStaging for the reasoning.
  const inputStrings = inputVariables.filter(isStringVariable)
  const outputStrings = outputVariables.filter(isStringVariable)
  const allStrings = [...inputStrings, ...outputStrings]

  const stringStaging = generateStringStaging(allStrings)
  const stringCopyIn = generateStringCopyIn(allStrings)
  const stringCopyOut = generateStringCopyOut(outputStrings)

  let variableAssignments = ''
  for (const variable of inputVariables) variableAssignments += generateVariableAssignment(variable)
  for (const variable of outputVariables) variableAssignments += generateVariableAssignment(variable)

  // Header `{external}` block: declare the user-visible struct, stage
  // strings, fill the pointer fields. STruC++ emits this body verbatim
  // into the program's run() method, so unqualified UPPERCASE names
  // resolve to class members (the program's IEC variables).
  let stCode = `{external
${structName} vars;
${stringStaging}${stringCopyIn}${variableAssignments}}
if hasBeenInitialized = False then
{external
${setupFunctionName}(&vars);
}
hasBeenInitialized := True;
end_if;
{external
${loopFunctionName}(&vars);
}`

  // Writeback for output strings — base-type scalars and arrays write
  // through the IECVar pointer directly inside the user's loop, so no
  // extra copy is needed for them.
  if (stringCopyOut) {
    stCode += `\n{external
${stringCopyOut}}`
  }

  return stCode
}

export { generateSTCode, type STCodeGenerationParams }
