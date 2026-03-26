import type { PLCPou } from '../../../middleware/shared/ports/types'
import { generateIecVariablesToString } from '../generate-iec-variables-to-string'
import { getEndKeyword, getStartKeyword } from './pou-file-extensions'

/** PLCPou extended with optional variablesText from code-mode editing */
type SerializablePou = PLCPou & { variablesText?: string }

const formatDocumentation = (documentation: string | undefined): string => {
  if (documentation && documentation.trim()) {
    return `(* ${documentation.trim()} *)\n\n`
  }
  return ''
}

const buildDeclaration = (pou: SerializablePou): string => {
  const startKeyword = getStartKeyword(pou.pouType)
  if (pou.pouType === 'function' && pou.interface?.returnType) {
    return `${startKeyword} ${pou.name} : ${pou.interface.returnType}\n`
  }
  return `${startKeyword} ${pou.name}\n`
}

const buildVariables = (pou: SerializablePou): string => {
  if (pou.variablesText != null) return pou.variablesText
  const variables = pou.interface?.variables ?? []
  return generateIecVariablesToString(variables)
}

export const serializeTextualPouToString = (pou: SerializablePou): string => {
  if (pou.body.language !== 'st' && pou.body.language !== 'il') {
    throw new Error(`serializeTextualPouToString only supports ST and IL languages, got: ${pou.body.language}`)
  }

  let result = formatDocumentation(pou.documentation)
  result += buildDeclaration(pou)
  result += buildVariables(pou) + '\n\n'
  result += pou.body.value + '\n\n'
  result += getEndKeyword(pou.pouType)

  return result
}

export const serializeHybridPouToString = (pou: SerializablePou): string => {
  if (pou.body.language !== 'python' && pou.body.language !== 'cpp') {
    throw new Error(`serializeHybridPouToString only supports Python and C++ languages, got: ${pou.body.language}`)
  }

  let result = formatDocumentation(pou.documentation)
  result += buildDeclaration(pou)
  result += buildVariables(pou) + '\n'
  result += pou.body.value + '\n\n'
  result += getEndKeyword(pou.pouType)

  return result
}

export const serializeGraphicalPouToString = (pou: SerializablePou): string => {
  if (pou.body.language !== 'ld' && pou.body.language !== 'fbd') {
    throw new Error(`serializeGraphicalPouToString only supports LD and FBD languages, got: ${pou.body.language}`)
  }

  let result = formatDocumentation(pou.documentation)
  result += buildDeclaration(pou)
  result += buildVariables(pou) + '\n\n'
  result += JSON.stringify(pou.body.value, null, 2) + '\n'
  result += getEndKeyword(pou.pouType)

  return result
}

export const serializePouToText = (pou: SerializablePou): string => {
  const language = pou.body.language

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
