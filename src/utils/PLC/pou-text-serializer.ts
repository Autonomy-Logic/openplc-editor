import { PLCVariable as VariablePLC } from '@root/types/PLC'
import { PLCPou } from '@root/types/PLC/open-plc'

import { generateIecVariablesToString } from '../generate-iec-variables-to-string'
import { getEndKeyword, getStartKeyword } from './pou-file-extensions'

/**
 * Helper function to add documentation as IEC comment if it exists
 * @param documentation - The documentation string
 * @returns Formatted documentation comment or empty string
 */
const formatDocumentation = (documentation: string): string => {
  if (documentation && documentation.trim()) {
    return `(* ${documentation.trim()} *)\n\n`
  }
  return ''
}

/**
 * Serialize a textual POU (ST, IL) to IEC 61131-3 text format
 * @param pou - The POU to serialize
 * @returns The serialized text string
 */
export const serializeTextualPouToString = (pou: PLCPou): string => {
  const { type, data } = pou
  const { name, variables, body, documentation } = data

  if (body.language !== 'st' && body.language !== 'il') {
    throw new Error(`serializeTextualPouToString only supports ST and IL languages, got: ${body.language}`)
  }

  let result = formatDocumentation(documentation)

  const startKeyword = getStartKeyword(type)

  if (type === 'function' && 'returnType' in data) {
    result += `${startKeyword} ${name} : ${data.returnType}\n`
  } else {
    result += `${startKeyword} ${name}\n`
  }

  const variablesString = generateIecVariablesToString(variables as VariablePLC[])
  result += variablesString + '\n\n'

  result += body.value + '\n\n'

  const endKeyword = getEndKeyword(type)
  result += endKeyword

  return result
}

/**
 * Serialize a hybrid POU (Python, C++) to text format with IEC variable declarations
 * @param pou - The POU to serialize
 * @returns The serialized text string
 */
export const serializeHybridPouToString = (pou: PLCPou): string => {
  const { type, data } = pou
  const { name, variables, body, documentation } = data

  if (body.language !== 'python' && body.language !== 'cpp') {
    throw new Error(`serializeHybridPouToString only supports Python and C++ languages, got: ${body.language}`)
  }

  let result = formatDocumentation(documentation)

  const startKeyword = getStartKeyword(type)

  if (type === 'function' && 'returnType' in data) {
    result += `${startKeyword} ${name} : ${data.returnType}\n`
  } else {
    result += `${startKeyword} ${name}\n`
  }

  const variablesString = generateIecVariablesToString(variables as VariablePLC[])
  result += variablesString + '\n'

  result += body.value

  return result
}

/**
 * Serialize a graphical POU (LD, FBD) to text format with JSON body
 * @param pou - The POU to serialize
 * @returns The serialized text string
 */
export const serializeGraphicalPouToString = (pou: PLCPou): string => {
  const { type, data } = pou
  const { name, variables, body, documentation } = data

  if (body.language !== 'ld' && body.language !== 'fbd') {
    throw new Error(`serializeGraphicalPouToString only supports LD and FBD languages, got: ${body.language}`)
  }

  let result = formatDocumentation(documentation)

  const startKeyword = getStartKeyword(type)

  if (type === 'function' && 'returnType' in data) {
    result += `${startKeyword} ${name} : ${data.returnType}\n`
  } else {
    result += `${startKeyword} ${name}\n`
  }

  const variablesString = generateIecVariablesToString(variables as VariablePLC[])
  result += variablesString + '\n\n'

  result += JSON.stringify(body.value, null, 2) + '\n'

  const endKeyword = getEndKeyword(type)
  result += endKeyword

  return result
}

/**
 * Helper function to serialize a POU to text format based on its language
 * Routes to the appropriate serializer based on the POU's language type
 * @param pou - The POU to serialize
 * @returns The serialized text string
 */
export const serializePouToText = (pou: PLCPou): string => {
  const language = pou.data.body.language

  if (language === 'st' || language === 'il') {
    return serializeTextualPouToString(pou)
  } else if (language === 'python' || language === 'cpp') {
    return serializeHybridPouToString(pou)
  } else if (language === 'ld' || language === 'fbd') {
    return serializeGraphicalPouToString(pou)
  } else {
    throw new Error(`Unsupported language: ${language}`)
  }
}
