export const parsePouToStText = (pou: {
  name: string
  language: string
  type: string
  body: string
  documentation: string
  variables: {
    name: string
    class: string
    type: { definition: string; value: string }
  }[]
}, variableName?: string) => {
  const inputVariables = pou.variables
    .filter((variable) => variable.class === 'input')
    .map((variable) => {
      return `${variable.name} := (*${variable.type.value}*)`
    })
  const outputVariables = pou.variables
    .filter((variable) => variable.class === 'output')
    .map((variable) => {
      return `${variable.name} => (*${variable.type.value}*)`
    })
  const lastOutputVariable = outputVariables.pop()

  return `\n${variableName ? variableName : pou.name} (\n${inputVariables.length > 0 ? '    ' + inputVariables.join(',\n    ') + ',\n' : ''}${outputVariables.length > 0 ? '    ' + outputVariables.join(',\n    ') + ',\n' : ''}    ${lastOutputVariable}\n);`
}
