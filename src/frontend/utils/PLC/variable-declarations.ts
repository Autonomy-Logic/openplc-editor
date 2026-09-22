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

import { baseTypeSchema } from '../../../middleware/shared/ports/plc-schemas'
import type { PLCVariable } from '../../../middleware/shared/ports/types'
import { DEBUG_STRING_CAP } from '../variable-sizes'

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
    /**
     * The comment INCLUDING its delimiters.
     *
     * Clearing the Documentation cell has to take the whole comment: writing an
     * empty string into the inner span left `(**)` and `//` behind. Changing the
     * text may have to take it too, when what the user typed cannot live inside
     * the delimiters it currently has.
     */
    documentationOuter?: Span
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

/**
 * True when the source is already a whole POU rather than a bare run of VAR
 * blocks.
 *
 * Most callers hand over just the declarations, which have to be wrapped
 * because STruC++ parses compilation units. A few hand over the POU itself, and
 * wrapping that would nest one POU inside another. Detecting it keeps both
 * callers working off one entry point.
 */
function isWholePou(source: string): boolean {
  // Leading trivia is skipped first: a POU file normally opens with its
  // documentation comment, and testing the raw start meant
  // `(* docs *)\nPROGRAM Main` was taken for a bare run of VAR blocks and
  // wrapped inside a synthetic PROGRAM — a nested POU STruC++ then refused.
  let index = 0
  for (;;) {
    while (index < source.length && /\s/.test(source[index])) index++
    if (source.startsWith('(*', index)) {
      const close = blockCommentEnd(source, index)
      if (close === -1) break
      index = close
      continue
    }
    if (source.startsWith('//', index)) {
      const lineEnd = source.indexOf('\n', index)
      if (lineEnd === -1) break
      index = lineEnd + 1
      continue
    }
    break
  }
  return /^(PROGRAM|FUNCTION_BLOCK|FUNCTION)\s+\w/i.test(source.slice(index))
}

/**
 * The offset just past the `*)` that closes the block comment opening at
 * `open`, or -1 when nothing closes it.
 *
 * Counts nesting, because IEC block comments nest and STruC++ reads them that
 * way: `(* outer (* inner *) tail *)` is ONE comment. Taking the first `*)`
 * cut it at `inner`, so the Documentation column showed a truncated comment and
 * a POU whose leading documentation nested was not recognised as a POU at all.
 */
export function blockCommentEnd(source: string, open: number): number {
  let depth = 0
  for (let index = open; index < source.length - 1; index++) {
    if (source.startsWith('(*', index)) {
      depth += 1
      index += 1
      continue
    }
    if (source.startsWith('*)', index)) {
      depth -= 1
      if (depth === 0) return index + 2
      index += 1
    }
  }
  return -1
}

/**
 * The offset just past the string literal opening at `open`.
 *
 * IEC escapes a quote two ways and STruC++'s own token accepts both: `$'` and a
 * doubled `''`. A scanner that knows neither ends the literal early, and from
 * there every quote in the file pairs the wrong way — which is how a `//`
 * inside `'http://x'` came to be read as a comment.
 */
export function stringLiteralEnd(source: string, open: number): number {
  const quote = source[open]
  let index = open + 1
  while (index < source.length) {
    const char = source[index]
    // `$` escapes whatever follows, including the quote and another `$`.
    if (char === '$') {
      index += 2
      continue
    }
    if (char === quote) {
      if (source[index + 1] === quote) {
        index += 2
        continue
      }
      return index + 1
    }
    index += 1
  }
  return source.length
}

/**
 * `source` with every comment and string literal blanked to spaces, the same
 * length and the same line breaks.
 *
 * For the passes that look for a keyword in the text rather than in the AST.
 * Stripping `(*…*)` line by line with a regex missed a comment that spans
 * lines, and nothing at all protected a string: `'use: STRING[5]'` made
 * `refineErrors` report a STRING-length error against a line that had none, in
 * place of the real error somewhere else in the block.
 */
