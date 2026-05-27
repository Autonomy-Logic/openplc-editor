import type { PLCVariable } from '../../middleware/shared/ports/types'

const classToVarBlock: Record<string, string> = {
  local: 'VAR',
  input: 'VAR_INPUT',
  output: 'VAR_OUTPUT',
  inout: 'VAR_IN_OUT',
  external: 'VAR_EXTERNAL',
  global: 'VAR_GLOBAL',
  temp: 'VAR_TEMP',
}

// Indentation mirrors xml2st's `PLCGenerator.PouProgramGenerator.GenerateProgram`
// output (see `~/Documents/Code/xml2st/PLCGenerator.py:2414-2478`): two
// spaces before the var-block keywords, four spaces before each
// declaration line.  Matching that format keeps the editor's
// variables-text view byte-identical to the per-POU `.st` file the
// strucpp pipeline actually compiles — otherwise the user sees one
// thing in the UI and the compiler sees another, and round-trips
// through "view text → compile → click error" surface as cosmetic
// noise and as the off-by-one body-line crash that motivated this
// fix.
const VAR_BLOCK_INDENT = '  '
const VAR_DECL_INDENT = '    '

export const generateIecVariablesToString = (variables: PLCVariable[]): string => {
  if (!variables || variables.length === 0) {
    return `${VAR_BLOCK_INDENT}VAR\n${VAR_BLOCK_INDENT}END_VAR`
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
      textualDeclaration += `${VAR_BLOCK_INDENT}${blockHeader}\n`

      groupedVariables[groupName].forEach((v) => {
        let line = `${VAR_DECL_INDENT}${v.name} : ${v.type.value}`

        if (v.location) {
          line += ` AT ${v.location}`
        }

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

      // xml2st emits consecutive var-class blocks back-to-back with no
      // blank line between them — `  END_VAR\n  VAR_INPUT\n...`.  Drop
      // the prior `END_VAR\n\n` that left a separator behind.
      textualDeclaration += `${VAR_BLOCK_INDENT}END_VAR\n`
    }
  })

  return textualDeclaration.trimEnd()
}
