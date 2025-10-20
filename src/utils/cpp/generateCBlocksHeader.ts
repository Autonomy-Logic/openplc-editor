import { PLCVariable } from '@root/types/PLC/open-plc'

type CppPouData = {
  name: string
  variables: PLCVariable[]
}

const mapTypeToIEC = (type: PLCVariable['type']): string => {
  if (type.definition === 'base-type') {
    const typeMap: Record<string, string> = {
      bool: 'IEC_BOOL',
      sint: 'IEC_SINT',
      int: 'IEC_INT',
      dint: 'IEC_DINT',
      lint: 'IEC_LINT',
      usint: 'IEC_USINT',
      uint: 'IEC_UINT',
      udint: 'IEC_UDINT',
      ulint: 'IEC_ULINT',
      byte: 'IEC_BYTE',
      word: 'IEC_WORD',
      dword: 'IEC_DWORD',
      lword: 'IEC_LWORD',
      real: 'IEC_REAL',
      lreal: 'IEC_LREAL',
      string: 'IEC_STRING',
    }
    return typeMap[type.value] || type.value.toUpperCase()
  }
  return type.value
}

const generateCBlocksHeader = (cppPous: CppPouData[]): string => {
  let headerContent = `#ifndef C_BLOCKS_H
#define C_BLOCKS_H

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
      const iecType = mapTypeToIEC(variable.type)
      headerContent += `  ${iecType} *${variable.name.toUpperCase()};\n`
    })

    outputVariables.forEach((variable) => {
      const iecType = mapTypeToIEC(variable.type)
      headerContent += `  ${iecType} *${variable.name.toUpperCase()};\n`
    })

    headerContent += `} ${structName};\n`
    headerContent += `void ${setupFunctionName}(${structName} *vars);\n`
    headerContent += `void ${loopFunctionName}(${structName} *vars);\n\n`
  })

  headerContent += `#endif // C_BLOCKS_H\n`

  return headerContent
}

export { type CppPouData, generateCBlocksHeader }
