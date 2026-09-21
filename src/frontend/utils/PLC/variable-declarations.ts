/**
 * Read a POU's `VAR … END_VAR` declarations, using STruC++ as the parser.
 *
 * STruC++ is the compiler. Anything it reads, the build reads the same way, so
 * parsing with it removes a whole class of bug by construction: the table can
 * no longer disagree with the compiler about what was declared.
 *
 * Two hand-written parsers preceded this and both drifted from the compiler in
 * both directions (DOPE-650). The regexes accepted `x : My Type;` as a data
 * type literally named "My Type" and turned `AT Motor Start` into a type named
 * "BOOL AT Motor Start". The scanner that replaced them fixed those and
 * introduced its own: it had no notion of a string literal, so
 * `url : STRING := 'http://x'` died at the `//` and a whole POU loaded with an
 * empty variables table. Every such defect is a difference of opinion with the
 * compiler, and the only way to stop having them is to stop having an opinion.
 *
 * What this module still owns, because STruC++ cannot know it:
 *
 *   - **Comments.** The AST discards them, but a declaration's span ends at its
 *     `;`, so a trailing comment sits just past it and is read back from the
 *     source. That is the Documentation column, and it round-trips both ways.
 *   - **Spelling.** The lexer folds identifier case, so the AST says
 *     `MOTOR_START` where the user wrote `Motor_Start`. Every identifier is
 *     read from the source through its span, never from the AST.
 *   - **Classification.** Telling a function-block instance from a user data
 *     type needs the project's own POU and library lists, which are the
 *     editor's, not the compiler's.
 *
 * Aliases (`AT Motor_Start`) parse because STruC++ accepts an identifier as the
 * `AT` operand — added for exactly this reason. They are still not compilable:
 * the editor resolves them to real addresses before a build.
 */

import { parse } from 'strucpp'

import type { PLCVariable } from '../../../middleware/shared/ports/types'

/** Half-open character range `[start, end)` into the parsed source. */
export interface Span {
  start: number
  end: number
}

export type CommentKind = 'block' | 'line'

/** One declared variable, with the offsets of every field that can be edited. */
export interface ParsedDeclaration {
  variable: PLCVariable
  /** The declaration proper, first character of the name through the `;`. */
  span: Span
  /** Whole source lines the declaration occupies, including its trailing newline. */
  lineSpan: Span
  /** 1-indexed line of the declaration's first character. */
  line: number
  fields: {
    name: Span
    type: Span
    location?: Span
    initialValue?: Span
    /** Inner text of the trailing comment, excluding its delimiters. */
    documentation?: Span
    /** Which comment form carries the documentation, so an edit can keep it. */
    documentationKind?: CommentKind
  }
}

export interface ParsedBlock {
  class: PLCVariable['class']
  flag: PLCVariable['flag']
  headerSpan: Span
  endVarSpan: Span
  declarations: ParsedDeclaration[]
}

export interface ParseError {
  message: string
  /** 1-indexed, in the caller's source. */
  line: number
  span: Span
}

export interface ParseResult {
  blocks: ParsedBlock[]
  /** Every declaration's variable, flattened in source order. */
  variables: PLCVariable[]
  errors: ParseError[]
}

/**
 * What the editor knows and the compiler does not: whether a type name is a
 * function-block instance, and how an elementary type is spelled canonically.
 */
export interface TypeContext {
  isFunctionBlockType?: (typeName: string) => boolean
  resolveBaseType?: (typeName: string) => string | undefined
}

// ---------------------------------------------------------------------------
// Position mapping
// ---------------------------------------------------------------------------

/**
 * The declarations are wrapped in a POU before parsing, because STruC++ parses
 * compilation units and the variables view holds only the VAR blocks. The
 * wrapper is exactly one line, so an AST line maps back by subtracting it.
 */
const WRAPPER_HEAD = 'PROGRAM __openplc_variables__\n'
const WRAPPER_TAIL = '\n;\nEND_PROGRAM\n'
const WRAPPER_LINES = 1

/** Character offset of the start of each 1-indexed line. */
function lineStarts(source: string): number[] {
  const starts = [0]
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') starts.push(i + 1)
  }
  return starts
}

