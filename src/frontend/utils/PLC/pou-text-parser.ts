import type { PLCPou, PLCVariable, PouType } from '../../../middleware/shared/ports/types'
import { parseIecStringToVariables } from '../generate-iec-string-to-variables'
import { getLanguageFromExtension } from './pou-file-extensions'

/**
 * Helper function to extract documentation from leading comments
 * @param content - The content to extract documentation from
 * @returns Object with documentation and remaining content
 */
const extractDocumentation = (content: string): { documentation: string; remainingContent: string } => {
  // A comment is legal wherever whitespace is, so a header may be written as
  // several consecutive blocks.  Taking only the first leaves the rest in
  // front of the declaration, which the declaration regex then fails to match.
  const blocks: string[] = []
  let remainingContent = content
  for (;;) {
    const docMatch = remainingContent.match(/^\s*\(\*\s*(.*?)\s*\*\)\s*\n/s)
    if (!docMatch) break
    blocks.push(docMatch[1].trim())
    remainingContent = remainingContent.slice(docMatch[0].length)
  }
  return {
    documentation: blocks.join('\n\n'),
    remainingContent,
  }
}

/**
 * Helper function to provide clear error messages with line numbers
 * @param message - The error message
 * @param lineNumber - Optional line number where the error occurred
 * @returns Formatted error message
 */
const formatParseError = (message: string, lineNumber?: number): string => {
  /* istanbul ignore next -- lineNumber is reserved for future use; no caller provides it */
  if (lineNumber !== undefined) {
    return `Parse error on line ${lineNumber}: ${message}`
  }
  return `Parse error: ${message}`
}

/** A `VAR` section opening, with or without its qualifier. */
const VAR_SECTION_START = /^\s*VAR(_INPUT|_OUTPUT|_IN_OUT|_TEMP|_EXTERNAL|_GLOBAL|_ACCESS)?\b/i

/**
 * End of a POU's declaration region — the index just past the `END_VAR` that
 * closes the last consecutive `VAR` section, or -1 when none opens.
 *
 * Consumes `VAR` sections one at a time and stops at the first thing that is
 * not one, rather than taking the last `END_VAR` anywhere in the file. The
 * difference matters because the body that follows can contain the keyword:
 * a graphical POU's body is JSON, and a block node in it may carry a native
 * function block's source, `END_VAR` and all. Scanning to the end lands the
 * split inside that JSON string, and the file the editor wrote a moment ago
 * no longer parses.
 */
