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
 *   - The strucpp runtime includes so the auto-generated struct fields
 *     (`strucpp::IEC_INT*` etc., emitted by `generateStructMember`)
 *     resolve to IECVar wrappers. Force semantics flow through
 *     `IECVar::operator=` on the user's writes.
 *
 *   - File-scope raw IEC_BOOL/INT/.../REAL typedefs preserved from the
 *     MatIEC era. These exist only for the user's *local* variables in
 *     setup() / loop() (e.g. `IEC_INT my_temp = 0;`). They never collide
 *     with the auto-generated struct because that uses `strucpp::IEC_*`.
 *
 *   - Raw `IEC_STRING` / `IEC_WSTRING` structs (`{ len; body[]; }`)
 *     used by the auto-generated struct AND by the user's c_blocks
 *     code via `name.len` / `name.body[i]`. The C++ stub copies these
 *     in/out of strucpp's IECStringVar at scan boundaries.
 */
const C_BLOCKS_BASELINE = `#include <cstdint>
#include <cstring>

#ifdef ARDUINO
#include <Arduino.h>
#endif

// STruC++ runtime types — IECVar<T> wrappers under namespace strucpp.
// The auto-generated POU struct refers to them as \`strucpp::IEC_*\`,
// keeping force-aware semantics on the user's writes via operator=.
#include "iec_var.hpp"
#include "iec_string.hpp"

/*********************/
/*  IEC Types defs   */
/*********************/

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

#ifndef STR_MAX_LEN
#define STR_MAX_LEN 126
#endif

#ifndef STR_LEN_TYPE
#define STR_LEN_TYPE int8_t
#endif

typedef STR_LEN_TYPE __strlen_t;
// Raw STRING/WSTRING layout used by both the auto-generated POU
// struct and the user's c_blocks code. The C++ stub copies between
// this raw struct and strucpp::IECStringVar at the scan boundary.
typedef struct {
    __strlen_t len;
    uint8_t body[STR_MAX_LEN];
} IEC_STRING;
typedef IEC_STRING IEC_WSTRING;

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