interface StrucppSpan {
  startLine: number
  endLine: number
  startCol: number
  endCol: number
}

/**
 * STruC++ span (1-indexed line/column, inclusive end) → character offsets in
 * the caller's source.
 */
function toSpan(starts: number[], span: StrucppSpan): Span {
  const startLine = span.startLine - WRAPPER_LINES
  const endLine = span.endLine - WRAPPER_LINES
  const start = (starts[startLine - 1] ?? 0) + span.startCol - 1
  const end = (starts[endLine - 1] ?? 0) + span.endCol
  return { start, end }
}

// ---------------------------------------------------------------------------
// Trivia — the one thing the AST does not carry
// ---------------------------------------------------------------------------

/**
 * The comment trailing a declaration, if any.
 *
 * Scans from just past the `;` to the end of that line. Deliberately tiny: it
 * looks for one comment opener in one line of already-parsed text, so it cannot
 * repeat the mistake the scanner made, where a hand-rolled comment pass ran
 * over the whole file and mistook a `//` inside a string literal for one.
 */
function trailingComment(source: string, from: number): { inner: Span; kind: CommentKind; end: number } | undefined {
  const lineEnd = source.indexOf('\n', from)
  const limit = lineEnd === -1 ? source.length : lineEnd
  const rest = source.slice(from, limit)

  const block = rest.indexOf('(*')
  if (block !== -1) {
    const close = source.indexOf('*)', from + block + 2)
    if (close !== -1) {
      return { inner: { start: from + block + 2, end: close }, kind: 'block', end: close + 2 }
    }
  }

  const line = rest.indexOf('//')
  if (line !== -1) {
    return { inner: { start: from + line + 2, end: limit }, kind: 'line', end: limit }
  }

  return undefined
}

// ---------------------------------------------------------------------------
// Type classification
// ---------------------------------------------------------------------------

/** Dimensions of an inline `ARRAY [a..b, c..d] OF T`, read from its text. */
function arrayDimensions(typeText: string): Array<{ dimension: string }> | undefined {
  const bounds = /^ARRAY\s*\[([^\]]*)\]\s+OF\s+/i.exec(typeText)
  if (!bounds) return undefined
  const parts = bounds[1].split(',').map((part) => part.trim())
  if (parts.some((part) => part === '')) return undefined
  return parts.map((dimension) => ({ dimension }))
}

/** Element type of an inline ARRAY, as the user spelled it. */
function arrayElementText(typeText: string): string | undefined {
  const element = /\sOF\s+(.+?)\s*$/i.exec(typeText)
  return element ? element[1].trim() : undefined
}

function classifyType(typeText: string, context: TypeContext): PLCVariable['type'] {
  const dimensions = arrayDimensions(typeText)
  if (dimensions) {
    const elementText = arrayElementText(typeText) ?? ''
    const elementBase = context.resolveBaseType?.(elementText)
    return {
      definition: 'array',
      value: typeText,
      data: {
        baseType:
          elementBase !== undefined
            ? { definition: 'base-type', value: elementBase }
            : { definition: 'user-data-type', value: elementText },
        dimensions,
      },
    }
  }

  const baseType = context.resolveBaseType?.(typeText)
  if (baseType !== undefined) return { definition: 'base-type', value: baseType }
  if (context.isFunctionBlockType?.(typeText)) return { definition: 'derived', value: typeText }
  return { definition: 'user-data-type', value: typeText }
}

// ---------------------------------------------------------------------------
// Block mapping
// ---------------------------------------------------------------------------

const BLOCK_TO_CLASS: Record<string, PLCVariable['class']> = {
  VAR: 'local',
  VAR_INPUT: 'input',
  VAR_OUTPUT: 'output',
  VAR_IN_OUT: 'inOut',
  VAR_EXTERNAL: 'external',
  VAR_TEMP: 'temp',
  VAR_GLOBAL: 'global',
}

/**
 * `PERSISTENT` folds into `retain`, as it always has here: CODESYS keeps it
 * across a download and this toolchain does not, so the honest mapping is the
 * weaker guarantee both share. STruC++ folds it the same way, which is why
 * `isRetain` is true for both.
 */
