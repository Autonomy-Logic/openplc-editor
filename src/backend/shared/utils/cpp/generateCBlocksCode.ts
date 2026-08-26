import { cBlockExternalVariables, cBlockInterfaceVariables } from '../../../../frontend/utils/cpp/block-interface'
import { isArrayVariable } from '../../../../frontend/utils/PLC/array-codegen-helpers'
import type { PLCVariable } from '../../../../middleware/shared/ports/types'

type CppPouData = {
  name: string
  code: string
  variables: PLCVariable[]
}

/**
 * Baseline preamble for c_blocks_code.cpp. Carries:
 *
 *   - `c_blocks.h`, which defines the interface struct for every C++ POU in the
 *     project and declares the two entry points this file goes on to define.
 *     It is included rather than restated: the POU glue includes the same
 *     header, so the two sides describe one struct and cannot drift apart.
 *     Through it comes `generated.hpp` — the strucpp runtime wrappers plus this
 *     project's own structures, enumerations and function block classes — so a
 *     C block can name every type the Variables Table can declare, and force
 *     semantics flow through `IECVar::operator=` on every user write.
 *
 *   - File-scope raw numeric typedefs (`IEC_BOOL` / `IEC_INT` / `IEC_REAL` /
 *     etc.) preserved from the MatIEC era. These exist ONLY for the user's
 *     *local* variables inside `setup()` / `loop()` (e.g. `IEC_INT my_temp =
 *     0;`). They never collide with the struct fields because those fully
 *     qualify as `strucpp::IEC_*`.
 *
 *   - No raw `IEC_STRING` / `IEC_WSTRING` typedef. STRING pins use the strucpp
 *     wrapper end-to-end (`strucpp::IEC_STRING = IECStringVar<254>`), so user
 *     code interacts with them via `name = "hello";` / `name.length()` /
 *     `name[i]` / `name.c_str()` / `name == "stop"` — the same surface every
 *     other pin already exposes. A local STRING inside setup() / loop() can be
 *     declared `strucpp::IEC_STRING my_buf;` too.
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

// The C block interface — the \`<POU>_VARS\` struct for every C++ POU in this
// project, and the \`extern "C"\` declarations of the setup/loop entry points
// defined below.  Declared once, in c_blocks.h, and included rather than
// restated here: the POU glue strucpp emits includes the same header, so the
// two sides cannot describe the struct differently.
//
// It transitively carries \`generated.hpp\` — the strucpp runtime wrappers plus
// this project's own structures, enumerations and function block classes — so a
// C block can name every type the Variables Table can declare.
//
// This TU is pre-compiled with the board's toolchain at -std=gnu++17 into
// libOpenPLCUserLib.a, on the same side of the isolation seam as the rest of
// the generated code, so the header's C++17 surface is available here. The
// arduino-cli pass compiles the core in its own (older) standard and never
// sees this file.
#include "c_blocks.h"

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

/**
 * Bring the project's own type names into the C block's scope.
 *
 * The generated declarations live in `namespace strucpp`, so without this a
 * user has to write `strucpp::Motor` / `(strucpp::Mode)` in their own block —
 * the namespace is an implementation detail of the toolchain leaking into code
 * that is supposed to look like ordinary C++ against the Variables Table.
 *
 * A blanket `using namespace strucpp;` is not an option: the baseline defines
 * raw `IEC_BOOL` / `IEC_INT` / … typedefs at file scope for the user's local
 * variables, and strucpp declares the same names as `IECVar<T>` wrappers, so
 * every one of them would become ambiguous. Aliasing only the names this
 * project actually defines keeps the natural spelling without that collision.
 *
 * The bare strucpp name is the right target for both shapes: `strucpp::MOTOR`
 * is the structure itself and `strucpp::MODE` the enumeration, which is what a
 * user casts to. The `IEC_`-prefixed aliases stay reserved for pin types in the
 * generated struct.
 */
const generateUserTypeAliases = (cppPous: CppPouData[]): string => {
  const referenced = new Set<string>()
  for (const pou of cppPous) {
    for (const variable of pou.variables) {
      if (variable.type.definition === 'user-data-type') {
        referenced.add(variable.type.value.toUpperCase())
      }
      if (variable.type.definition === 'array' && variable.type.data?.baseType.definition === 'user-data-type') {
        referenced.add(variable.type.data.baseType.value.toUpperCase())
      }
    }
  }
  if (referenced.size === 0) return ''

  let code = "// Project types, reachable without the toolchain's namespace\n"
  for (const name of Array.from(referenced).sort()) {
    code += `using ${name} = strucpp::${name};\n`
  }
  return code + '\n'
}

const processUserCode = (pou: CppPouData): string => {
  const structName = `${pou.name.toUpperCase()}_VARS`
  const setupFunctionName = `${pou.name.toLowerCase()}_setup`
  const loopFunctionName = `${pou.name.toLowerCase()}_loop`

  const interfaceVariables = [...cBlockInterfaceVariables(pou.variables), ...cBlockExternalVariables(pou.variables)]

  // The struct and the two entry-point declarations come from c_blocks.h, which
  // the baseline includes. Only the name-binding macros and the user's own body
  // are emitted here.
  let processedCode = `// ${pou.name.toUpperCase()} — Variables Table names bound to the interface struct\n`

  interfaceVariables.forEach((variable) => {
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

  interfaceVariables.forEach((variable) => {
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
  codeContent += generateUserTypeAliases(cppPous)

  cppPous.forEach((pou) => {
    codeContent += processUserCode(pou)
  })

  return codeContent
}

export { type CppPouData, generateCBlocksCode }
