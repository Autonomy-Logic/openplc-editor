/**
 * Scanner for an IEC `VAR … END_VAR` declaration block.
 *
 * Replaces the pair of monolithic regexes that used to match a declaration
 * line whole. Two things forced the change, and a third falls out of it:
 *
 *   1. **Comments.** The regexes had no concept of one, so a `(* … *)` on its
 *      own line, a multi-line one, or a `//` anywhere made the whole POU
 *      unparseable — and, because this parser is also the project loader, a
 *      project saved with a comment in its declarations reopened with an empty
 *      variables table (DOPE-650).
 *   2. **Alias locations.** The location group was `[\w\d._%]+`, but an alias
 *      name is free text. `AT relay-1` was a hard syntax error and
 *      `AT Motor Start` was worse: it matched the *type* group, so the
 *      variable silently acquired a user data type literally named
 *      "BOOL AT Motor Start" and lost its location.
 *   3. **A source map.** Scanning to explicit spans rather than regex groups
 *      gives every field's exact offsets, which is what lets a table edit
 *      splice one token and leave every comment, blank line and column of
 *      indentation around it untouched. The declaration text is the source of
 *      truth; regenerating it from the table is what used to destroy it.
 *
 * Comment syntax follows STruC++, which is the thing that ultimately reads
 * this text — verified against the pinned 0.6.7 rather than assumed:
 *
 *   - `(* … *)` **nests**. `(* outer (* inner *) still outer *)` is one
 *     comment, not a comment followed by live code.
 *   - `//` runs to the end of the line.
 *   - A C-style block comment opened with a slash-star is **not** a comment.
 *     Monaco offers the pair for auto-closing, but strucpp answers
 *     ``Expected `END_VAR`, found `/` `` — so honouring it here would make the
 *     table disagree with the compiler about what was declared.
 *   - An unterminated `(*` is an error ("Unclosed block comment"), not
 *     comment-to-end-of-input.
 *
 * Pure and platform-agnostic: no store, no IPC, no Monaco.
 */

import type { PLCVariable } from '../../middleware/shared/ports/types'
import { DEBUG_STRING_CAP } from './variable-sizes'

/** Half-open character range `[start, end)` into the scanned source. */
export interface Span {
  start: number
  end: number
}

export type CommentKind = 'block' | 'line'

export interface ScannedComment {
  /** The comment including its delimiters. */
  span: Span
  /** The text between the delimiters, untrimmed — the span that holds `text`. */
  inner: Span
  /** The text between the delimiters, trimmed. */
  text: string
  kind: CommentKind
}

/**
 * One variable declaration, with the offsets of every field.
 *
 * `span` covers the declaration proper (first character of the name through
 * the `;`). `documentation`, when present, points at the trailing comment's
 * inner text, which sits outside `span` — so replacing `span` never disturbs
 * the comment, and replacing the documentation never disturbs the declaration.
 */
