import type { PLCPou, PouType } from '../../../middleware/shared/ports/types'
import { parseIecStringToVariables } from '../generate-iec-string-to-variables'

/**
 * Helper function to extract documentation from leading comments
 * @param content - The content to extract documentation from
 * @returns Object with documentation and remaining content
 */
const extractDocumentation = (content: string): { documentation: string; remainingContent: string } => {
  const docMatch = content.match(/^\s*\(\*\s*(.*?)\s*\*\)\s*\n/s)
  if (docMatch) {
    return {
      documentation: docMatch[1].trim(),
      remainingContent: content.slice(docMatch[0].length),
    }
  }
  return {
    documentation: '',
    remainingContent: content,
  }
}

/**
 * Helper function to provide clear error messages with line numbers
 * @param message - The error message
 * @param lineNumber - Optional line number where the error occurred
 * @returns Formatted error message
 */
const formatParseError = (message: string, lineNumber?: number): string => {
  if (lineNumber !== undefined) {
    return `Parse error on line ${lineNumber}: ${message}`
  }
  return `Parse error: ${message}`
}

/**
 * Helper function to find the last END_VAR in the content
 * @param content - The content to search
 * @param startIndex - The index to start searching from
 * @returns The index after the last END_VAR, or -1 if not found
 */
const findLastEndVarIndex = (content: string, startIndex: number): number => {
  let lastEndVarIndex = -1
  let searchIndex = startIndex

  let endVarMatch = content.slice(searchIndex).match(/\bEND_VAR\b/i)
  while (endVarMatch && endVarMatch.index !== undefined) {
    lastEndVarIndex = searchIndex + endVarMatch.index + endVarMatch[0].length
    searchIndex = lastEndVarIndex
    endVarMatch = content.slice(searchIndex).match(/\bEND_VAR\b/i)
  }

  return lastEndVarIndex
}

/**
 * Parse a textual POU (ST, IL) from string to PLCPou object
 * @param content - The text content to parse
 * @param language - The language code (st, il)
 * @param type - The POU type (program, function, function-block)
 * @returns Parsed PLCPou object
 * @throws Error if parsing fails
 */
export const parseTextualPouFromString = (content: string, language: string, type: string): PLCPou => {
  try {
    const { documentation, remainingContent } = extractDocumentation(content)

    const pouTypeKeywords = {
      program: 'PROGRAM',
      function: 'FUNCTION',
      'function-block': 'FUNCTION_BLOCK',
    }

    const typeKeyword = pouTypeKeywords[type as keyof typeof pouTypeKeywords]
    if (!typeKeyword) {
      throw new Error(formatParseError(`Unsupported POU type: ${type}`))
    }

    const declarationRegex = new RegExp(`^\\s*(${typeKeyword})\\s+(\\w+)(?:\\s*:\\s*(\\w+))?`, 'i')
    const declarationMatch = remainingContent.match(declarationRegex)

    if (!declarationMatch) {
      throw new Error(formatParseError(`Could not find ${typeKeyword} declaration`))
    }

    const pouName = declarationMatch[2]
    const returnType = declarationMatch[3] // Only present for functions

    if (type === 'function' && !returnType) {
      throw new Error(formatParseError(`Function ${pouName} must have a return type`))
    }

    const varStartIndex = remainingContent.search(
      /\b(VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT|VAR_EXTERNAL|VAR_TEMP|VAR_GLOBAL|VAR)\b/i,
    )

    let variablesString = ''
    let bodyStartIndex = declarationMatch[0].length

    if (varStartIndex !== -1) {
      const varSectionStart = varStartIndex
      const lastEndVarIndex = findLastEndVarIndex(remainingContent, varSectionStart)

      if (lastEndVarIndex !== -1) {
        variablesString = remainingContent.slice(varSectionStart, lastEndVarIndex)
        bodyStartIndex = lastEndVarIndex
      }
    }

    const variables = variablesString.trim()
      ? parseIecStringToVariables(variablesString).map((v) => ({ ...v, debug: false }))
      : []

    const endKeywords = {
      program: 'END_PROGRAM',
      function: 'END_FUNCTION',
      'function-block': 'END_FUNCTION_BLOCK',
    }

    const endKeyword = endKeywords[type as keyof typeof endKeywords]
    const endKeywordRegex = new RegExp(`\\b${endKeyword}\\b`, 'i')
    const endMatch = remainingContent.slice(bodyStartIndex).search(endKeywordRegex)

    if (endMatch === -1) {
      throw new Error(formatParseError(`Could not find ${endKeyword}`))
    }

    const bodyContent = remainingContent.slice(bodyStartIndex, bodyStartIndex + endMatch).trim()

    return {
      name: pouName,
      pouType: type as PouType,
      interface: {
        ...(type === 'function' ? { returnType: returnType || '' } : {}),
        variables,
      },
      body: {
        language: language as 'st' | 'il',
        value: bodyContent,
      },
      documentation,
    }
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(`Failed to parse textual POU: ${error.message}`)
    }
    throw new Error('Failed to parse textual POU: Unknown error')
  }
}

