import { PLCVariable } from '@root/types/PLC/open-plc'
import { getVariableIECType, isArrayVariable } from '@root/utils/PLC/array-codegen-helpers'

type CppPouData = {
  name: string
  code: string
  variables: PLCVariable[]
}

const generateStructMember = (variable: PLCVariable): string => {
  const iecType = getVariableIECType(variable)
  const name = variable.name.toUpperCase()
  // Both scalars and arrays use pointers:
  // - Scalars: pointer to the single value
  // - Arrays: pointer to the first element of the table
  return `  ${iecType} *${name};\n`
}

const generateDefine = (variable: PLCVariable): string => {
  const name = variable.name
  const upperName = name.toUpperCase()

  if (isArrayVariable(variable)) {
    return `#define ${name} (vars->${upperName})\n`
  }
  return `#define ${name} (*(vars->${upperName}))\n`
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

  return processedCode
}

const generateCBlocksCode = (cppPous: CppPouData[]): string => {
  let codeContent = ''

  cppPous.forEach((pou) => {
    codeContent += processUserCode(pou)
  })

  return codeContent
}

export { type CppPouData, generateCBlocksCode }