export interface ScannedDeclaration {
  variable: PLCVariable
  span: Span
  /** Whole source lines the declaration occupies, including indentation and trailing newline. */
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

export interface ScannedBlock {
  class: PLCVariable['class']
  flag: PLCVariable['flag']
  /** The `VAR`/`VAR_INPUT`/… keyword plus its qualifiers. */
  headerSpan: Span
  /** The `END_VAR` keyword. */
  endVarSpan: Span
  declarations: ScannedDeclaration[]
}

export interface ScanError {
  message: string
  /** 1-indexed. */
  line: number
  span: Span
}

export interface ScanResult {
  blocks: ScannedBlock[]
  /** Every declaration's variable, flattened in source order. */
  variables: PLCVariable[]
  comments: ScannedComment[]
  errors: ScanError[]
}

/**
 * What the scanner needs to tell a function-block instance from a user data
 * type. Optional throughout: without it every non-elementary type resolves to
 * `user-data-type`, which is what the callers that pass nothing already got.
 */
export interface ScanContext {
  isFunctionBlockType?: (typeName: string) => boolean
  /** Resolve an elementary IEC type name, returning its canonical spelling. */
  resolveBaseType?: (typeName: string) => string | undefined
  /** Parse an `ARRAY […] OF T` type, returning null when it is not one. */
  parseArrayType?: (typeText: string) => PLCVariable['type'] | null
}

// ---------------------------------------------------------------------------
// Trivia
// ---------------------------------------------------------------------------

/**
 * Blank every comment out of `source`, preserving length and line structure.
 *
 * The returned `code` is the same length as `source` with comment characters
 * replaced by spaces and newlines kept, so every offset computed against it
 * indexes `source` unchanged. That 1:1 alignment is the whole point: it is
 * what lets the scanner reason about structure on comment-free text while
 * still handing back spans that address the user's actual bytes.
 */
export function blankComments(source: string): {
  code: string
  comments: ScannedComment[]
  error?: ScanError
} {
  const out = source.split('')
  const comments: ScannedComment[] = []
  let i = 0
  let line = 1

  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) {
      if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' '
    }
  }

  while (i < source.length) {
    const char = source[i]

    if (char === '\n') {
      line++
      i++
      continue
    }

    if (char === '(' && source[i + 1] === '*') {
      const start = i
      const startLine = line
      // Nested, because strucpp nests. A depth counter, not a search for the
      // first `*)`: with the latter, `(* a (* b *) c *)` would leave ` c *)`
      // as live code and the table would disagree with the compiler about
      // what was declared.
      let depth = 0
      let scan = i
      let closed = false
      while (scan < source.length) {
        if (source[scan] === '(' && source[scan + 1] === '*') {
          depth++
          scan += 2
          continue
        }
        if (source[scan] === '*' && source[scan + 1] === ')') {
          depth--
          scan += 2
          if (depth === 0) {
            closed = true
            break
          }
          continue
        }
        if (source[scan] === '\n') line++
        scan++
      }

      if (!closed) {
        return {
          code: out.join(''),
          comments,
          error: {
            message: `Unclosed block comment opened on line ${startLine}. Close it with "*)".`,
            line: startLine,
            span: { start, end: source.length },
          },
        }
      }

      comments.push({
        span: { start, end: scan },
        inner: { start: start + 2, end: scan - 2 },
        text: source.slice(start + 2, scan - 2).trim(),
        kind: 'block',
      })
      blank(start, scan)
      i = scan
      continue
    }

    if (char === '/' && source[i + 1] === '/') {
      const start = i
      let scan = i
      while (scan < source.length && source[scan] !== '\n') scan++
      comments.push({
        span: { start, end: scan },
        inner: { start: start + 2, end: scan },
        text: source.slice(start + 2, scan).trim(),
        kind: 'line',
      })
      blank(start, scan)
      i = scan
      continue
    }

    i++
  }

  return { code: out.join(''), comments }
}

// ---------------------------------------------------------------------------
// Block headers
// ---------------------------------------------------------------------------

const BLOCK_HEADER_REGEX =
  /^(VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT|VAR_EXTERNAL|VAR_TEMP|VAR_GLOBAL|VAR)(?<qualifiers>(?:\s+[A-Za-z_]\w*)*)\s*$/i

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
 * Reduce a block header's qualifier run to the single flag the model carries.
 *
 * `NON_RETAIN` is IEC's name for the default, so it maps to no flag at all —
 * accepted and then forgotten, which is exactly what it means. `PERSISTENT`
 * folds into `retain`: CODESYS also keeps it across a download and this
 * toolchain does not, so the honest mapping is the weaker guarantee both
 * share (STruC++ treats the keyword the same way).
 */
