/**
 * Text-manipulation helpers — mirrors python's `ReIndentText`
 * (`PLCGenerator.py:66`) and the `Compute*Name` family in
 * `plcopen/types_enums.py:112-132`.
 */

/**
 * Reindent every line of `text` to `nbSpaces` leading spaces.
 *
 * Behavior (exact port of `PLCGenerator.py:66-86`):
 *   1. Split on newlines.
 *   2. Find the first non-blank line (`.strip() != ""`).
 *   3. Count its leading spaces.
 *   4. Build an `indent` string of `max(nbSpaces - leadingSpaces, 0)` spaces.
 *   5. For every line, prepend `indent` (but emit empty lines as just `"\n"`).
 *   6. Always append `"\n"` after each non-empty line.
 *
 * The function returns `""` when given an entirely blank input.
 */
export function reIndentText(text: string, nbSpaces: number): string {
  let compute = ''
  const lines = pySplitLines(text)
  if (lines.length === 0) return compute

  let lineNum = 0
  while (lineNum < lines.length && lines[lineNum].trim().length === 0) {
    lineNum++
  }
  if (lineNum >= lines.length) return compute

  let spaces = 0
  const firstNonBlank = lines[lineNum]
  while (spaces < firstNonBlank.length && firstNonBlank.charAt(spaces) === ' ') {
    spaces++
  }
  let indent = ''
  for (let i = spaces; i < nbSpaces; i++) indent += ' '

  for (const line of lines) {
    if (line !== '') {
      compute += `${indent}${line}\n`
    } else {
      compute += '\n'
    }
  }
  return compute
}

/**
 * Mirror of Python's `str.splitlines()` for the line separators we encounter.
 *
 * Key difference from `String.prototype.split('\n')`: Python drops the final
 * empty element when the string ends with a separator. PLCOpen-loaded text
 * is normalized to `\n` by lxml, so we only need to handle that form here.
 */
function pySplitLines(text: string): string[] {
  if (text.length === 0) return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** `"P::" + name` — POU-tagged identifier used as the first field of a
 *  Program-chunk location tuple. */
export function computePouName(name: string): string {
  return `P::${name}`
}

/** `"C::" + name`. */
export function computeConfigurationName(name: string): string {
  return `C::${name}`
}

/** `"R::" + config + "::" + resource`
 *  (`plcopen/types_enums.py:132`). */
export function computeConfigurationResourceName(config: string, resource: string): string {
  return `R::${config}::${resource}`
}
