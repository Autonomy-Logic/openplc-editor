import { PLCVariable } from '@root/types/PLC'

const classToVarBlock: Record<string, string> = {
  local: 'VAR',
  input: 'VAR_INPUT',
  output: 'VAR_OUTPUT',
  inout: 'VAR_IN_OUT',
  external: 'VAR_EXTERNAL',
  global: 'VAR_GLOBAL',
  temp: 'VAR_TEMP',
}

export const generateIecVariablesToString = (variables: PLCVariable[]): string => {
  if (!variables || variables.length === 0) {
    return '(* No variables declared. *)'
  }

  const groupedVariables = variables.reduce(
    (acc, variable) => {
      const key = (variable.class ?? 'global').toLowerCase()

      if (!acc[key]) {
        acc[key] = []
      }
      acc[key].push(variable)
      return acc
    },
    {} as Record<string, PLCVariable[]>,
  )

  let textualDeclaration = ''
  const orderedGroups = ['global', 'external', 'input', 'output', 'inout', 'local', 'temp']

  orderedGroups.forEach((groupName) => {
    if (groupedVariables[groupName]) {
      const blockHeader = classToVarBlock[groupName]
      textualDeclaration += `${blockHeader}\n`

      groupedVariables[groupName].forEach((v) => {
        let line = `\t${v.name}`

        if (v.location) {
          line += ` AT ${v.location}`
        }

        line += ` : ${v.type.value}`

        if (v.initialValue) {
          line += ` := ${v.initialValue}`
        }

        line += ';'

        if (v.documentation) {
          const singleLineDoc = v.documentation.replace(/(\r\n|\n|\r)/gm, ' ').trim()
          if (singleLineDoc) {
            line += ` (* ${singleLineDoc} *)`
          }
        }

        textualDeclaration += line + '\n'
      })

      textualDeclaration += `END_VAR\n\n`
    }
  })

  return textualDeclaration.trim()
}
