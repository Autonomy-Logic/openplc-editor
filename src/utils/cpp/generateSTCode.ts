import { PLCVariable } from '@root/types/PLC/open-plc'
import { isArrayVariable } from '@root/utils/PLC/array-codegen-helpers'

type STCodeGenerationParams = {
  pouName: string
  allVariables: PLCVariable[]
}

const generateVariableAssignment = (variable: PLCVariable): string => {
  const name = variable.name.toUpperCase()
  if (isArrayVariable(variable)) {
    return `vars.${name} = data__->${name}.value.table;\n`
  }
  return `vars.${name} = &data__->${name}.value;\n`
}

const generateSTCode = (params: STCodeGenerationParams): string => {
  const { pouName, allVariables } = params

  const inputVariables = allVariables.filter((v) => v.class === 'input')
  const outputVariables = allVariables.filter((v) => v.class === 'output')

  const structName = `${pouName.toUpperCase()}_VARS`
  const setupFunctionName = `${pouName.toLowerCase()}_setup`
  const loopFunctionName = `${pouName.toLowerCase()}_loop`

  let variableAssignments = ''

  inputVariables.forEach((variable) => {
    variableAssignments += generateVariableAssignment(variable)
  })

  outputVariables.forEach((variable) => {
    variableAssignments += generateVariableAssignment(variable)
  })

  const stCode = `{{
${structName} vars;
${variableAssignments}}}
if hasBeenInitialized = False then
{{
${setupFunctionName}(&vars);
}}
hasBeenInitialized := True;
end_if;
{{
${loopFunctionName}(&vars);
}}`

  return stCode
}

export { generateSTCode, type STCodeGenerationParams }