export function parseBlockFlag(qualifiers: string): PLCVariable['flag'] | Error {
  let flag: PLCVariable['flag'] | undefined
  let sawNonRetain = false

  for (const word of qualifiers.trim().split(/\s+/).filter(Boolean)) {
    switch (word.toUpperCase()) {
      case 'CONSTANT':
        if (flag === 'retain') return new Error('A variable cannot be both RETAIN and CONSTANT.')
        flag = 'constant'
        break
      case 'RETAIN':
      case 'PERSISTENT':
        if (flag === 'constant') return new Error('A variable cannot be both RETAIN and CONSTANT.')
        flag = 'retain'
        break
      case 'NON_RETAIN':
        sawNonRetain = true
        break
      default:
        return new Error(
          `Unknown variable block qualifier "${word}". Expected CONSTANT, RETAIN, NON_RETAIN or PERSISTENT.`,
        )
    }
  }

  if (sawNonRetain && flag !== undefined) {
    return new Error(`A variable cannot be both ${flag.toUpperCase()} and NON_RETAIN.`)
  }
  return flag
}

// ---------------------------------------------------------------------------
// Declaration structure
// ---------------------------------------------------------------------------

/** Trim a span inward past whitespace, so it addresses only the token itself. */
function tightenSpan(source: string, span: Span): Span {
  let { start, end } = span
  while (start < end && /\s/.test(source[start])) start++
  while (end > start && /\s/.test(source[end - 1])) end--
  return { start, end }
}

/**
 * Index of the first occurrence of `predicate` at bracket depth zero.
 *
 * Depth matters because an ARRAY's bounds carry commas and a structured
 * initial value carries parentheses; a naive `indexOf` would cut a declaration
 * in the middle of either.
 */
function findAtDepthZero(code: string, from: number, to: number, match: (at: number) => number): number {
  let depth = 0
  for (let i = from; i < to; i++) {
    const char = code[i]
    if (char === '[' || char === '(') depth++
    else if (char === ']' || char === ')') depth--
    else if (depth === 0) {
      const width = match(i)
      if (width > 0) return i
    }
  }
  return -1
}

const isWordChar = (char: string | undefined): boolean => char !== undefined && /[\w.]/.test(char)

/** Position of the standalone `AT` keyword, or -1. Case-insensitive, whole word. */
function findAtKeyword(code: string, from: number, to: number): number {
  return findAtDepthZero(code, from, to, (i) => {
    if (code[i] !== 'A' && code[i] !== 'a') return 0
    if (code[i + 1] !== 'T' && code[i + 1] !== 't') return 0
    if (isWordChar(code[i - 1]) || isWordChar(code[i + 2])) return 0
    return 2
  })
}

/** Position of `:=`, or -1. */
function findAssign(code: string, from: number, to: number): number {
  return findAtDepthZero(code, from, to, (i) => (code[i] === ':' && code[i + 1] === '=' ? 2 : 0))
}

/** Position of a type-separating `:` (not the `:` of `:=`), or -1. */
function findColon(code: string, from: number, to: number): number {
  return findAtDepthZero(code, from, to, (i) => (code[i] === ':' && code[i + 1] !== '=' ? 1 : 0))
}

/**
 * Best-effort cause for a declaration the scanner could not structure.
 * Wording preserved from the regex era: these strings are what the code view
 * shows the user, and they are asserted by the existing suite.
 */
function guessErrorReason(text: string): string {
  if (!text.includes(';')) return 'missing semicolon (;) at the end of the declaration'
  if (!text.includes(':')) return 'missing colon (:) between name and type'
  return 'unrecognized declaration format'
}

const IDENTIFIER_REGEX = /^[A-Za-z_]\w*$/

/** A type name: an identifier, optionally namespaced (`lib.TON`). */
const TYPE_NAME_REGEX = /^[A-Za-z_][\w.]*$/

interface DeclarationLayout {
  name: Span
  type: Span
  location?: Span
  initialValue?: Span
}