export const findLastEndVarIndex = (content: string, startIndex: number): number => {
  let cursor = startIndex
  let declarationEnd = -1

  while (VAR_SECTION_START.test(content.slice(cursor))) {
    const endVarMatch = content.slice(cursor).match(/\bEND_VAR\b/i)
    if (!endVarMatch || endVarMatch.index === undefined) break
    cursor += endVarMatch.index + endVarMatch[0].length
    declarationEnd = cursor
  }

  return declarationEnd
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

    // Captures the EXTENDS clause: anything between the POU name and the first
    // VAR block fell outside `declarationMatch[0]` and was dropped, so a derived
    // block reached the compiler with no base.
    const declarationRegex = new RegExp(
      `^\\s*(${typeKeyword})\\s+(\\w+)(?:\\s*:\\s*(\\w+))?(?:\\s+EXTENDS\\s+(\\w+))?`,
      'i',
    )
    const declarationMatch = remainingContent.match(declarationRegex)

    if (!declarationMatch) {
      throw new Error(formatParseError(`Could not find ${typeKeyword} declaration`))
    }

    const pouName = declarationMatch[2]
    const returnType = declarationMatch[3] // Only present for functions
    const baseBlock = declarationMatch[4] // Only present with EXTENDS

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

    // returnType is guaranteed non-empty for functions (validated above)
    /* istanbul ignore next -- defensive: returnType fallback is unreachable for functions */
    const resolvedReturnType = returnType || ''

    return {
      name: pouName,
      pouType: type as PouType,
      interface: {
        ...(type === 'function' ? { returnType: resolvedReturnType } : {}),
        ...(baseBlock ? { extends: baseBlock } : {}),
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

    // Captures the EXTENDS clause: anything between the POU name and the first
    // VAR block fell outside `declarationMatch[0]` and was dropped, so a derived
    // block reached the compiler with no base.
    const declarationRegex = new RegExp(
      `^\\s*(${typeKeyword})\\s+(\\w+)(?:\\s*:\\s*(\\w+))?(?:\\s+EXTENDS\\s+(\\w+))?`,
      'i',
    )
    const declarationMatch = remainingContent.match(declarationRegex)

    if (!declarationMatch) {
      throw new Error(formatParseError(`Could not find ${typeKeyword} declaration`))
    }

    const pouName = declarationMatch[2]
    const returnType = declarationMatch[3] // Only present for functions
    const baseBlock = declarationMatch[4] // Only present with EXTENDS

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
    /* istanbul ignore next -- defensive: type already validated above */
    if (endKeyword) {
      const endKeywordRegex = new RegExp(`\\s*\\b${endKeyword}\\b\\s*$`, 'i')
      bodyContent = bodyContent.replace(endKeywordRegex, '').trim()
    }

    // returnType is guaranteed non-empty for functions (validated above)
    /* istanbul ignore next -- defensive: returnType fallback is unreachable for functions */
    const resolvedReturnType = returnType || ''

    return {
      name: pouName,
      pouType: type as PouType,
      interface: {
        ...(type === 'function' ? { returnType: resolvedReturnType } : {}),
        ...(baseBlock ? { extends: baseBlock } : {}),
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

/**
 * Parse a graphical POU (LD, FBD) from string to PLCPou object.
 * Graphical POUs store their body as JSON between the variable declarations and the END keyword.
 * @param content - The text content to parse
 * @param language - The language code (ld, fbd)
 * @param type - The POU type (program, function, function-block)
 * @returns Parsed PLCPou object
 * @throws Error if parsing fails
 */
export const parseGraphicalPouFromString = (content: string, language: string, type: string): PLCPou => {
  try {
    const { documentation, remainingContent } = extractDocumentation(content)

    const pouTypeKeywords: Record<string, string> = {
      program: 'PROGRAM',
      function: 'FUNCTION',
      'function-block': 'FUNCTION_BLOCK',
    }

    const typeKeyword = pouTypeKeywords[type]
    if (!typeKeyword) {
      throw new Error(formatParseError(`Unsupported POU type: ${type}`))
    }

    // Captures the EXTENDS clause: anything between the POU name and the first
    // VAR block fell outside `declarationMatch[0]` and was dropped, so a derived
    // block reached the compiler with no base.
    const declarationRegex = new RegExp(
      `^\\s*(${typeKeyword})\\s+(\\w+)(?:\\s*:\\s*(\\w+))?(?:\\s+EXTENDS\\s+(\\w+))?`,
      'i',
    )
    const declarationMatch = remainingContent.match(declarationRegex)

    if (!declarationMatch) {
      throw new Error(formatParseError(`Could not find ${typeKeyword} declaration`))
    }

    const pouName = declarationMatch[2]
    const returnType = declarationMatch[3]
    const baseBlock = declarationMatch[4] // Only present with EXTENDS

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

    const variables: PLCVariable[] = variablesString.trim()
      ? parseIecStringToVariables(variablesString).map((v) => ({ ...v, debug: false }))
      : []

    const endKeywords: Record<string, string> = {
      program: 'END_PROGRAM',
      function: 'END_FUNCTION',
      'function-block': 'END_FUNCTION_BLOCK',
    }

    const endKeyword = endKeywords[type]
    const endKeywordRegex = new RegExp(`\\b${endKeyword}\\b`, 'i')
    const endMatch = remainingContent.slice(bodyStartIndex).search(endKeywordRegex)

    if (endMatch === -1) {
      throw new Error(formatParseError(`Could not find ${endKeyword}`))
    }

    const bodyContent = remainingContent.slice(bodyStartIndex, bodyStartIndex + endMatch).trim()

    let parsedBody: unknown
    try {
      parsedBody = JSON.parse(bodyContent)
    } catch (jsonError: unknown) {
      if (jsonError instanceof Error) {
        throw new Error(formatParseError(`Invalid JSON in graphical body: ${jsonError.message}`))
      }
      throw new Error(formatParseError('Invalid JSON in graphical body'))
    }

    // returnType is guaranteed non-empty for functions (validated above)
    /* istanbul ignore next -- defensive: returnType fallback is unreachable for functions */
    const resolvedReturnType = returnType || ''

    return {
      name: pouName,
      pouType: type as PouType,
      interface: {
        ...(type === 'function' ? { returnType: resolvedReturnType } : {}),
        ...(baseBlock ? { extends: baseBlock } : {}),
        variables,
      },
      body: {
        language: language as 'ld' | 'fbd',
        value: parsedBody,
      },
      documentation,
    }
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(`Failed to parse graphical POU: ${error.message}`)
    }
    throw new Error('Failed to parse graphical POU: Unknown error')
  }
}

/**
 * Detect language from file extension
 * @param filePath - The file path with extension
 * @returns The language code
 * @throws Error if extension is not supported
 */
export const detectLanguageFromExtension = (filePath: string): string => {
  const extension = filePath.slice(filePath.lastIndexOf('.'))
  return getLanguageFromExtension(extension)
}
