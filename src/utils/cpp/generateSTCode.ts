import { PLCVariable } from '@root/types/PLC/open-plc'

type STCodeGenerationParams = {
  pouName: string
  allVariables: PLCVariable[]
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
    variableAssignments += `vars.${variable.name.toUpperCase()} = &data__->${variable.name.toUpperCase()}.value;\n`
  })

  outputVariables.forEach((variable) => {
    variableAssignments += `vars.${variable.name.toUpperCase()} = &data__->${variable.name.toUpperCase()}.value;\n`
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
