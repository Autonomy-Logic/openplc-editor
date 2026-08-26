import type { PLCDataType, PLCPou, PLCVariable } from '../../../middleware/shared/ports/types'
import type { LibraryFunctionBlockSource } from '../PLC/function-block-pins'
import { pythonInboundVariables, pythonOutboundVariables } from './block-interface'
import { encodeCharactersFromVariable } from './encodeCharactersFromVariable'
import { injectPythonRuntime } from './injectPythonRuntime'
import type { ShmWalkContext } from './shm-leaves'

type PythonPouData = {
  name: string
  code: string
  type: string
  documentation?: string
  variables: PLCVariable[]
}

const injectPythonCode = (
  pythonPous: PythonPouData[],
  dataTypes: readonly PLCDataType[] = [],
  pous: readonly PLCPou[] = [],
  libraries: readonly LibraryFunctionBlockSource[] = [],
): string[] => {
  return pythonPous.map((pou) => {
    const inputVariables = pythonInboundVariables(pou.variables)
    const outputVariables = pythonOutboundVariables(pou.variables)

    // Direction decides which of a function block instance's pins cross: the
    // block drives its inputs and reads its outputs. Both contexts otherwise
    // describe the same project.
    const inbound: ShmWalkContext = { dataTypes, pous, libraries, direction: 'in' }
    const outbound: ShmWalkContext = { dataTypes, pous, libraries, direction: 'out' }

    const fmtIn = encodeCharactersFromVariable(inputVariables, inbound)
    const fmtOut = encodeCharactersFromVariable(outputVariables, outbound)

    const injectedCode = injectPythonRuntime({
      fmtIn,
      fmtOut,
      inputVariables,
      outputVariables,
      originalCode: pou.code,
      pouName: pou.name,
      inbound,
      outbound,
    })

    return injectedCode
  })
}

export { injectPythonCode, type PythonPouData }