/**
 * Parse a hybrid POU (Python, C++) from string to PLCPou object
 * @param content - The text content to parse
 * @param language - The language code (python, cpp)
 * @param type - The POU type (program, function, function-block)
 * @returns Parsed PLCPou object
 * @throws Error if parsing fails
 */
export const parseHybridPouFromString = (content: string, language: string, type: string): PLCPou => {
  try {
    const { documentation, remainingContent } = extractDocumentation(content)

    const pouTypeKeywords = {
      program: 'PROGRAM',
      function: 'FUNCTION',
      'function-block': 'FUNCTION_BLOCK',
    }

    const typeKeyword = pouTypeKeywords[type as keyof typeof pouTypeKeywords]
    if (!typeKeyword) {
      throw new Error(formatParseError(`Unsupported POU type: ${type}`))
    }

    const declarationRegex = new RegExp(`^\\s*(${typeKeyword})\\s+(\\w+)(?:\\s*:\\s*(\\w+))?`, 'i')
    const declarationMatch = remainingContent.match(declarationRegex)

    if (!declarationMatch) {
      throw new Error(formatParseError(`Could not find ${typeKeyword} declaration`))
    }

    const pouName = declarationMatch[2]
    const returnType = declarationMatch[3] // Only present for functions

    if (type === 'function' && !returnType) {
      throw new Error(formatParseError(`Function ${pouName} must have a return type`))
    }

    const varStartIndex = remainingContent.search(
      /\b(VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT|VAR_EXTERNAL|VAR_TEMP|VAR_GLOBAL|VAR)\b/i,
    )

    let variablesString = ''
    let bodyStartIndex = declarationMatch[0].length

    if (varStartIndex !== -1) {
      const varSectionStart = varStartIndex
      const lastEndVarIndex = findLastEndVarIndex(remainingContent, varSectionStart)

      if (lastEndVarIndex !== -1) {
        variablesString = remainingContent.slice(varSectionStart, lastEndVarIndex)
        bodyStartIndex = lastEndVarIndex
      }
    }

    const variables = variablesString.trim()
      ? parseIecStringToVariables(variablesString).map((v) => ({ ...v, debug: false }))
      : []

    // Strip the trailing END keyword from the body content, matching how textual/graphical parsers handle it
    const endKeywords: Record<string, string> = {
      program: 'END_PROGRAM',
      function: 'END_FUNCTION',
      'function-block': 'END_FUNCTION_BLOCK',
    }
    const endKeyword = endKeywords[type]
    let bodyContent = remainingContent.slice(bodyStartIndex).trim()
    if (endKeyword) {
      const endKeywordRegex = new RegExp(`\\s*\\b${endKeyword}\\b\\s*$`, 'i')
      bodyContent = bodyContent.replace(endKeywordRegex, '').trim()
    }

    return {
      name: pouName,
      pouType: type as PouType,
      interface: {
        ...(type === 'function' ? { returnType: returnType || '' } : {}),
        variables,
      },
      body: {
        language: language as 'python' | 'cpp',
        value: bodyContent,
      },
      documentation,
    }
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(`Failed to parse hybrid POU: ${error.message}`)
    }
    throw new Error('Failed to parse hybrid POU: Unknown error')
  }
}