function blockFlag(block: { isConstant?: boolean; isRetain?: boolean }): PLCVariable['flag'] {
  if (block.isConstant === true) return 'constant'
  if (block.isRetain === true) return 'retain'
  return undefined
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

interface StrucppDeclaration {
  sourceSpan: StrucppSpan
  names: string[]
  nameSpans?: StrucppSpan[]
  type: { sourceSpan: StrucppSpan }
  initialValue?: { sourceSpan: StrucppSpan }
  address?: string
  addressSpan?: StrucppSpan
}

interface StrucppVarBlock {
  sourceSpan: StrucppSpan
  blockType: string
  isConstant?: boolean
  isRetain?: boolean
  declarations: StrucppDeclaration[]
}

/**
 * Parse `source` — a bare run of `VAR … END_VAR` blocks.
 *
 * Never throws: a syntax problem lands in `errors` with a line number, so the
 * caller can surface it against the buffer the user is looking at.
 *
 * A declaration naming several variables (`a, b : INT;`) yields one
 * `PLCVariable` per name, sharing the declaration's span. The text itself is
 * normalised to one declaration per line elsewhere — the Documentation column
 * lives at the end of a line, so two variables on one line have nowhere to put
 * two comments.
 */
export function parseVariableDeclarations(source: string, context: TypeContext = {}): ParseResult {
  const starts = lineStarts(source)
  const wrapped = `${WRAPPER_HEAD}${source}${WRAPPER_TAIL}`

  let ast: { programs?: Array<{ varBlocks?: StrucppVarBlock[] }> } | undefined
  let rawErrors: Array<{ message: string; line?: number; column?: number }> = []
  try {
    const result = parse(wrapped) as {
      ast?: { programs?: Array<{ varBlocks?: StrucppVarBlock[] }> }
      errors?: Array<{ message: string; line?: number; column?: number }>
    }
    ast = result.ast
    rawErrors = result.errors ?? []
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { blocks: [], variables: [], errors: [{ message, line: 1, span: { start: 0, end: source.length } }] }
  }

  const errors: ParseError[] = rawErrors.map((error) => {
    const line = Math.max(1, (error.line ?? 1) - WRAPPER_LINES)
    const start = (starts[line - 1] ?? 0) + Math.max(0, (error.column ?? 1) - 1)
    const lineEnd = source.indexOf('\n', start)
    return { message: error.message, line, span: { start, end: lineEnd === -1 ? source.length : lineEnd } }
  })

  const blocks: ParsedBlock[] = []
  const variables: PLCVariable[] = []

  for (const block of ast?.programs?.[0]?.varBlocks ?? []) {
    const blockClass = BLOCK_TO_CLASS[block.blockType.toUpperCase()] ?? 'local'
    const flag = blockFlag(block)
    const blockSpan = toSpan(starts, block.sourceSpan)
    const declarations: ParsedDeclaration[] = []

    for (const declaration of block.declarations) {
      const declSpan = toSpan(starts, declaration.sourceSpan)
      const typeSpan = toSpan(starts, declaration.type.sourceSpan)
      const typeText = source.slice(typeSpan.start, typeSpan.end).trim()

      const locationSpan = declaration.addressSpan ? toSpan(starts, declaration.addressSpan) : undefined
      const locationText = locationSpan ? source.slice(locationSpan.start, locationSpan.end) : ''

      const initialSpan = declaration.initialValue ? toSpan(starts, declaration.initialValue.sourceSpan) : undefined
      const initialText = initialSpan ? source.slice(initialSpan.start, initialSpan.end).trim() : ''

      const comment = trailingComment(source, declSpan.end)
      const documentation = comment ? source.slice(comment.inner.start, comment.inner.end).trim() : ''

      const lineStart = source.lastIndexOf('\n', declSpan.start - 1) + 1
      const consumedTo = comment ? comment.end : declSpan.end
      const nextNewline = source.indexOf('\n', consumedTo)
      const lineSpan = { start: lineStart, end: nextNewline === -1 ? source.length : nextNewline + 1 }
      const line = declaration.sourceSpan.startLine - WRAPPER_LINES

      // One variable per declared name. `a, b : INT;` is two variables that
      // happen to share a line; the model has no way to say otherwise, and the
      // text is normalised to match.
      declaration.names.forEach((_folded, index) => {
        const nameSpan = declaration.nameSpans?.[index]
          ? toSpan(starts, declaration.nameSpans[index])
          : { start: declSpan.start, end: declSpan.start }
        const name = source.slice(nameSpan.start, nameSpan.end)

        const variable: PLCVariable = {
          name,
          class: blockClass,
          type: classifyType(typeText, context),
          location: locationText,
          initialValue: initialText === '' ? null : initialText,
          documentation,
          debug: false,
          ...(flag !== undefined ? { flag } : {}),
        }

        declarations.push({
          variable,
          span: declSpan,
          lineSpan,
          line,
          fields: {
            name: nameSpan,
            type: typeSpan,
            ...(locationSpan ? { location: locationSpan } : {}),
            ...(initialSpan ? { initialValue: initialSpan } : {}),
            ...(comment ? { documentation: comment.inner, documentationKind: comment.kind } : {}),
          },
        })
        variables.push(variable)
      })
    }

    // STruC++ spans the whole block; the header and END_VAR are its first and
    // last lines, which is all a caller needs to insert a declaration.
    const headerEnd = source.indexOf('\n', blockSpan.start)
    const endVarStart = source.lastIndexOf('\n', blockSpan.end - 1) + 1
    blocks.push({
      class: blockClass,
      flag,
      headerSpan: { start: blockSpan.start, end: headerEnd === -1 ? blockSpan.end : headerEnd },
      endVarSpan: { start: endVarStart, end: blockSpan.end },
      declarations,
    })
  }

  return { blocks, variables, errors }
}

/**
 * Rewrite `source` so every declaration names exactly one variable.
 *
 * `a, b : INT;` is legal IEC and STruC++ reads it, but the editor cannot show
 * it: the Documentation column is the comment at the end of the line, and two
 * variables on one line have one line between them. Rather than refuse what the
 * compiler accepts, the text is normalised — on load and on commit — so the
 * user may type the short form and gets back the form the table can represent.
 *
 * The trailing comment is copied onto each resulting line: it described both
 * variables, and dropping it from one would lose the user's words.
 */
export function normalizeOneVariablePerLine(source: string, context: TypeContext = {}): string {
  const parsed = parseVariableDeclarations(source, context)
  if (parsed.errors.length > 0) return source

  const edits: Array<{ span: Span; replacement: string }> = []

  for (const block of parsed.blocks) {
    // Declarations are emitted once per name, so group them back by span.
    const byDeclaration = new Map<string, ParsedDeclaration[]>()
    for (const declaration of block.declarations) {
      const key = `${declaration.span.start}:${declaration.span.end}`
      byDeclaration.set(key, [...(byDeclaration.get(key) ?? []), declaration])
    }

    for (const group of byDeclaration.values()) {
      if (group.length < 2) continue
      const [first] = group
      const indent = source.slice(source.lastIndexOf('\n', first.span.start - 1) + 1, first.span.start)
      const trailing = first.fields.documentation
        ? source.slice(
            first.fields.documentation.start - 2,
            first.fields.documentationKind === 'line'
              ? first.fields.documentation.end
              : first.fields.documentation.end + 2,
          )
        : ''

      const lines = group.map((declaration) => {
        const { variable } = declaration
        let text = `${indent}${variable.name} : ${source.slice(declaration.fields.type.start, declaration.fields.type.end).trim()}`
        if (variable.location) text += ` AT ${variable.location}`
        if (variable.initialValue) text += ` := ${variable.initialValue}`
        text += ';'
        if (trailing) text += ` ${trailing}`
        return text
      })

      edits.push({ span: first.lineSpan, replacement: `${lines.join('\n')}\n` })
    }
  }

  if (edits.length === 0) return source
  return [...edits]
    .sort((a, b) => b.span.start - a.span.start)
    .reduce((text, edit) => text.slice(0, edit.span.start) + edit.replacement + text.slice(edit.span.end), source)
}
