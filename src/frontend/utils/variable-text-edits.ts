/**
 * Apply a change in the variables model back onto the declaration text.
 *
 * The declaration text is the source of truth (DOPE-650). The project file has
 * always stored a POU's variables as plain IEC text and that is what the editor
 * loads, so the table is a view of the text, not the other way round.
 *
 * That only holds if a table edit *patches* the text. The store used to call
 * `generateIecVariablesToString` and overwrite the buffer wholesale, which
 * threw away every comment, every blank line and every column of alignment the
 * user had put there — so "the text is preserved" lasted exactly until the next
 * cell edit.
 *
 * So: splice the fields that changed, delete the lines that went away, insert
 * the ones that appeared, and do not touch a single other byte. Everything here
 * is driven by the parser's source map — STruC++'s own spans — so there is no
 * re-serialisation of anything the user already wrote.
 *
 * Pure: text in, text out.
 */

import type { PLCVariable } from '../../middleware/shared/ports/types'
import { generateIecVariablesToString } from './generate-iec-variables-to-string'
import type { ParsedBlock, ParsedDeclaration, ParseResult, Span, TypeContext } from './PLC/variable-declarations'
import { normalizeOneVariablePerLine, parseVariableDeclarations } from './PLC/variable-declarations'

interface TextEdit {
  span: Span
  replacement: string
}

/** Apply edits right to left so each span still addresses the original text. */
function applyEdits(text: string, edits: TextEdit[]): string {
  const ordered = [...edits].sort((a, b) => b.span.start - a.span.start)
  let out = text
  for (const edit of ordered) {
    out = out.slice(0, edit.span.start) + edit.replacement + out.slice(edit.span.end)
  }
  return out
}

const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/**
 * True when some physical line holds more than one variable.
 *
 * Two forms do it — `a, b : INT;` and `a : INT; b : INT;` — and both leave the
 * variables sharing one `lineSpan`, which is the unit the deletion and
 * reordering passes below work in. Deleting `a` therefore took `b` with it, and
 * reordering spliced two edits into the same line against pre-edit offsets.
 *
 * Rather than teach those passes to rewrite part of a line (and collide with
 * the field edits queued against the very same span in the same commit), the
 * text is normalised to one declaration per line first — which is the only form
 * the table can represent anyway, since the Documentation column is the comment
 * at the end of a line.
 */
function hasCrowdedLine(result: ParseResult): boolean {
  for (const block of result.blocks) {
    const seen = new Set<number>()
    for (const declaration of block.declarations) {
      if (seen.has(declaration.lineSpan.start)) return true
      seen.add(declaration.lineSpan.start)
    }
  }
  return false
}

const blockKey = (variable: PLCVariable): string => `${variable.class ?? 'global'}\u0000${variable.flag ?? ''}`
const parsedBlockKey = (block: ParsedBlock): string => `${block.class ?? 'global'}\u0000${block.flag ?? ''}`

/** The declaration's own indentation, so an inserted sibling lines up with it. */
function indentOf(text: string, declaration: ParsedDeclaration): string {
  const lineStart = text.lastIndexOf('\n', declaration.span.start - 1) + 1
  return text.slice(lineStart, declaration.span.start)
}

/** Render a declaration for a variable that has no line of its own yet. */
function renderDeclaration(variable: PLCVariable, indent: string): string {
  let line = `${indent}${variable.name} : ${variable.type.value}`
  if (variable.location) line += ` AT ${variable.location}`
  if (variable.initialValue) line += ` := ${variable.initialValue}`
  line += ';'
  const documentation = variable.documentation?.replace(/(\r\n|\n|\r)/gm, ' ').trim()
  if (documentation) line += ` (* ${documentation} *)`
  return line
}

/**
 * Pair each incoming variable with the declaration it came from.
 *
 * `id` first when both sides carry one, then name, then position among what is
 * left. The fallback is what makes a rename survive as an *edit* to the
 * existing line rather than a delete plus an append — which would move the
 * declaration to the bottom of its block and strand any comment written above
 * it.
 */