export function blankTrivia(source: string): string {
  const out = source.split('')
  const blank = (from: number, to: number) => {
    for (let index = from; index < to && index < out.length; index++) {
      if (out[index] !== '\n' && out[index] !== '\r') out[index] = ' '
    }
  }

  let index = 0
  while (index < source.length) {
    if (source.startsWith('(*', index)) {
      const close = blockCommentEnd(source, index)
      const end = close === -1 ? source.length : close
      blank(index, end)
      index = end
      continue
    }
    if (source.startsWith('//', index)) {
      const newline = source.indexOf('\n', index)
      const end = newline === -1 ? source.length : newline
      blank(index, end)
      index = end
      continue
    }
    const char = source[index]
    if (char === "'" || char === '"') {
      const end = stringLiteralEnd(source, index)
      // The quotes stay: a blanked literal is still a literal, and the passes
      // that read this text are looking for keywords, not for quotes.
      blank(index + 1, end - 1)
      index = end
      continue
    }
    index += 1
  }

  return out.join('')
}

/**
 * The line ending the file is written with.
 *
 * Text inserted into a CRLF file with a bare `\n` leaves it with mixed endings
 * — and every tool downstream, git included, then sees a change on lines nobody
 * touched.
 */
export function lineEndingOf(source: string): string {
  const newline = source.indexOf('\n')
  if (newline === -1) return '\n'
  return source[newline - 1] === '\r' ? '\r\n' : '\n'
}

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
function toSpan(starts: number[], span: StrucppSpan, wrapperLines: number): Span {
  const startLine = span.startLine - wrapperLines
  const endLine = span.endLine - wrapperLines
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
 * Deliberately tiny: it looks for one comment opener on one line of
 * already-parsed text, so it cannot repeat the mistake the scanner made, where
 * a hand-rolled comment pass ran over the whole file and mistook a `//` inside
 * a string literal for one.
 *
 * Whichever opener comes FIRST on the line owns the rest of it. Testing for
 * `(*` unconditionally meant the `(*` inside `// see (* note` was read as a
 * block opener, and the hunt for its `*)` — which a genuine block comment may
 * legitimately cross lines to find — ran on into the NEXT declaration. That
 * declaration then fell inside the first one's `lineSpan`, and deleting the
 * first variable from the table silently deleted its neighbour with it.
 *
 * A string literal is skipped, for the reason it is skipped everywhere else in
 * this file: an opener inside one is not an opener. Two declarations may share
 * a line, so the scan for the first one's comment runs over the second one's
 * text — and `a : INT; url : STRING := 'http://x';` gave `a` the documentation
 * `x';`, which `normalizeOneVariablePerLine` then wrote into the user's file as
 * `a : INT; //x';`.
 */
export function trailingComment(
  source: string,
  from: number,
): { inner: Span; kind: CommentKind; outer: Span } | undefined {
  const newline = source.indexOf('\n', from)
  const limit = newline === -1 ? source.length : newline
  // A CRLF file's `\r` belongs to the line ending, not to the comment. Inside
  // the span it was read as part of the text and dropped on the next edit,
  // leaving that one line with a bare `\n`.
  const lineEnd = source[limit - 1] === '\r' ? limit - 1 : limit

  for (let index = from; index < lineEnd; index++) {
    const char = source[index]
    if (char === "'" || char === '"') {
      index = stringLiteralEnd(source, index) - 1
      continue
    }
    if (source.startsWith('(*', index)) {
      // A block comment is the one thing here allowed to span lines, so its
      // closer is searched for in the whole source rather than to the end of
      // this line — and through any comment nested inside it.
      const close = blockCommentEnd(source, index)
      if (close === -1) return undefined
      return { inner: { start: index + 2, end: close - 2 }, kind: 'block', outer: { start: index, end: close } }
    }
    if (source.startsWith('//', index)) {
      return { inner: { start: index + 2, end: lineEnd }, kind: 'line', outer: { start: index, end: lineEnd } }
    }
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

export function classifyType(typeText: string, context: TypeContext): PLCVariable['type'] {
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

/** The keyword that closes a VAR block, whose length locates it from the block's end. */
const END_VAR_KEYWORD = 'END_VAR'

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
  nameSpans: StrucppSpan[]
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

// ---------------------------------------------------------------------------
// Reading the parser's result
// ---------------------------------------------------------------------------

/**
 * STruC++ is a typed dependency, but a type assertion over its result proves
 * nothing at runtime: every field dereferenced below sits OUTSIDE the `try`, so
 * one unexpected shape — a version skew, a recovery path that emits a partial
 * node — would throw straight through the "never throws" contract this function
 * advertises, and the caller would lose the user's text with it.
 *
 * So the result is read as `unknown` and checked. Anything that does not match
 * comes back as a parse error, which callers already handle by keeping the text
 * and showing the code view.
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isSpanShape = (value: unknown): value is StrucppSpan =>
  isRecord(value) &&
  typeof value.startLine === 'number' &&
  typeof value.endLine === 'number' &&
  typeof value.startCol === 'number' &&
  typeof value.endCol === 'number'

const isDeclarationShape = (value: unknown): value is StrucppDeclaration =>
  isRecord(value) &&
  isSpanShape(value.sourceSpan) &&
  Array.isArray(value.names) &&
  // One span per declared name. The spelling of every identifier is read back
  // through these, so a declaration without them is not something to work
  // around — it is a parser that does not meet the contract this editor pins.
  Array.isArray(value.nameSpans) &&
  value.nameSpans.length === value.names.length &&
  value.nameSpans.every(isSpanShape) &&
  isRecord(value.type) &&
  isSpanShape(value.type.sourceSpan) &&
  // An address the editor cannot locate is an address it would silently drop,
  // and then re-add as a second `AT` clause on the next patch.
  (value.address === undefined || value.address === '' || isSpanShape(value.addressSpan))

const isVarBlockShape = (value: unknown): value is StrucppVarBlock =>
  isRecord(value) &&
  typeof value.blockType === 'string' &&
  isSpanShape(value.sourceSpan) &&
  Array.isArray(value.declarations) &&
  value.declarations.every(isDeclarationShape)

const isRawError = (value: unknown): value is { message: string; line?: number; column?: number } =>
  isRecord(value) && typeof value.message === 'string'

/**
 * The VAR blocks of the POU the source describes, or undefined if the shape is
 * wrong.
 *
 * All three kinds, because `isWholePou` accepts all three: a whole
 * FUNCTION_BLOCK lands in `functionBlocks`, not `programs`, and reading only
 * `programs` returned an empty list with no error — a POU that silently
 * declared nothing. The wrapper produces a program, so that is the usual case;
 * the other two are the whole-POU callers.
 */
function readVarBlocks(ast: unknown): StrucppVarBlock[] | undefined {
  if (!isRecord(ast)) return []

  const collected: StrucppVarBlock[] = []
  for (const key of ['programs', 'functionBlocks', 'functions'] as const) {
    const pous = ast[key]
    if (pous === undefined) continue
    if (!Array.isArray(pous)) return undefined
    const [pou] = pous
    if (pou === undefined) continue
    if (!isRecord(pou)) return undefined
    const blocks = pou.varBlocks
    if (blocks === undefined) continue
    if (!Array.isArray(blocks) || !blocks.every(isVarBlockShape)) return undefined
    collected.push(...blocks)
  }
  return collected
}

// ---------------------------------------------------------------------------
// Error refinement — two cases STruC++ reports accurately but unhelpfully
// ---------------------------------------------------------------------------

const BLOCK_QUALIFIERS = new Set(['CONSTANT', 'RETAIN', 'NON_RETAIN', 'PERSISTENT'])

/**
 * Replace a raw parser error with the one the user can act on.
 *
 * STruC++ recovers from a bad token by resynchronising, which is right for a
 * compiler and wrong for a declaration editor: a mistyped VAR qualifier is
 * reported as `Expected Colon, found identifier A` against the NEXT line, which
 * is the one line in the block that has nothing wrong with it. The old regex
 * parser named the qualifier and pointed at the right line, and losing that was
 * a regression this restores. Both cases are recognised from the source, not
 * from the parser's wording, so a change in STruC++ phrasing cannot break them.
 *
 * Only two are handled, deliberately. They are the two the old parser had
 * specific messages for; everything else keeps STruC++'s own report.
 */
function refineErrors(source: string, errors: ParseError[]): ParseError[] {
  if (errors.length === 0) return errors
  // Read from the text with its comments and strings blanked, not from the raw
  // source: both recognisers below look for a keyword, and a keyword inside a
  // comment or a literal is not one. Blanking preserves offsets and line
  // breaks, so the spans reported still address the caller's own string.
  const lines = blankTrivia(source).split('\n')
  const starts = lineStarts(source)

  const at = (index: number, message: string): ParseError => ({
    message,
    line: index + 1,
    span: { start: starts[index] ?? 0, end: (starts[index] ?? 0) + lines[index].length },
  })

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]

    // A header and NOTHING else: `VAR_GLOBAL CONSTANT` is a qualifier list,
    // `VAR_INPUT x : BOOL;` is a declaration sharing the line and `VAR END_VAR`
    // is an empty block. Matching those as qualifiers replaced the POU's real
    // error with `Unknown variable block qualifier "x"`, pointing at the one
    // line that was fine.
    const header = /^\s*VAR(?:_INPUT|_OUTPUT|_IN_OUT|_EXTERNAL|_TEMP|_GLOBAL)?((?:\s+[A-Za-z_]\w*)*)\s*$/i.exec(line)
    const words = header
      ? header[1]
          .trim()
          .split(/\s+/)
          .filter((word) => word !== '')
      : []
    const unknown = words.find((word) => !BLOCK_QUALIFIERS.has(word.toUpperCase()) && word.toUpperCase() !== 'END_VAR')
    if (unknown !== undefined) {
      return [
        at(
          index,
          `Unknown variable block qualifier "${unknown}". Expected CONSTANT, RETAIN, NON_RETAIN or PERSISTENT.`,
        ),
      ]
    }

    const lengthQualified = /:\s*(?:ARRAY\s*\[[^\]]*\]\s+OF\s+)?(W?STRING)\s*\[/i.exec(line)
    if (lengthQualified) {
      const keyword = lengthQualified[1].toUpperCase()
      return [
        at(
          index,
          `A declared length is not supported on ${keyword} — use plain ${keyword}, which carries up to ${DEBUG_STRING_CAP} characters.`,
        ),
      ]
    }
  }

  return errors
}

/**
 * Can this text be written after `AT` and read back as the same one thing?
 *
 * Asked of the parser rather than of a word list. The editor kept its own list
 * of names to refuse — `isLegalIdentifier`, which also holds every standard
 * function name — and it did not match what STruC++ accepts: `Max`, `Step`,
 * `TP`, `Left`, `Time` and `Limit` all parse perfectly well as an `AT` operand,
 * and every existing pin called one of them was renamed on open for nothing.
 * The parser is the only authority on this, and it is already here.
 *
 * The round trip is checked, not just the absence of errors: `a; b : INT` would
 * parse as two declarations, so the test is that exactly one variable comes
 * back and its location is the text that went in.
 */
export function isReadableAtOperand(operand: string): boolean {
  const trimmed = operand.trim()
  if (trimmed === '' || trimmed !== operand) return false
  const probe = parseVariableDeclarations(`VAR\n  __alias_probe AT ${operand} : BOOL;\nEND_VAR`, {})
  if (probe.errors.length > 0 || probe.variables.length !== 1) return false
  return probe.variables[0].location === operand && probe.variables[0].name === '__alias_probe'
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
  const wrapperLines = isWholePou(source) ? 0 : 1
  const wrapped = wrapperLines === 0 ? source : `${WRAPPER_HEAD}${source}${WRAPPER_TAIL}`

  const wholeSource = { start: 0, end: source.length }
  let varBlocks: StrucppVarBlock[] | undefined
  let rawErrors: Array<{ message: string; line?: number; column?: number }> = []
  try {
    const result: unknown = parse(wrapped)
    if (!isRecord(result)) {
      return {
        blocks: [],
        variables: [],
        errors: [{ message: 'The parser returned no result.', line: 1, span: wholeSource }],
      }
    }
    rawErrors = Array.isArray(result.errors) ? result.errors.filter(isRawError) : []
    varBlocks = readVarBlocks(result.ast)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { blocks: [], variables: [], errors: [{ message, line: 1, span: wholeSource }] }
  }

  if (varBlocks === undefined) {
    return {
      blocks: [],
      variables: [],
      errors: [
        {
          message: 'The parser returned declarations in a shape this editor cannot read.',
          line: 1,
          span: wholeSource,
        },
      ],
    }
  }

  const errors: ParseError[] = rawErrors.map((error) => {
    const line = Math.max(1, (error.line ?? 1) - wrapperLines)
    const start = (starts[line - 1] ?? 0) + Math.max(0, (error.column ?? 1) - 1)
    const lineEnd = source.indexOf('\n', start)
    return { message: error.message, line, span: { start, end: lineEnd === -1 ? source.length : lineEnd } }
  })

  if (errors.length > 0) {
    return { blocks: [], variables: [], errors: refineErrors(source, errors) }
  }

  const blocks: ParsedBlock[] = []
  const variables: PLCVariable[] = []

  for (const block of varBlocks) {
    const blockClass = BLOCK_TO_CLASS[block.blockType.toUpperCase()] ?? 'local'
    const flag = blockFlag(block)
    const blockSpan = toSpan(starts, block.sourceSpan, wrapperLines)

    // Where the block's own keywords sit, worked out before the declarations
    // because every declaration's line span is clamped inside them.
    //
    // `END_VAR` closes the block, so the block span ends exactly at its last
    // character — no scanning needed. The header ends at the first newline, or
    // at the first declaration when one shares the header's line, whichever
    // comes first.
    const endVarStart = blockSpan.end - END_VAR_KEYWORD.length
    const firstDeclaration = block.declarations[0]
    const firstDeclarationStart = firstDeclaration
      ? toSpan(starts, firstDeclaration.sourceSpan, wrapperLines).start
      : endVarStart
    const headerNewline = source.indexOf('\n', blockSpan.start)
    const headerEnd = Math.min(headerNewline === -1 ? blockSpan.end : headerNewline, firstDeclarationStart)

    const declarations: ParsedDeclaration[] = []
    /**
     * Line starts whose trailing comment is already spoken for.
     *
     * Two declarations can share a line, and each one's scan runs to the end of
     * it, so both found the same comment: the table showed one note twice, and
     * a patch queued two edits over one span. The comment goes to the FIRST
     * declaration on the line — the one the user wrote it after.
     */
    const commentedLines = new Set<number>()

    for (const declaration of block.declarations) {
      // STruC++ spans the declaration inclusive of its `;`. The model's span
      // ends AT the semicolon instead, so an edit that appends a clause (`:= 7`)
      // anchors before it rather than after — otherwise `a : INT;` became
      // `a : INT; := 7`.
      const declFull = toSpan(starts, declaration.sourceSpan, wrapperLines)
      const declSpan: Span =
        source[declFull.end - 1] === ';' ? { start: declFull.start, end: declFull.end - 1 } : declFull
      const typeSpan = toSpan(starts, declaration.type.sourceSpan, wrapperLines)
      const typeText = source.slice(typeSpan.start, typeSpan.end).trim()

      const locationSpan = declaration.addressSpan ? toSpan(starts, declaration.addressSpan, wrapperLines) : undefined
      const locationText = locationSpan ? source.slice(locationSpan.start, locationSpan.end) : ''

      const initialSpan = declaration.initialValue
        ? toSpan(starts, declaration.initialValue.sourceSpan, wrapperLines)
        : undefined
      const initialText = initialSpan ? source.slice(initialSpan.start, initialSpan.end).trim() : ''

      const rawLineStart = source.lastIndexOf('\n', declFull.start - 1) + 1
      const comment = commentedLines.has(rawLineStart) ? undefined : trailingComment(source, declFull.end)
      if (comment) commentedLines.add(rawLineStart)
      const documentation = comment ? source.slice(comment.inner.start, comment.inner.end).trim() : ''

      // The declaration's line, CLAMPED to the inside of the block.
      //
      // A block keyword may share the line — `VAR_INPUT a : BOOL;` and
      // `VAR a : INT; END_VAR` are both legal — and the deletion, reorder and
      // normalise passes all work in whole lines. Unclamped, deleting `a` from
      // the first took `VAR_INPUT` with it and left the file unparseable, in the
      // text that gets written to disk.
      const lineStart = Math.max(source.lastIndexOf('\n', declSpan.start - 1) + 1, headerEnd)
      const consumedTo = comment ? comment.outer.end : declFull.end
      const nextNewline = source.indexOf('\n', consumedTo)
      const lineEnd = Math.min(nextNewline === -1 ? source.length : nextNewline + 1, endVarStart)
      const lineSpan = { start: lineStart, end: Math.max(lineEnd, declFull.end) }
      const line = declaration.sourceSpan.startLine - wrapperLines

      // One variable per declared name. `a, b : INT;` is two variables that
      // happen to share a line; the model has no way to say otherwise, and the
      // text is normalised to match.
      declaration.names.forEach((_folded, index) => {
        const nameSpan = toSpan(starts, declaration.nameSpans[index], wrapperLines)
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
            ...(comment
              ? {
                  documentation: comment.inner,
                  documentationKind: comment.kind,
                  documentationOuter: comment.outer,
                }
              : {}),
          },
        })
        variables.push(variable)
      })
    }

    blocks.push({
      class: blockClass,
      flag,
      headerSpan: { start: blockSpan.start, end: headerEnd },
      endVarSpan: { start: endVarStart, end: blockSpan.end },
      declarations,
    })
  }

  return { blocks, variables, errors }
}