/**
 * Split a declaration into its fields.
 *
 * Both IEC orderings are accepted, the second because older OpenPLC Editor
 * versions and some other tools emit it:
 *
 *   name : type [AT location] [:= initial] ;
 *   name AT location : type [:= initial] ;
 *
 * The `AT` operand deliberately runs to the next `:=` or the `;` rather than
 * matching a character class. An alias name is free text — `Motor Start` and
 * `relay-1` are both valid aliases the table accepts — and anything narrower
 * either rejects them or, worse, lets them slide into the type.
 */
function layOutDeclaration(code: string, span: Span): DeclarationLayout | null {
  const { start, end } = span
  const assignIdx = findAssign(code, start, end)
  const valueEnd = assignIdx === -1 ? end : assignIdx
  const colonIdx = findColon(code, start, valueEnd)
  const atIdx = findAtKeyword(code, start, valueEnd)

  if (colonIdx === -1) return null

  const initialValue = assignIdx === -1 ? undefined : tightenSpan(code, { start: assignIdx + 2, end })

  // `name AT location : type` — the AT sits before the colon.
  if (atIdx !== -1 && atIdx < colonIdx) {
    return {
      name: tightenSpan(code, { start, end: atIdx }),
      location: tightenSpan(code, { start: atIdx + 2, end: colonIdx }),
      type: tightenSpan(code, { start: colonIdx + 1, end: valueEnd }),
      ...(initialValue ? { initialValue } : {}),
    }
  }

  // `name : type AT location` — the AT, if any, sits after the colon.
  return {
    name: tightenSpan(code, { start, end: colonIdx }),
    type: tightenSpan(code, { start: colonIdx + 1, end: atIdx === -1 ? valueEnd : atIdx }),
    ...(atIdx === -1 ? {} : { location: tightenSpan(code, { start: atIdx + 2, end: valueEnd }) }),
    ...(initialValue ? { initialValue } : {}),
  }
}

// ---------------------------------------------------------------------------
// Type resolution
// ---------------------------------------------------------------------------

/**
 * A declared length is legal IEC and legal CODESYS, and STruC++ does not
 * accept it. Left alone it is not even recognised as a string: it becomes a
 * user data type literally named "STRING[20]", which is persisted, shown in
 * the type cell, and emitted verbatim into the generated ST — where the
 * compiler fails with `Expected Semicolon, found [` pointing at a line the
 * user never wrote.
 *
 * Both shapes it can take: on its own (`msg : STRING[20]`) and as an ARRAY's
 * element type (`tags : ARRAY [0..3] OF STRING[20]`).
 */
function lengthQualifiedStringKeyword(typeText: string): string | undefined {
  const match =
    /^(W?STRING)\s*\[\s*[^\]]*\]$/i.exec(typeText) ??
    /^ARRAY\s*\[[^\]]*\]\s+OF\s+(W?STRING)\s*\[\s*[^\]]*\]\s*$/i.exec(typeText)
  return match ? match[1].toUpperCase() : undefined
}