function matchDeclarations(
  declarations: ParsedDeclaration[],
  nextVariables: PLCVariable[],
): Map<number, ParsedDeclaration> {
  const matched = new Map<number, ParsedDeclaration>()
  const taken = new Set<ParsedDeclaration>()

  const claim = (index: number, declaration: ParsedDeclaration | undefined): boolean => {
    if (!declaration || taken.has(declaration)) return false
    matched.set(index, declaration)
    taken.add(declaration)
    return true
  }

  // Every pass is confined to the variable's own VAR block, for the reason the
  // positional pass below already states: moving a variable between classes is
  // a move, not an edit. Without the check here, changing a variable's class in
  // the table matched it to its OLD declaration by id or name, and
  // `editsForDeclaration` patches fields only — nothing moved the line out of
  // the block it was sitting in, so the class silently reverted on reload while
  // the table went on showing the new one.
  nextVariables.forEach((variable, index) => {
    if (!variable.id) return
    claim(
      index,
      declarations.find(
        (d) =>
          d.variable.id !== undefined && d.variable.id === variable.id && blockKey(d.variable) === blockKey(variable),
      ),
    )
  })

  nextVariables.forEach((variable, index) => {
    if (matched.has(index)) return
    claim(
      index,
      declarations.find(
        (d) => !taken.has(d) && sameName(d.variable.name, variable.name) && blockKey(d.variable) === blockKey(variable),
      ),
    )
  })

  // Positional pass, pairing the leftovers in order: this is the rename case.
  const leftoverDeclarations = declarations.filter((d) => !taken.has(d))
  let cursor = 0
  nextVariables.forEach((variable, index) => {
    if (matched.has(index)) return
    while (cursor < leftoverDeclarations.length) {
      const candidate = leftoverDeclarations[cursor++]
      // Only pair within the same block: moving a variable between classes is
      // a move, not an edit, and splicing it in place would leave it under the
      // wrong VAR keyword.
      if (blockKey(candidate.variable) !== blockKey(variable)) continue
      claim(index, candidate)
      return
    }
  })

  return matched
}

/** Field-level edits turning `declaration` into `variable`. */
function editsForDeclaration(text: string, declaration: ParsedDeclaration, variable: PLCVariable): TextEdit[] {
  const edits: TextEdit[] = []
  const current = declaration.variable
  const at = (span: Span) => text.slice(span.start, span.end)

  if (!sameName(current.name, variable.name) || current.name !== variable.name) {
    if (at(declaration.fields.name) !== variable.name) {
      edits.push({ span: declaration.fields.name, replacement: variable.name })
    }
  }

  // A type name is case-insensitive in IEC, and the model holds the canonical
  // spelling: `bool` in the text is `BOOL` in the model. Comparing them exactly
  // meant merely opening a project retyped every declaration the user had
  // written in lower case, and the first save wrote that back to their file.
  // A real type change still differs with the case folded away.
  if (at(declaration.fields.type).toUpperCase() !== variable.type.value.toUpperCase()) {
    edits.push({ span: declaration.fields.type, replacement: variable.type.value })
  }

  // Location, initial value and documentation are optional clauses: each can
  // be edited in place, removed, or added where none existed. Adding one needs
  // an anchor, and the anchors differ, so they are handled one by one rather
  // than through a shared helper that would have to know all three shapes.
  const nextLocation = variable.location ?? ''
  const locationSpan = declaration.fields.location
  if (locationSpan && nextLocation === '') {
    // Drop the whole ` AT <loc>` clause, not just its operand.
    edits.push({ span: { start: findClauseStart(text, locationSpan, 'AT'), end: locationSpan.end }, replacement: '' })
  } else if (locationSpan && at(locationSpan) !== nextLocation) {
    edits.push({ span: locationSpan, replacement: nextLocation })
  } else if (!locationSpan && nextLocation !== '') {
    edits.push({
      span: { start: declaration.fields.type.end, end: declaration.fields.type.end },
      replacement: ` AT ${nextLocation}`,
    })
  }

  const nextInitial = variable.initialValue ?? ''
  const initialSpan = declaration.fields.initialValue
  if (initialSpan && nextInitial === '') {
    edits.push({ span: { start: findClauseStart(text, initialSpan, ':='), end: initialSpan.end }, replacement: '' })
  } else if (initialSpan && at(initialSpan) !== nextInitial) {
    edits.push({ span: initialSpan, replacement: nextInitial })
  } else if (!initialSpan && nextInitial !== '') {
    edits.push({ span: { start: declaration.span.end, end: declaration.span.end }, replacement: ` := ${nextInitial}` })
  }

  const nextDocumentation = (variable.documentation ?? '').replace(/(\r\n|\n|\r)/gm, ' ').trim()
  const documentationSpan = declaration.fields.documentation
  if (documentationSpan) {
    if (text.slice(documentationSpan.start, documentationSpan.end).trim() !== nextDocumentation) {
      // Replace the comment's inner text and keep its delimiters, so a `//`
      // comment stays a `//` comment and a block comment stays a block one.
      // A line comment has no closing delimiter to pad away from, so only the
      // block form gets the trailing space.
      const padded =
        declaration.fields.documentationKind === 'line' ? ` ${nextDocumentation}` : ` ${nextDocumentation} `
      edits.push({ span: documentationSpan, replacement: nextDocumentation === '' ? '' : padded })
    }
  } else if (nextDocumentation !== '') {
    edits.push({
      span: { start: declaration.span.end + 1, end: declaration.span.end + 1 },
      replacement: ` (* ${nextDocumentation} *)`,
    })
  }

  return edits
}

