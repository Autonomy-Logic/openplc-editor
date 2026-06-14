import { generateStructMember, isArrayVariable } from '../../../../frontend/utils/PLC/array-codegen-helpers'
import type { PLCVariable } from '../../../../middleware/shared/ports/types'

type CppPouData = {
  name: string
  code: string
  variables: PLCVariable[]
}

/**
 * Self-contained baseline for c_blocks_code.cpp. Carries:
 *
 *   - The strucpp runtime includes so the auto-generated POU struct
 *     fields (`strucpp::IEC_INT*` / `strucpp::IEC_STRING*` etc.,
 *     emitted by `generateStructMember`) resolve to IECVar /
 *     IECStringVar wrappers.  Force semantics flow through
 *     `IECVar::operator=` (and `IECStringVar::operator=`) on every
 *     user write — uniform across numeric, bit-string, and string
 *     pins.
 *
 *   - File-scope raw numeric typedefs (`IEC_BOOL` / `IEC_INT` /
 *     `IEC_REAL` / etc.) preserved from the MatIEC era.  These exist
 *     ONLY for the user's *local* variables inside `setup()` /
 *     `loop()` (e.g. `IEC_INT my_temp = 0;`).  They never collide
 *     with the auto-generated struct fields because the struct
 *     fully qualifies as `strucpp::IEC_*`.
 *
 *   - No raw `IEC_STRING` / `IEC_WSTRING` typedef.  STRING pins now
 *     use the strucpp wrapper end-to-end (`strucpp::IEC_STRING =
 *     IECStringVar<254>`), so user code interacts with them via
 *     `name = "hello";` / `name.length()` / `name[i]` /
 *     `name.c_str()` / `name == "stop"` — the same surface every
 *     other pin already exposes.  Local STRING variables inside
 *     setup() / loop() can also be declared as
 *     `strucpp::IEC_STRING my_buf;` (or `using strucpp::IEC_STRING;`
 *     at the top of the user's POU body, opt-in).
 */
const C_BLOCKS_BASELINE = `#include <cstdint>
#include <cstring>

#ifdef ARDUINO
#include <Arduino.h>
// Arduino.h defines \`min\` and \`max\` as preprocessor macros, which
// collide with the \`std::min\` / \`std::max\` function templates and
// the \`numeric_limits<T>::min()\` / \`max()\` static members that
// \`<algorithm>\` / \`<limits>\` declare (both pulled in transitively
// via \`iec_string.hpp\` below). Undef'ing them here keeps the user's
// c_blocks code free to call \`std::min\` / \`std::max\` and lets the
// strucpp runtime headers compile cleanly on AVR.
#undef min
#undef max
#endif

// STruC++ runtime types — IECVar<T> / IECStringVar<N> wrappers under
// namespace strucpp.  The auto-generated POU struct refers to them
// as \`strucpp::IEC_*\` for every pin (numeric, bit-string, STRING,
// WSTRING), keeping force-aware semantics on the user's writes via
// the wrapper's operator=.
#include "iec_var.hpp"
#include "iec_string.hpp"

/*********************/
/*  IEC Types defs   */
/*********************/
//
// File-scope raw typedefs for the user's LOCAL variables inside
// setup() / loop() (e.g. \`IEC_INT my_temp = 0;\`).  The auto-
// generated POU struct fields use the fully-qualified
// \`strucpp::IEC_*\` wrappers and are unaffected by these aliases.
// STRING / WSTRING are NOT defined as raw POD structs here — local
// STRING variables should use \`strucpp::IEC_STRING\` directly
// (\`IECStringVar<254>\`), matching the wrapper used on pin fields.

typedef uint8_t  IEC_BOOL;

typedef int8_t    IEC_SINT;
typedef int16_t   IEC_INT;
typedef int32_t   IEC_DINT;
typedef int64_t   IEC_LINT;

typedef uint8_t    IEC_USINT;
typedef uint16_t   IEC_UINT;
typedef uint32_t   IEC_UDINT;
typedef uint64_t   IEC_ULINT;

typedef uint8_t    IEC_BYTE;
typedef uint16_t   IEC_WORD;
typedef uint32_t   IEC_DWORD;
typedef uint64_t   IEC_LWORD;

typedef float    IEC_REAL;
typedef double   IEC_LREAL;

`

const generateDefine = (variable: PLCVariable): string => {
  const name = variable.name
  const upperName = name.toUpperCase()

  if (isArrayVariable(variable)) {
    return `#define ${name} (vars->${upperName})\n`
  }
  return `#define ${name} (*(vars->${upperName}))\n`
}

const generateUndef = (variable: PLCVariable): string => {
  return `#undef ${variable.name}\n`
}

const processUserCode = (pou: CppPouData): string => {
  const structName = `${pou.name.toUpperCase()}_VARS`
  const setupFunctionName = `${pou.name.toLowerCase()}_setup`
  const loopFunctionName = `${pou.name.toLowerCase()}_loop`

  const inputVariables = pou.variables.filter((v) => v.class === 'input')
  const outputVariables = pou.variables.filter((v) => v.class === 'output')

  let processedCode = `//definition of external blocks - ${pou.name.toUpperCase()}\n`
  processedCode += `typedef struct {\n`

  inputVariables.forEach((variable) => {
    processedCode += generateStructMember(variable)
  })

  outputVariables.forEach((variable) => {
    processedCode += generateStructMember(variable)
  })

  processedCode += `} ${structName};\n\n`

  processedCode += `extern "C" void ${setupFunctionName}(${structName} *vars);\n`
  processedCode += `extern "C" void ${loopFunctionName}(${structName} *vars);\n\n`

  inputVariables.forEach((variable) => {
    processedCode += generateDefine(variable)
  })

  outputVariables.forEach((variable) => {
    processedCode += generateDefine(variable)
  })

  processedCode += '\n'

  let modifiedUserCode = pou.code

  modifiedUserCode = modifiedUserCode.replace(
    /void\s+setup\s*\(\s*\)/g,
    `void ${setupFunctionName}(${structName} *vars)`,
  )

  modifiedUserCode = modifiedUserCode.replace(/void\s+loop\s*\(\s*\)/g, `void ${loopFunctionName}(${structName} *vars)`)

  processedCode += modifiedUserCode
  processedCode += '\n'

  inputVariables.forEach((variable) => {
    processedCode += generateUndef(variable)
  })
  outputVariables.forEach((variable) => {
    processedCode += generateUndef(variable)
  })
  processedCode += '\n'

  return processedCode
}

/**
 * Generate the full c_blocks_code.cpp content (baseline + per-POU code).
 * Returns an empty string when there are no C++ POUs so the caller can
 * skip writing the file.
 */
const generateCBlocksCode = (cppPous: CppPouData[]): string => {
  if (cppPous.length === 0) return ''

  let codeContent = C_BLOCKS_BASELINE

  cppPous.forEach((pou) => {
    codeContent += processUserCode(pou)
  })

  return codeContent
}

export { type CppPouData, generateCBlocksCode }
