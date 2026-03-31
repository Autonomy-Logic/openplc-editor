import { PLCVariable } from '@root/types/PLC/open-plc'
import { generateStructMember } from '@root/utils/PLC/array-codegen-helpers'

import { getExposedCppVariables } from './shared'

type CppPouData = {
  name: string
  variables: PLCVariable[]
}

const generateCBlocksHeader = (cppPous: CppPouData[]): string => {
  let headerContent = `#ifndef C_BLOCKS_H
#define C_BLOCKS_H

`

  cppPous.forEach((pou) => {
    const structName = `${pou.name.toUpperCase()}_VARS`
    const setupFunctionName = `${pou.name.toLowerCase()}_setup`
    const loopFunctionName = `${pou.name.toLowerCase()}_loop`

    const exposedVariables = getExposedCppVariables(pou.variables)

    headerContent += `//definition of external blocks - ${pou.name.toUpperCase()}\n`
    headerContent += `typedef struct {\n`

    exposedVariables.forEach((variable) => {
      headerContent += generateStructMember(variable)
    })

    headerContent += `} ${structName};\n`
    headerContent += `void ${setupFunctionName}(${structName} *vars);\n`
    headerContent += `void ${loopFunctionName}(${structName} *vars);\n\n`
  })

  headerContent += `#endif // C_BLOCKS_H\n`

  return headerContent
}

export { type CppPouData, generateCBlocksHeader }