/**
 * Start of the ` AT ` / ` := ` keyword preceding `operand`, so removing the
 * clause takes the keyword and its leading whitespace with it and does not
 * leave `x : BOOL AT ;` behind.
 */
function findClauseStart(text: string, operand: Span, keyword: string): number {
  // Searched strictly BEFORE the operand. `lastIndexOf(keyword, operand.start)`
  // accepts a match AT `operand.start`, so an alias that itself begins with the
  // keyword's letters matched instead of the real clause: clearing the location
  // of `x : BOOL AT ATTIC_LIGHT;` removed only `ATTIC_LIGHT` and left
  // `x : BOOL AT;` — a syntax error on the next load. An alias is free text
  // that round-trips whatever the user wrote, so this is reachable.
  //
  // Matched case-insensitively, because IEC keywords are and STruC++ accepts
  // `x : BOOL at %QX0.0;`. Searching for the literal `AT` found nothing there,
  // so clearing the location removed only the operand and left `x : BOOL at ;`
  // — which nothing can parse, in the text that gets written to disk.
  const before = text.toUpperCase().lastIndexOf(keyword.toUpperCase(), Math.max(0, operand.start - keyword.length))
  if (before === -1) return operand.start
  let start = before
  while (start > 0 && /[ \t]/.test(text[start - 1])) start--
  return start
}

/**
 * Rewrite `text` so its declarations describe `nextVariables`, changing as
 * little as possible.
 *
 * Returns the text unchanged when nothing differs. Falls back to a full
 * canonical serialisation only when the text cannot be scanned at all — there
 * is no source map to patch against then, and silently keeping a stale buffer
 * would be worse than reformatting it.
 */
export function applyVariablesToText(text: string, nextVariables: PLCVariable[], context: TypeContext = {}): string {
  let source = text
  let scanned = parseVariableDeclarations(source, context)
  if (scanned.errors.length > 0) return generateIecVariablesToString(nextVariables)

  if (hasCrowdedLine(scanned)) {
    source = normalizeOneVariablePerLine(source, context)
    scanned = parseVariableDeclarations(source, context)
    /* istanbul ignore if -- the normaliser returns its input unchanged when it cannot parse,
       and the parse above already succeeded; this guards the re-parse only */
    if (scanned.errors.length > 0) return generateIecVariablesToString(nextVariables)
  }

  const declarations = scanned.blocks.flatMap((block) => block.declarations)
  const matched = matchDeclarations(declarations, nextVariables)
  const matchedDeclarations = new Set(matched.values())

  const edits: TextEdit[] = []

  // 1. Fields that changed on a declaration that survived.
  nextVariables.forEach((variable, index) => {
    const declaration = matched.get(index)
    if (declaration) edits.push(...editsForDeclaration(source, declaration, variable))
  })

  // 2. Declarations with no variable left: take the whole line, so no blank
  //    line is left where the declaration was.
  for (const declaration of declarations) {
    if (!matchedDeclarations.has(declaration)) {
      edits.push({ span: declaration.lineSpan, replacement: '' })
    }
  }

  // 3. Variables with no declaration: insert before the END_VAR of a block of
  //    the same class and flag, or open a new block after everything.
  const additions = nextVariables.filter((_, index) => !matched.has(index))
  if (additions.length > 0) {
    const byBlock = new Map<string, PLCVariable[]>()
    for (const variable of additions) {
      const key = blockKey(variable)
      byBlock.set(key, [...(byBlock.get(key) ?? []), variable])
    }

    for (const [key, variables] of byBlock) {
      const block = scanned.blocks.find((candidate) => parsedBlockKey(candidate) === key)
      if (block) {
        const indent = block.declarations.length > 0 ? indentOf(source, block.declarations[0]) : '    '
        const lineStart = source.lastIndexOf('\n', block.endVarSpan.start - 1) + 1
        edits.push({
          span: { start: lineStart, end: lineStart },
          replacement: variables.map((variable) => `${renderDeclaration(variable, indent)}\n`).join(''),
        })
      } else {
        // No block of this class yet. Serialising just these variables gives a
        // correctly-shaped `VAR … END_VAR` pair without disturbing the rest.
        const appended = generateIecVariablesToString(variables)
        edits.push({
          span: { start: source.length, end: source.length },
          replacement: `${source.endsWith('\n') ? '' : '\n'}${appended}\n`,
        })
      }
    }
  }

  const patched = edits.length > 0 ? applyEdits(source, edits) : source

  // 4. Order. Handled after the field edits, by moving whole declaration lines
  //    between the slots they already occupy, so comments sitting on their own
  //    lines stay where the user put them rather than following a variable
  //    around.
  return reorderDeclarations(patched, nextVariables, context)
}

