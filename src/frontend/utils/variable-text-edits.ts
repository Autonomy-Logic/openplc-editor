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
 * is driven by the scanner's source map; there is no re-serialisation of
 * anything the user already wrote.
 *
 * Pure: text in, text out.
 */

import type { PLCVariable } from '../../middleware/shared/ports/types'
import { generateIecVariablesToString } from './generate-iec-variables-to-string'
import type { ScanContext, ScannedBlock, ScannedDeclaration, Span } from './variable-declaration-scanner'
import { scanVariableDeclarations } from './variable-declaration-scanner'

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

const blockKey = (variable: PLCVariable): string => `${variable.class ?? 'global'}\u0000${variable.flag ?? ''}`
const scannedBlockKey = (block: ScannedBlock): string => `${block.class ?? 'global'}\u0000${block.flag ?? ''}`

/** The declaration's own indentation, so an inserted sibling lines up with it. */
function indentOf(text: string, declaration: ScannedDeclaration): string {
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
  declarations: ScannedDeclaration[],
  nextVariables: PLCVariable[],
): Map<number, ScannedDeclaration> {
  const matched = new Map<number, ScannedDeclaration>()
  const taken = new Set<ScannedDeclaration>()

  const claim = (index: number, declaration: ScannedDeclaration | undefined): boolean => {
    if (!declaration || taken.has(declaration)) return false
    matched.set(index, declaration)
    taken.add(declaration)
    return true
  }

  nextVariables.forEach((variable, index) => {
    if (!variable.id) return
    claim(
      index,
      declarations.find((d) => d.variable.id !== undefined && d.variable.id === variable.id),
    )
  })

  nextVariables.forEach((variable, index) => {
    if (matched.has(index)) return
    claim(
      index,
      declarations.find((d) => !taken.has(d) && sameName(d.variable.name, variable.name)),
    )
  })

  // Positional pass, pairing the leftovers in order: this is the rename case.
  const leftoverDeclarations = declarations.filter((d) => !taken.has(d))
  let cursor = 0
  nextVariables.forEach((variable, index) => {
    if (matched.has(index)) return
    if (blockKey(variable) === undefined) return
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
function editsForDeclaration(text: string, declaration: ScannedDeclaration, variable: PLCVariable): TextEdit[] {
  const edits: TextEdit[] = []
  const current = declaration.variable
  const at = (span: Span) => text.slice(span.start, span.end)

  if (!sameName(current.name, variable.name) || current.name !== variable.name) {
    if (at(declaration.fields.name) !== variable.name) {
      edits.push({ span: declaration.fields.name, replacement: variable.name })
    }
  }

  if (at(declaration.fields.type) !== variable.type.value) {
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
  const before = text.lastIndexOf(keyword, operand.start)
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
export function applyVariablesToText(text: string, nextVariables: PLCVariable[], context: ScanContext = {}): string {
  const scanned = scanVariableDeclarations(text, context)
  if (scanned.errors.length > 0) return generateIecVariablesToString(nextVariables)

  const declarations = scanned.blocks.flatMap((block) => block.declarations)
  const matched = matchDeclarations(declarations, nextVariables)
  const matchedDeclarations = new Set(matched.values())

  const edits: TextEdit[] = []

  // 1. Fields that changed on a declaration that survived.
  nextVariables.forEach((variable, index) => {
    const declaration = matched.get(index)
    if (declaration) edits.push(...editsForDeclaration(text, declaration, variable))
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
      const block = scanned.blocks.find((candidate) => scannedBlockKey(candidate) === key)
      if (block) {
        const indent = block.declarations.length > 0 ? indentOf(text, block.declarations[0]) : '    '
        const lineStart = text.lastIndexOf('\n', block.endVarSpan.start - 1) + 1
        edits.push({
          span: { start: lineStart, end: lineStart },
          replacement: variables.map((variable) => `${renderDeclaration(variable, indent)}\n`).join(''),
        })
      } else {
        // No block of this class yet. Serialising just these variables gives a
        // correctly-shaped `VAR … END_VAR` pair without disturbing the rest.
        const appended = generateIecVariablesToString(variables)
        edits.push({
          span: { start: text.length, end: text.length },
          replacement: `${text.endsWith('\n') ? '' : '\n'}${appended}\n`,
        })
      }
    }
  }

  const patched = edits.length > 0 ? applyEdits(text, edits) : text

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
 */
function reorderDeclarations(text: string, nextVariables: PLCVariable[], context: ScanContext): string {
  const scanned = scanVariableDeclarations(text, context)
  if (scanned.errors.length > 0) return text

  const wanted = nextVariables.map((variable) => variable.name.toLowerCase())
  const edits: TextEdit[] = []

  for (const block of scanned.blocks) {
    if (block.declarations.length < 2) continue

    const current = block.declarations.map((declaration) => declaration.variable.name.toLowerCase())
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
  context: ScanContext = {},
): string {
  const scanned = scanVariableDeclarations(text, context)
  if (scanned.errors.length > 0) return text

  const edits: TextEdit[] = []
  for (const block of scanned.blocks) {
    for (const declaration of block.declarations) {
      const span = declaration.fields.location
      if (!span) continue
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
