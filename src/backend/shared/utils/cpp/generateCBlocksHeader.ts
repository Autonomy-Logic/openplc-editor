import { generateStructMember } from '../../../../frontend/utils/PLC/array-codegen-helpers'
import type { PLCVariable } from '../../../../middleware/shared/ports/types'

type CppPouData = {
  name: string
  variables: PLCVariable[]
}

const generateCBlocksHeader = (cppPous: CppPouData[]): string => {
  let headerContent = `#ifndef C_BLOCKS_H
#define C_BLOCKS_H

// The user-visible struct fields are fully qualified as
// \`strucpp::IEC_*\` (numeric, bit-string, STRING, WSTRING — every pin
// is an \`IECVar<T>\` / \`IECStringVar<N>\` wrapper).  Pull the runtime
// headers in here so any TU that includes this header gets the
// wrappers in scope without depending on include order.
#include "iec_var.hpp"
#include "iec_string.hpp"

`

  cppPous.forEach((pou) => {
    const structName = `${pou.name.toUpperCase()}_VARS`
    const setupFunctionName = `${pou.name.toLowerCase()}_setup`
    const loopFunctionName = `${pou.name.toLowerCase()}_loop`

    const inputVariables = pou.variables.filter((v) => v.class === 'input')
    const outputVariables = pou.variables.filter((v) => v.class === 'output')

    headerContent += `//definition of external blocks - ${pou.name.toUpperCase()}\n`
    headerContent += `typedef struct {\n`

    inputVariables.forEach((variable) => {
      headerContent += generateStructMember(variable)
    })

    outputVariables.forEach((variable) => {
      headerContent += generateStructMember(variable)
    })

    headerContent += `} ${structName};\n`
    // c_blocks_code.cpp defines these with `extern "C"` so the user's
    // setup()/loop() bodies link unmangled. The header has to match —
    // without `extern "C"` here, the per-POU call sites mangle the
    // symbol and the dynamic loader fails with `undefined symbol:
    // _Z<N><name>P<N><STRUCT>_VARS`.
    headerContent += `extern "C" void ${setupFunctionName}(${structName} *vars);\n`
    headerContent += `extern "C" void ${loopFunctionName}(${structName} *vars);\n\n`
  })

  headerContent += `#endif // C_BLOCKS_H\n`

  return headerContent
}

export { type CppPouData, generateCBlocksHeader }