/**
 * The context to classify types against when the caller has no project.
 *
 * Elementary types resolve; anything else is a user data type, which is the
 * right answer for a `.dt` field or a global variable list member referring to
 * a type declared elsewhere in the project. Shared so the three text parsers
 * cannot drift on what counts as a base type.
 */
export const ELEMENTARY_TYPE_CONTEXT: TypeContext = {
  resolveBaseType: (name: string) => {
    const check = baseTypeSchema.safeParse(name.toUpperCase())
    return check.success ? check.data : undefined
  },
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

  const newline = lineEndingOf(source)
  const edits: Array<{ span: Span; replacement: string }> = []

  for (const block of parsed.blocks) {
    // Grouped by the physical LINE, not by the declaration. A line gets crowded
    // three ways — `a, b : INT;`, `a : INT; b : INT;`, and a block keyword
    // sharing it as in `VAR_INPUT a : BOOL;` or `VAR a : INT; END_VAR` — and all
    // three leave the deletion, reorder and insert passes working in a line that
    // holds more than the one declaration they mean to touch.
    const byLine = new Map<number, ParsedDeclaration[]>()
    for (const declaration of block.declarations) {
      const lineStart = source.lastIndexOf('\n', declaration.span.start - 1) + 1
      byLine.set(lineStart, [...(byLine.get(lineStart) ?? []), declaration])
    }

    const headerText = source.slice(block.headerSpan.start, block.headerSpan.end).trimEnd()
    const blockIndent = source.slice(source.lastIndexOf('\n', block.headerSpan.start - 1) + 1, block.headerSpan.start)
    const fallbackIndent = /^[ \t]*$/.test(blockIndent) ? `${blockIndent}  ` : '  '

    for (const [lineStart, group] of byLine) {
      const [first] = group
      const last = group[group.length - 1]
      // The end of the physical line holding the LAST thing this group consumed.
      // Searched from one character back, because a consumed span can end exactly
      // on the next line's first character — and starting the search there ran
      // the line on into the `END_VAR` below it.
      const consumedTo = last.fields.documentation ? last.lineSpan.end : last.span.end
      const nextNewline = source.indexOf('\n', Math.max(lineStart, consumedTo - 1))
      const lineEnd = nextNewline === -1 ? source.length : nextNewline + 1

      const headerShares = block.headerSpan.start >= lineStart && block.headerSpan.start < lineEnd
      const endVarShares = block.endVarSpan.start >= lineStart && block.endVarSpan.start < lineEnd
      if (group.length < 2 && !headerShares && !endVarShares) continue

      // The user's own indentation, unless a block keyword is sitting in it —
      // `VAR_INPUT a : BOOL;` would otherwise indent the rewritten lines with
      // the string `VAR_INPUT `.
      const originalIndent = source.slice(lineStart, first.span.start)
      const declarationIndent = /^[ \t]*$/.test(originalIndent) ? originalIndent : fallbackIndent

      const lines = group.map((declaration) => {
        const { variable } = declaration
        // The comment belongs to the declaration that carries it — the first on
        // the line, which is the one the user wrote it after — so it follows
        // that declaration onto its own line and the others get none.
        const outer = declaration.fields.documentationOuter
        const trailing = outer ? source.slice(outer.start, outer.end) : ''

        let text = `${declarationIndent}${variable.name} : ${source.slice(declaration.fields.type.start, declaration.fields.type.end).trim()}`
        if (variable.location) text += ` AT ${variable.location}`
        if (variable.initialValue) text += ` := ${variable.initialValue}`
        text += ';'
        if (trailing) text += ` ${trailing}`
        return text
      })

      // A keyword sharing the line is put back on one of its own, which is what
      // makes the line spans above unambiguous for every later pass.
      const head = headerShares ? `${blockIndent}${headerText}${newline}` : ''
      const tail = endVarShares ? `${blockIndent}END_VAR${newline}` : ''
      edits.push({
        span: { start: lineStart, end: lineEnd },
        replacement: `${head}${lines.join(newline)}${newline}${tail}`,
      })
    }
  }

  if (edits.length === 0) return source
  return [...edits]
    .sort((a, b) => b.span.start - a.span.start)
    .reduce((text, edit) => text.slice(0, edit.span.start) + edit.replacement + text.slice(edit.span.end), source)
}
