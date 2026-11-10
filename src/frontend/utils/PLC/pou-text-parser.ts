import type { PLCPou, PLCVariable, PouType } from '../../../middleware/shared/ports/types'
import { parseIecStringToVariables } from '../generate-iec-string-to-variables'
import { getLanguageFromExtension } from './pou-file-extensions'
import { blankTrivia } from './variable-declarations'

/**
 * Helper function to extract documentation from leading comments
 * @param content - The content to extract documentation from
 * @returns Object with documentation and remaining content
 */
export const extractDocumentation = (content: string): { documentation: string; remainingContent: string } => {
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
 * Is `value` the canonical body shape for this graphical language?
 *
 * LD is `{ name, rungs: [...] }`; FBD is `{ name, rung: { nodes: [...] } }`
 * (see `createPouObject`). `JSON.parse` succeeding says nothing about this:
 * `null`, or an object carrying the *other* language's shape, parses fine and
 * then fails much later inside a consumer reading `value.rungs` or
 * `value.rung.nodes`. Checking here keeps the failure nameable, and at the one
 * place that already owns "is this POU readable at all".
 */
export const isGraphicalBodyShape = (value: unknown, language: 'ld' | 'fbd'): boolean => {
  if (typeof value !== 'object' || value === null) return false
  if (language === 'ld') return 'rungs' in value && Array.isArray(value.rungs)
  if (!('rung' in value)) return false
  const rung = value.rung
  if (typeof rung !== 'object' || rung === null) return false
  return 'nodes' in rung && Array.isArray(rung.nodes)
}

/**
 * Index at which a graphical POU's JSON body starts, or -1 when there is none.
 *
 * `serializeGraphicalPouToString` writes the variable declarations, a blank
 * line, then `JSON.stringify(body, null, 2)` — so the body always opens with a
 * brace in **column 0**, and the anchor requires exactly that. A declaration
 * line may legitimately carry a brace (a struct initial value spilling onto its
 * own line, a CODESYS-style `{attribute ...}` pragma, an inline `(* ... *)`
 * comment), but the serializer always indents declarations, so none of them can
 * be mistaken for the body. Allowing an indented brace here would end the
 * declaration scan early and report a malformed declaration as invalid body
 * JSON, pointing the user at the wrong place.
 */
export const findGraphicalBodyStartIndex = (content: string, fromIndex: number): number => {
  const match = content.slice(fromIndex).match(/^\{/m)
  /* istanbul ignore next -- a matched regex always carries an index */
  if (match?.index === undefined) return -1
  return fromIndex + match.index
}

/**
 * Helper function to find the last END_VAR in the content
 * @param content - The content to search
 * @param startIndex - The index to start searching from
 * @param stopAtIndex - Optional exclusive upper bound for the search. Graphical
 *   POUs pass the start of their JSON body: a placed native (C/C++, Python)
 *   library block carries its authored source in `node.data.variant.body`, and
 *   that source has its own VAR ... END_VAR. Scanning the whole file would take
 *   the embedded END_VAR as the end of the declarations and slice the body from
 *   the middle of the JSON, so the POU failed to parse and the project could
 *   not be opened at all (DOPE-592).
 * @returns The index after the last END_VAR, or -1 if not found
 */
export const findLastEndVarIndex = (content: string, startIndex: number, stopAtIndex?: number): number => {
  const region = stopAtIndex === undefined ? content : content.slice(0, stopAtIndex)
  let lastEndVarIndex = -1
  let searchIndex = startIndex

  let endVarMatch = region.slice(searchIndex).match(/\bEND_VAR\b/i)
  while (endVarMatch && endVarMatch.index !== undefined) {
    lastEndVarIndex = searchIndex + endVarMatch.index + endVarMatch[0].length
    searchIndex = lastEndVarIndex
    endVarMatch = region.slice(searchIndex).match(/\bEND_VAR\b/i)
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
/**
 * The keyword a POU of each kind opens and closes with.
 *
 * One copy. These maps, the header regex built from them and the scan for the
 * start of the VAR section were written out four times — three times in this
 * file and again in the loader's fallback — and they had already drifted: the
 * fallback sliced the declarations from the `VAR` keyword rather than from the
 * start of its line, so the indentation fix (DOPE-650) reached three of the four
 * paths and a POU that failed to parse still came back re-indented.
 */
export const POU_TYPE_KEYWORDS: Record<string, string> = {
  program: 'PROGRAM',
  function: 'FUNCTION',
  'function-block': 'FUNCTION_BLOCK',
}

export const POU_END_KEYWORDS: Record<string, string> = {
  program: 'END_PROGRAM',
  function: 'END_FUNCTION',
  'function-block': 'END_FUNCTION_BLOCK',
}

export interface PouHeaderMatch {
  /** The matched header text, whose length is where the body may start. */
  text: string
  name: string
  /** Present for a FUNCTION, which declares what it returns. */
  returnType?: string
}

/** `PROGRAM Main` / `FUNCTION Add : INT` at the head of `content`. */
export const matchPouHeader = (content: string, pouType: string): PouHeaderMatch | undefined => {
  const keyword = POU_TYPE_KEYWORDS[pouType]
  if (!keyword) return undefined
  const match = content.match(new RegExp(`^\\s*(${keyword})\\s+(\\w+)(?:\\s*:\\s*(\\w+))?`, 'i'))
  if (!match) return undefined
  return { text: match[0], name: match[1 + 1], ...(match[3] ? { returnType: match[3] } : {}) }
}

/** The declaration section of a POU: absent, closed by `END_VAR`, or opened and never closed. */
export type VariablesSection =
  | { kind: 'none'; text: ''; bodyStartIndex: number }
  | { kind: 'declared'; text: string; bodyStartIndex: number }
  | { kind: 'unterminated'; text: string; bodyStartIndex: number; line: number }

const VAR_KEYWORD_PATTERN = '(VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT|VAR_EXTERNAL|VAR_TEMP|VAR_GLOBAL|VAR)\\b'

const UNTERMINATED_VAR_MESSAGE = 'Declaration block is never closed: missing END_VAR'

/**
 * Where the declaration text of a block whose keyword sits at `keywordIndex` starts.
 *
 * The start of the keyword's line when only indentation precedes it, so the indentation survives
 * the round trip; the keyword itself when the line also holds the header (`PROGRAM main VAR`).
 */
const declarationStartIndex = (content: string, keywordIndex: number): number => {
  const lineStart = content.lastIndexOf('\n', keywordIndex) + 1
  return /^[ \t]*$/.test(content.slice(lineStart, keywordIndex)) ? lineStart : keywordIndex
}

/**
 * Start of the first content after the POU header, comments included, or `keywordIndex` when the
 * header shares its line. It is where an unterminated declaration section begins, so a comment
 * written above the block is kept instead of belonging to neither the declarations nor the body.
 */
const unterminatedSectionStart = (content: string, bodyStartIndex: number, keywordIndex: number): number => {
  const offset = content.slice(bodyStartIndex).search(/\S/)
  return declarationStartIndex(content, offset === -1 ? keywordIndex : bodyStartIndex + offset)
}

/**
 * Index of the VAR-family keyword that opens the content after the POU header, or -1 when the
 * first token there, past whitespace and comments, is anything else.
 */
const leadingVarKeywordIndex = (content: string, bodyStartIndex: number): number => {
  const tail = blankTrivia(content.slice(bodyStartIndex))
  const tokenOffset = tail.search(/\S/)
  if (tokenOffset === -1) return -1
  const keywordIndex = bodyStartIndex + tokenOffset
  return new RegExp(`^${VAR_KEYWORD_PATTERN}`, 'i').test(content.slice(keywordIndex)) ? keywordIndex : -1
}

/** Index of the last word-bounded, case-insensitive `keyword` at or after `fromIndex`, or -1. */
const lastKeywordIndex = (content: string, keyword: string, fromIndex: number): number => {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`\\b${escaped}\\b`, 'gi')
  pattern.lastIndex = fromIndex
  let lastIndex = -1
  for (let match = pattern.exec(content); match !== null; match = pattern.exec(content)) {
    lastIndex = match.index
  }
  return lastIndex
}

/**
 * Where the text of a declaration block that never reaches `END_VAR` ends.
 *
 * At the JSON body of a graphical POU when `boundAtGraphicalBody` and one exists, otherwise at the
 * last `endKeyword` of a textual or hybrid POU, otherwise at the end of `content`.
 */
const unterminatedSectionEnd = (
  content: string,
  fromIndex: number,
  options: { boundAtGraphicalBody?: boolean; endKeyword?: string },
): number => {
  if (options.boundAtGraphicalBody) {
    const graphicalBodyStart = findGraphicalBodyStartIndex(content, fromIndex)
    if (graphicalBodyStart !== -1) return graphicalBodyStart
  }
  if (options.endKeyword) {
    const endIndex = lastKeywordIndex(content, options.endKeyword, fromIndex)
    if (endIndex !== -1) return endIndex
  }
  return content.length
}

/** 1-based line of `index` in `content`. */
const lineOfIndex = (content: string, index: number): number => {
  let line = 1
  for (
    let newline = content.indexOf('\n');
    newline !== -1 && newline < index;
    newline = content.indexOf('\n', newline + 1)
  ) {
    line += 1
  }
  return line
}

/**
 * The POU's declaration section and where its body starts.
 *
 * A closed section runs from the line of the first VAR-family keyword to the last `END_VAR`, kept
 * verbatim because it is written back to the file. A block that opens right after the header and
 * never reaches `END_VAR` is `unterminated`, runs from the first content after the header to
 * `unterminatedSectionEnd`, and carries the line of its keyword. `boundAtGraphicalBody` stops the `END_VAR` scan at the JSON body of a ladder
 * or FBD POU, for the reason spelled out on `findLastEndVarIndex`.
 */
export const extractVariablesSection = (
  content: string,
  bodyStartIndex: number,
  options: { boundAtGraphicalBody?: boolean; endKeyword?: string } = {},
): VariablesSection => {
  const varStartIndex = content.search(new RegExp(`\\b${VAR_KEYWORD_PATTERN}`, 'i'))
  if (varStartIndex === -1) return { kind: 'none', text: '', bodyStartIndex }

  const graphicalBodyStart = options.boundAtGraphicalBody ? findGraphicalBodyStartIndex(content, varStartIndex) : -1
  const lastEndVarIndex = findLastEndVarIndex(
    content,
    varStartIndex,
    graphicalBodyStart === -1 ? undefined : graphicalBodyStart,
  )
  if (lastEndVarIndex !== -1) {
    return {
      kind: 'declared',
      text: content.slice(declarationStartIndex(content, varStartIndex), lastEndVarIndex),
      bodyStartIndex: lastEndVarIndex,
    }
  }

  const keywordIndex = leadingVarKeywordIndex(content, bodyStartIndex)
  if (keywordIndex === -1) return { kind: 'none', text: '', bodyStartIndex }

  const sectionEnd = unterminatedSectionEnd(content, keywordIndex, options)
  return {
    kind: 'unterminated',
    text: content.slice(unterminatedSectionStart(content, bodyStartIndex, keywordIndex), sectionEnd).trimEnd(),
    bodyStartIndex: sectionEnd,
    line: lineOfIndex(content, keywordIndex),
  }
}

/** Number of lines the leading documentation takes in front of `remainingContent`. */
const documentationLineCount = (content: string, remainingContent: string): number =>
  lineOfIndex(content, content.length - remainingContent.length) - 1

/**
 * Throws the line-numbered parse error for a declaration block that never reaches `END_VAR`.
 * `line` is counted in the content after the leading documentation, which `documentationLines` adds back.
 */
const assertSectionTerminated = (section: VariablesSection, documentationLines: number): void => {
  if (section.kind === 'unterminated') {
    throw new Error(formatParseError(UNTERMINATED_VAR_MESSAGE, section.line + documentationLines))
  }
}

export const parseTextualPouFromString = (content: string, language: string, type: string): PLCPou => {
  try {
    const { documentation, remainingContent } = extractDocumentation(content)

    const typeKeyword = POU_TYPE_KEYWORDS[type]
    if (!typeKeyword) {
      throw new Error(formatParseError(`Unsupported POU type: ${type}`))
    }

    const declarationMatch = remainingContent.match(
      new RegExp(`^\\s*(${typeKeyword})\\s+(\\w+)(?:\\s*:\\s*(\\w+))?`, 'i'),
    )

    if (!declarationMatch) {
      throw new Error(formatParseError(`Could not find ${typeKeyword} declaration`))
    }

    const pouName = declarationMatch[2]
    const returnType = declarationMatch[3] // Only present for functions

    if (type === 'function' && !returnType) {
      throw new Error(formatParseError(`Function ${pouName} must have a return type`))
    }

    const endKeyword = POU_END_KEYWORDS[type]
    const section = extractVariablesSection(remainingContent, declarationMatch[0].length, { endKeyword })
    assertSectionTerminated(section, documentationLineCount(content, remainingContent))
    const variablesString = section.text
    const bodyStartIndex = section.bodyStartIndex

    const variables = variablesString.trim()
      ? parseIecStringToVariables(variablesString).map((v) => ({ ...v, debug: false }))
      : []

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
        variables,
      },
      body: {
        language: language as 'st' | 'il',
        value: bodyContent,
      },
      documentation,
      // The declaration text is the source of truth (DOPE-650): keep the block
      // exactly as it was written, so comments, blank lines and alignment survive
      // the round trip through the table. It used to be kept only when parsing
      // FAILED, so a successful load silently discarded everything the model
      // does not carry.
      variablesText: variablesString,
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

    const typeKeyword = POU_TYPE_KEYWORDS[type]
    if (!typeKeyword) {
      throw new Error(formatParseError(`Unsupported POU type: ${type}`))
    }

    const declarationMatch = remainingContent.match(
      new RegExp(`^\\s*(${typeKeyword})\\s+(\\w+)(?:\\s*:\\s*(\\w+))?`, 'i'),
    )

    if (!declarationMatch) {
      throw new Error(formatParseError(`Could not find ${typeKeyword} declaration`))
    }

    const pouName = declarationMatch[2]
    const returnType = declarationMatch[3] // Only present for functions

    if (type === 'function' && !returnType) {
      throw new Error(formatParseError(`Function ${pouName} must have a return type`))
    }

    const endKeyword = POU_END_KEYWORDS[type]
    const section = extractVariablesSection(remainingContent, declarationMatch[0].length, { endKeyword })
    assertSectionTerminated(section, documentationLineCount(content, remainingContent))
    const variablesString = section.text
    const bodyStartIndex = section.bodyStartIndex

    const variables = variablesString.trim()
      ? parseIecStringToVariables(variablesString).map((v) => ({ ...v, debug: false }))
      : []

    // Strip the trailing END keyword from the body content, matching how textual/graphical parsers handle it
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
        variables,
      },
      body: {
        language: language as 'python' | 'cpp',
        value: bodyContent,
      },
      documentation,
      // The declaration text is the source of truth (DOPE-650): keep the block
      // exactly as it was written, so comments, blank lines and alignment survive
      // the round trip through the table. It used to be kept only when parsing
      // FAILED, so a successful load silently discarded everything the model
      // does not carry.
      variablesText: variablesString,
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

    const typeKeyword = POU_TYPE_KEYWORDS[type]
    if (!typeKeyword) {
      throw new Error(formatParseError(`Unsupported POU type: ${type}`))
    }

    const declarationMatch = remainingContent.match(
      new RegExp(`^\\s*(${typeKeyword})\\s+(\\w+)(?:\\s*:\\s*(\\w+))?`, 'i'),
    )

    if (!declarationMatch) {
      throw new Error(formatParseError(`Could not find ${typeKeyword} declaration`))
    }

    const pouName = declarationMatch[2]
    const returnType = declarationMatch[3]

    if (type === 'function' && !returnType) {
      throw new Error(formatParseError(`Function ${pouName} must have a return type`))
    }

    const section = extractVariablesSection(remainingContent, declarationMatch[0].length, {
      boundAtGraphicalBody: true,
    })
    assertSectionTerminated(section, documentationLineCount(content, remainingContent))
    const variablesString = section.text
    const bodyStartIndex = section.bodyStartIndex

    const variables: PLCVariable[] = variablesString.trim()
      ? parseIecStringToVariables(variablesString).map((v) => ({ ...v, debug: false }))
      : []

    const endKeyword = POU_END_KEYWORDS[type]
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

    // Deliberately OUTSIDE the catch above. A body that parsed but carries the
    // wrong shape is not a JSON error, and saying "Invalid JSON" about valid
    // JSON sends the reader hunting for a syntax error that is not there. That
    // matters here more than usual: on an unrecoverable POU this text is the
    // Console line that explains why the project opened empty.
    // Narrowing (not `as`) gives TypeScript the literal union for free.
    if ((language === 'ld' || language === 'fbd') && !isGraphicalBodyShape(parsedBody, language)) {
      throw new Error(
        formatParseError(
          `Invalid graphical body shape: ${
            language === 'ld'
              ? 'expected an object with a "rungs" array'
              : 'expected an object with a "rung" object holding a "nodes" array'
          }`,
        ),
      )
    }

    // returnType is guaranteed non-empty for functions (validated above)
    /* istanbul ignore next -- defensive: returnType fallback is unreachable for functions */
    const resolvedReturnType = returnType || ''

    return {
      name: pouName,
      pouType: type as PouType,
      interface: {
        ...(type === 'function' ? { returnType: resolvedReturnType } : {}),
        variables,
      },
      body: {
        language: language as 'ld' | 'fbd',
        value: parsedBody,
      },
      documentation,
      // The declaration text is the source of truth (DOPE-650): keep the block
      // exactly as it was written, so comments, blank lines and alignment survive
      // the round trip through the table. It used to be kept only when parsing
      // FAILED, so a successful load silently discarded everything the model
      // does not carry.
      variablesText: variablesString,
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
