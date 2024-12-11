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
}) => {
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

  return `${pou.name} (\n\t${inputVariables.length > 0 ? inputVariables.join(',\n\t') + ',\n\t' : ''}${outputVariables.length > 0 ? outputVariables.join(',\n\t') + ',\n\t' : ''}${lastOutputVariable}\n);`
}
