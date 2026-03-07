import { PLCVariable } from '@root/types/PLC/open-plc'
import {
  getArrayStartIndex,
  getArrayTotalElements,
  getVariableIECType,
  isArrayVariable,
} from '@root/utils/PLC/array-codegen-helpers'

type STCodeGenerationParams = {
  pouName: string
  allVariables: PLCVariable[]
}

/**
 * Generate flat temporary array declarations for array variables.
 * iec2c wraps each element in __IEC_TYPE_t (value + flags), so we need
 * flat IEC_TYPE arrays for C code that expects contiguous typed elements.
 */
const generateFlatArrayDeclarations = (arrayVariables: PLCVariable[]): string => {
  let code = ''
  arrayVariables.forEach((variable) => {
    const name = variable.name.toUpperCase()
    const iecType = getVariableIECType(variable)
    const totalElements = getArrayTotalElements(variable)
    code += `${iecType} __flat_${name}[${totalElements}];\n`
  })
  return code
}

/**
 * Generate code to copy .value from each wrapped table element into the flat array.
 */
const generateFlatArrayCopiesIn = (arrayVariables: PLCVariable[]): string => {
  let code = ''
  arrayVariables.forEach((variable) => {
    const name = variable.name.toUpperCase()
    const totalElements = getArrayTotalElements(variable)
    code += `for (int __i = 0; __i < ${totalElements}; __i++) __flat_${name}[__i] = data__->${name}.value.table[__i].value;\n`
  })
  return code
}

/**
 * Generate pointer assignment for a variable into the vars struct.
 * For arrays, points to the flat temporary array with start index offset.
 * For scalars, points to the wrapped value directly.
 */
const generateVariableAssignment = (variable: PLCVariable): string => {
  const name = variable.name.toUpperCase()
  if (isArrayVariable(variable)) {
    const startIndex = getArrayStartIndex(variable)
    return `vars.${name} = __flat_${name} - ${startIndex};\n`
  }
  return `vars.${name} = &data__->${name}.value;\n`
}

/**
 * Generate code to copy output array values back from flat arrays to wrapped table elements.
 */
const generateOutputArrayCopyBack = (outputVariables: PLCVariable[]): string => {
  let code = ''
  outputVariables.forEach((variable) => {
    if (isArrayVariable(variable)) {
      const name = variable.name.toUpperCase()
      const totalElements = getArrayTotalElements(variable)
      code += `for (int __i = 0; __i < ${totalElements}; __i++) data__->${name}.value.table[__i].value = __flat_${name}[__i];\n`
    }
  })
  return code
}

const generateSTCode = (params: STCodeGenerationParams): string => {
  const { pouName, allVariables } = params

  const inputVariables = allVariables.filter((v) => v.class === 'input')
  const outputVariables = allVariables.filter((v) => v.class === 'output')

  const structName = `${pouName.toUpperCase()}_VARS`
  const setupFunctionName = `${pouName.toLowerCase()}_setup`
  const loopFunctionName = `${pouName.toLowerCase()}_loop`

  const allArrayVariables = [...inputVariables, ...outputVariables].filter(isArrayVariable)

  const flatArrayDecl = generateFlatArrayDeclarations(allArrayVariables)
  const flatArrayCopiesIn = generateFlatArrayCopiesIn(allArrayVariables)

  let variableAssignments = ''
  inputVariables.forEach((variable) => {
    variableAssignments += generateVariableAssignment(variable)
  })
  outputVariables.forEach((variable) => {
    variableAssignments += generateVariableAssignment(variable)
  })

  const outputCopyBack = generateOutputArrayCopyBack(outputVariables)

  let stCode = `{{
${structName} vars;
${flatArrayDecl}${flatArrayCopiesIn}${variableAssignments}}}
if hasBeenInitialized = False then
{{
${setupFunctionName}(&vars);
}}
hasBeenInitialized := True;
end_if;
{{
${loopFunctionName}(&vars);
}}`

  if (outputCopyBack) {
    stCode += `\n{{
${outputCopyBack}}}`
  }

  return stCode
}

export { generateSTCode, type STCodeGenerationParams }
