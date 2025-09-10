import { PLCVariable } from '@root/types/PLC/open-plc'

import { encodeCharactersFromVariable } from './encodeCharactersFromVariable'
import { injectPythonRuntime } from './injectPythonRuntime'

type PythonPouData = {
  name: string
  code: string
  type: string
  documentation?: string
  variables: PLCVariable[]
}

const injectPythonCode = (pythonPous: PythonPouData[]): string[] => {
  return pythonPous.map((pou) => {
    const inputVariables = pou.variables.filter((v) => v.class === 'input')
    const outputVariables = pou.variables.filter((v) => v.class === 'output')

    const fmtIn = encodeCharactersFromVariable(inputVariables)
    const fmtOut = encodeCharactersFromVariable(outputVariables)

    console.log(`POU "${pou.name}" format string: fmtIn = ('${fmtIn}'), fmtOut = ('${fmtOut}')`)

    const injectedCode = injectPythonRuntime({
      fmtIn,
      fmtOut,
      inputVariables,
      outputVariables,
      originalCode: pou.code,
      pouName: pou.name,
    })

    console.log(injectedCode)

    return injectedCode
  })
}

export { injectPythonCode, type PythonPouData }