function resolveType(typeText: string, context: ScanContext): PLCVariable['type'] | Error {
  const arrayType = context.parseArrayType?.(typeText) ?? null
  if (arrayType) return arrayType

  // The type region can hold a comma only as part of inline ARRAY bounds, and
  // `parseArrayType` has just declined it. Anything else — `x : INT, DINT;`,
  // `x : INT,;`, an ARRAY with a blank bound — is malformed and must be
  // rejected rather than become a user data type named "INT, DINT", which is
  // persisted, shown in the type cell, and emitted verbatim into the ST.
  if (typeText.includes(',')) {
    return new Error(
      'A comma is only allowed between inline ARRAY bounds (e.g. "ARRAY[0..1, 0..2] OF INT"), and no bound may be empty.',
    )
  }

  const stringKeyword = lengthQualifiedStringKeyword(typeText)
  if (stringKeyword) {
    // The transport carries a fixed DEBUG_STRING_CAP-character budget, so a
    // declared length would not be honoured even if it parsed; when the
    // compiler grows the declaration, this guard is the one place to change.
    return new Error(
      `A declared length is not supported on ${stringKeyword} — ` +
        `use plain ${stringKeyword}, which carries up to ${DEBUG_STRING_CAP} characters.`,
    )
  }

  // A type is a single identifier (optionally namespaced). Anything else
  // reaching here would otherwise become a user data type named after whatever
  // the user typed — which is exactly how `AT Motor Start` used to produce a
  // type literally called "BOOL AT Motor Start", persisted and emitted verbatim
  // into the generated ST. `ARRAY […] OF T` has already been handled above.
  if (!TYPE_NAME_REGEX.test(typeText)) {
    // eslint-disable-next-line no-useless-escape
    const hasUnsupportedCharacters = /[^A-Za-z0-9_\s:;=%()/*\-.,\[\]]/.test(typeText)
    return new Error(
      hasUnsupportedCharacters
        ? `The type "${typeText}" contains invalid or unsupported characters.`
        : `"${typeText}" is not a valid type name. Expected a single type, e.g. INT, MyStruct or ARRAY[0..3] OF INT.`,
    )
  }

  const baseType = context.resolveBaseType?.(typeText)
  if (baseType !== undefined) return { definition: 'base-type', value: baseType }

  if (context.isFunctionBlockType?.(typeText)) return { definition: 'derived', value: typeText }

  return { definition: 'user-data-type', value: typeText }
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

/** 1-indexed line number of `offset`. */
function lineAt(code: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset && i < code.length; i++) {
    if (code[i] === '\n') line++
  }
  return line
}

/**
 * Scan every `VAR … END_VAR` block in `source`.
 *
 * Never throws: structural problems land in `errors` with a line number and a
 * span, so a caller can surface them all at once or pick the first. Text
 * outside a block is ignored, which is how a POU signature line or a stray
 * comment between blocks has always been treated.
 */
export function scanVariableDeclarations(source: string, context: ScanContext = {}): ScanResult {
  const { code, comments, error: commentError } = blankComments(source)

  // Nothing after an unclosed `(*` can be classified — the text the scanner
  // would read as declarations is text the user probably meant to comment out.
  // Reporting the one cause beats reporting it plus the cascade it produces.
  if (commentError) {
    return { blocks: [], variables: [], comments, errors: [commentError] }
  }

  const errors: ScanError[] = []
  const blocks: ScannedBlock[] = []
  const variables: PLCVariable[] = []

  let block: ScannedBlock | null = null
  let cursor = 0
  let line = 1

  /** Trailing comment on the same line as `offset`, if any. */
  const trailingCommentAfter = (offset: number): ScannedComment | undefined => {
    const lineEnd = code.indexOf('\n', offset)
    const limit = lineEnd === -1 ? source.length : lineEnd
    return comments.find((comment) => comment.span.start >= offset && comment.span.end <= limit)
  }

  while (cursor < code.length) {
    const lineEnd = code.indexOf('\n', cursor)
    const stop = lineEnd === -1 ? code.length : lineEnd
    const rawLine = code.slice(cursor, stop)
    const trimmed = rawLine.trim()

    if (trimmed === '') {
      cursor = stop + 1
      line++
      continue
    }

    const indent = rawLine.length - rawLine.trimStart().length
    const tokenStart = cursor + indent
    const tokenEnd = cursor + rawLine.trimEnd().length

    if (block === null) {
      const header = trimmed.match(BLOCK_HEADER_REGEX)
      if (header) {
        const flag = parseBlockFlag(header.groups?.qualifiers ?? '')
        if (flag instanceof Error) {
          errors.push({
            message: `Syntax error on line ${line}: "${trimmed}". ${flag.message}`,
            line,
            span: { start: tokenStart, end: tokenEnd },
          })
        }
        block = {
          class: BLOCK_TO_CLASS[header[1].toUpperCase()],
          flag: flag instanceof Error ? undefined : flag,
          headerSpan: { start: tokenStart, end: tokenEnd },
          endVarSpan: { start: tokenEnd, end: tokenEnd },
          declarations: [],
        }
      }
      // Anything else outside a block is not ours to judge.
      cursor = stop + 1
      line++
      continue
    }

    if (/^END_VAR\b/i.test(trimmed)) {
      block.endVarSpan = { start: tokenStart, end: tokenEnd }
      blocks.push(block)
      block = null
      cursor = stop + 1
      line++
      continue
    }

    // A declaration runs to its semicolon, which may sit several lines down.
    const semicolon = code.indexOf(';', tokenStart)
    if (semicolon === -1) {
      const text = source.slice(tokenStart, tokenEnd)
      errors.push({
        message: `Syntax error on line ${line}: "${text}". Possible cause: ${guessErrorReason(text)}.`,
        line,
        span: { start: tokenStart, end: tokenEnd },
      })
      cursor = stop + 1
      line++
      continue
    }

    const declSpan = { start: tokenStart, end: semicolon }
    const declText = source.slice(declSpan.start, declSpan.end + 1)
    const declLine = line

    const doc = trailingCommentAfter(semicolon + 1)
    const declEndLine = code.indexOf('\n', doc ? doc.span.end : semicolon)
    const lineSpanEnd = declEndLine === -1 ? source.length : declEndLine + 1

    const layout = layOutDeclaration(code, declSpan)
    const nameText = layout ? source.slice(layout.name.start, layout.name.end) : ''

    if (!layout || !IDENTIFIER_REGEX.test(nameText)) {
      errors.push({
        message: `Syntax error on line ${declLine}: "${declText}". Possible cause: ${guessErrorReason(declText)}.`,
        line: declLine,
        span: declSpan,
      })
    } else {
      const typeText = source.slice(layout.type.start, layout.type.end)
      const resolved = resolveType(typeText, context)

      if (resolved instanceof Error) {
        errors.push({
          message: `Syntax error on line ${declLine}: "${declText}". ${resolved.message}`,
          line: declLine,
          span: declSpan,
        })
      } else {
        const locationText = layout.location ? source.slice(layout.location.start, layout.location.end) : ''
        const initialText = layout.initialValue ? source.slice(layout.initialValue.start, layout.initialValue.end) : ''

        const variable: PLCVariable = {
          name: nameText,
          class: block.class,
          type: resolved,
          location: locationText,
          initialValue: initialText === '' ? null : initialText,
          documentation: doc?.text ?? '',
          debug: false,
          ...(block.flag !== undefined ? { flag: block.flag } : {}),
        }

        block.declarations.push({
          variable,
          span: declSpan,
          lineSpan: { start: cursor, end: lineSpanEnd },
          line: declLine,
          fields: {
            name: layout.name,
            type: layout.type,
            ...(layout.location ? { location: layout.location } : {}),
            ...(layout.initialValue ? { initialValue: layout.initialValue } : {}),
            ...(doc ? { documentation: doc.inner, documentationKind: doc.kind } : {}),
          },
        })
        variables.push(variable)
      }
    }

    const consumedTo = Math.max(semicolon, doc ? doc.span.end : semicolon)
    line = declLine + (code.slice(tokenStart, consumedTo).split('\n').length - 1)
    const nextNewline = code.indexOf('\n', consumedTo)
    cursor = nextNewline === -1 ? code.length : nextNewline + 1
    line++
  }

  // An unterminated block is not fatal: the declarations before it parsed, and
  // refusing them would lose more than it protects.
  if (block !== null) {
    errors.push({
      message: `Missing END_VAR for the block opened on line ${lineAt(code, block.headerSpan.start)}.`,
      line: lineAt(code, block.headerSpan.start),
      span: block.headerSpan,
    })
    blocks.push(block)
  }

  return { blocks, variables, comments, errors }
}