/**
 * Put the declaration lines back in the model's order.
 *
 * Only lines that hold a declaration move; anything between them — a comment,
 * a blank line — is left alone. A no-op when the order already matches, which
 * is the overwhelmingly common case.
 *
 * Ordering is resolved per block, against the variables of that same class and
 * flag, rather than against the flattened model: two blocks may legitimately be
 * reordered independently, and a global index lets one block's positions decide
 * another's.
 *
 * A block whose declaration names are not unique is skipped outright. A name is
 * the only identity a declaration has here, so with a duplicate the matching is
 * ambiguous and the move silently overwrites one declaration with the other —
 * `a : INT; a : DINT;` came back as `a : INT; a : INT;`. `validateVariableSet`
 * refuses duplicates, but this runs on text that has not necessarily been
 * through it (a hand-edited project file, a buffer mid-edit), and rewriting a
 * declaration the user did not touch is the exact failure this whole change
 * exists to remove. Leaving the order alone loses nothing, and the duplicate is
 * still reported by the validator.
 */
function reorderDeclarations(text: string, nextVariables: PLCVariable[], context: TypeContext): string {
  const scanned = parseVariableDeclarations(text, context)
  if (scanned.errors.length > 0) return text

  const edits: TextEdit[] = []

  for (const block of scanned.blocks) {
    if (block.declarations.length < 2) continue

    const current = block.declarations.map((declaration) => declaration.variable.name.toLowerCase())
    if (new Set(current).size !== current.length) continue

    const wanted = nextVariables
      .filter((variable) => blockKey(variable) === parsedBlockKey(block))
      .map((variable) => variable.name.toLowerCase())
    if (new Set(wanted).size !== wanted.length) continue

    // A declaration the model no longer mentions has no position to sort to.
    // Deletion has already removed the ones that went away, so anything still
    // unmatched here means the two views disagree, and the order is not ours
    // to guess.
    if (current.some((name) => !wanted.includes(name))) continue

    const target = [...current].sort((a, b) => wanted.indexOf(a) - wanted.indexOf(b))
    if (current.every((name, index) => name === target[index])) continue

    const lines = block.declarations.map((declaration) =>
      text.slice(declaration.lineSpan.start, declaration.lineSpan.end),
    )
    target.forEach((name, index) => {
      const from = current.indexOf(name)
      if (from === index) return
      edits.push({ span: block.declarations[index].lineSpan, replacement: lines[from] })
    })
  }

  return edits.length > 0 ? applyEdits(text, edits) : text
}

/**
 * Rewrite every alias-bound `AT` operand in `text` to the literal address it
 * resolves to, leaving every other byte alone.
 *
 * For the LSP stub. STruC++ does not know what `AT Motor Start` means, and one
 * unresolved alias breaks the VAR block, taking every symbol after it out of
 * the POU's scope — no autocomplete, red boxes in the graphical editors. The
 * stub used to sidestep that by being regenerated from the model, which is
 * also why the code buffer had to be re-canonicalised to match it, which is
 * what deleted the user's comments (DOPE-650).
 *
 * Substituting in place instead means the stub is the user's own text with
 * only the alias operands swapped, so the buffer and the synthesised document
 * agree byte for byte without anything being rewritten.
 *
 * `resolve` returns the literal address, or `''` for an alias no producer
 * declares any more — in which case the whole `AT` clause is dropped, exactly
 * as the compile-time snapshot does with an orphaned alias.
 *
 * Line-count invariant: only ever rewrites within a declaration line, never
 * adds or removes one, so `bodyLineOffset` and the `pouvars://` diagnostics
 * mirror stay correct.
 */
export function resolveLocationsInText(
  text: string,
  resolve: (location: string) => string,
  context: TypeContext = {},
): string {
  const scanned = parseVariableDeclarations(text, context)
  if (scanned.errors.length > 0) return text

  const edits: TextEdit[] = []
  // One edit per location span. A declaration naming several variables is
  // reported once per name, and every one of those carries the SAME location
  // span, so an unguarded loop queued the same edit twice — and `applyEdits`
  // works in original offsets, so the second splice landed in text the first
  // had already changed. Dropping an alias off `a, b : BOOL AT Ghost;` took the
  // semicolon and `END_VAR` with it. Unlike `applyVariablesToText` this runs on
  // whatever text it is handed, including a file that has never been normalised.
  const seen = new Set<number>()
  for (const block of scanned.blocks) {
    for (const declaration of block.declarations) {
      const span = declaration.fields.location
      if (!span || seen.has(span.start)) continue
      seen.add(span.start)
      const current = text.slice(span.start, span.end)
      const resolved = resolve(current)
      if (resolved === current) continue
      edits.push(
        resolved === ''
          ? { span: { start: findClauseStart(text, span, 'AT'), end: span.end }, replacement: '' }
          : { span, replacement: resolved },
      )
    }
  }

  return edits.length > 0 ? applyEdits(text, edits) : text
}
