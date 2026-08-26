import { cBlockInterfaceVariables } from '../../../../frontend/utils/cpp/block-interface'
import { generateStructMember } from '../../../../frontend/utils/PLC/array-codegen-helpers'
import type { PLCVariable } from '../../../../middleware/shared/ports/types'

type CppPouData = {
  name: string
  variables: PLCVariable[]
}

/**
 * The one place a C block's interface struct is written.
 *
 * `c_blocks_code.cpp` used to re-emit the same `<POU>_VARS` typedef from its own
 * call into `generateStructMember`, so the project carried two independent
 * spellings of one fact. They agreed only for as long as both call sites were
 * edited together, and the moment a type needed more than a name lookup — an
 * enumeration is `strucpp::IEC_MODE` in the struct but a structure is
 * `strucpp::MOTOR` — they diverged, producing two conflicting definitions of the
 * same typedef and a compile error at the assignment in the POU glue.
 *
 * Now the header is the definition and `c_blocks_code.cpp` includes it. Drift is
 * not a bug that can be reintroduced: there is nothing left to disagree with.
 */
const generateCBlocksHeader = (cppPous: CppPouData[], userTypeNames: Iterable<string> = []): string => {
  const typeNames: ReadonlySet<string> = new Set(Array.from(userTypeNames, (name) => name.toUpperCase()))

  let headerContent = `#ifndef C_BLOCKS_H
#define C_BLOCKS_H

// The project's own generated declarations. Every struct field below is a
// strucpp type: an \`IECVar<T>\` / \`IECStringVar<N>\` wrapper for an elementary
// pin, and for a user-defined type the structure, enumeration or function block
// class the project declares. \`generated.hpp\` carries all of them, and pulls in
// the runtime headers transitively, so any translation unit that includes this
// header gets the whole surface regardless of include order.
//
// Every translation unit that includes this header is built at -std=gnu++17,
// which is what \`generated.hpp\` needs. On a Runtime v4 or Arduino target the
// POU glue and \`c_blocks_code.cpp\` are pre-compiled from
// \`precompile/sources/\` with the board's toolchain at that standard; on the
// baremetal/simulator path the flag is appended to the arduino-cli invocation
// so the sketch-side copy of \`c_blocks_code.cpp\` compiles identically. Only
// the core itself is left on whatever standard it ships with, and the core
// never includes this header.
#include "generated.hpp"

`

  cppPous.forEach((pou) => {
    const structName = `${pou.name.toUpperCase()}_VARS`
    const setupFunctionName = `${pou.name.toLowerCase()}_setup`
    const loopFunctionName = `${pou.name.toLowerCase()}_loop`

    headerContent += `//definition of external blocks - ${pou.name.toUpperCase()}\n`
    headerContent += `typedef struct {\n`

    cBlockInterfaceVariables(pou.variables).forEach((variable) => {
      headerContent += generateStructMember(variable, typeNames)
    })

    headerContent += `} ${structName};\n`
    // The user's setup()/loop() bodies are defined with `extern "C"` in
    // c_blocks_code.cpp so they link unmangled. The declarations here have to
    // match — without `extern "C"` the per-POU call sites mangle the symbol and
    // the dynamic loader fails with `undefined symbol:
    // _Z<N><name>P<N><STRUCT>_VARS`.
    headerContent += `extern "C" void ${setupFunctionName}(${structName} *vars);\n`
    headerContent += `extern "C" void ${loopFunctionName}(${structName} *vars);\n\n`
  })

  headerContent += `#endif // C_BLOCKS_H\n`

  return headerContent
}

export { type CppPouData, generateCBlocksHeader }
