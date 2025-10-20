import { PLCVariable } from '@root/types/PLC/open-plc'

type CppPouData = {
  name: string
  code: string
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

const processUserCode = (pou: CppPouData): string => {
  const structName = `${pou.name.toUpperCase()}_VARS`
  const setupFunctionName = `${pou.name.toLowerCase()}_setup`
  const loopFunctionName = `${pou.name.toLowerCase()}_loop`

  const inputVariables = pou.variables.filter((v) => v.class === 'input')
  const outputVariables = pou.variables.filter((v) => v.class === 'output')

  let processedCode = `//definition of external blocks - ${pou.name.toUpperCase()}\n`
  processedCode += `typedef struct {\n`

  inputVariables.forEach((variable) => {
    const iecType = mapTypeToIEC(variable.type)
    processedCode += `  ${iecType} *${variable.name.toUpperCase()};\n`
  })

  outputVariables.forEach((variable) => {
    const iecType = mapTypeToIEC(variable.type)
    processedCode += `  ${iecType} *${variable.name.toUpperCase()};\n`
  })

  processedCode += `} ${structName};\n\n`

  processedCode += `extern "C" void ${setupFunctionName}(${structName} *vars);\n`
  processedCode += `extern "C" void ${loopFunctionName}(${structName} *vars);\n\n`

  inputVariables.forEach((variable) => {
    processedCode += `#define ${variable.name} (*(vars->${variable.name.toUpperCase()}))\n`
  })

  outputVariables.forEach((variable) => {
    processedCode += `#define ${variable.name} (*(vars->${variable.name.toUpperCase()}))\n`
  })

  processedCode += '\n'

  let modifiedUserCode = pou.code

  modifiedUserCode = modifiedUserCode.replace(
    /void\s+setup\s*\(\s*\)/g,
    `void ${setupFunctionName}(${structName} *vars)`,
  )

  modifiedUserCode = modifiedUserCode.replace(/void\s+loop\s*\(\s*\)/g, `void ${loopFunctionName}(${structName} *vars)`)

  processedCode += modifiedUserCode

  return processedCode
}

const generateCBlocksCode = (cppPous: CppPouData[]): string => {
  let codeContent = `#include <stdint.h>

#ifdef ARDUINO
#include <Arduino.h>
#endif

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
typedef struct {
    __strlen_t len;
    uint8_t body[STR_MAX_LEN];
} IEC_STRING;

`

  cppPous.forEach((pou) => {
    codeContent += processUserCode(pou)
    codeContent += '\n\n'
  })

  return codeContent
}

export { type CppPouData, generateCBlocksCode }
