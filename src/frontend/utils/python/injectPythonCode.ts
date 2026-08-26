import type { PLCVariable } from '../../../middleware/shared/ports/types'
import { pythonInboundVariables, pythonOutboundVariables } from './block-interface'
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
    const inputVariables = pythonInboundVariables(pou.variables)
    const outputVariables = pythonOutboundVariables(pou.variables)

    const fmtIn = encodeCharactersFromVariable(inputVariables)
    const fmtOut = encodeCharactersFromVariable(outputVariables)

    const injectedCode = injectPythonRuntime({
      fmtIn,
      fmtOut,
      inputVariables,
      outputVariables,
      originalCode: pou.code,
      pouName: pou.name,
    })

    return injectedCode
  })
}

export { injectPythonCode, type PythonPouData }
