/** Block comment still open at the end of a line: paren-star, slash-star or none. */
export type BlockCommentState = false | 'paren' | 'slash'

/** Blanks ST/IL comments in one line, carrying an open block comment to the next. */
export function stripLineComments(
  line: string,
  state: BlockCommentState,
): { stripped: string; state: BlockCommentState } {
  const chars = [...line]
  let i = 0
  let s = state

  while (i < chars.length) {
    if (s) {
      const endMarker = s === 'paren' ? ')' : '/'
      if (chars[i] === '*' && chars[i + 1] === endMarker) {
        chars[i] = ' '
        chars[i + 1] = ' '
        i += 2
        s = false
      } else {
        chars[i] = ' '
        i++
      }
    } else {
      if (chars[i] === '/' && chars[i + 1] === '/') {
        for (let j = i; j < chars.length; j++) chars[j] = ' '
        break
      }
      if (chars[i] === '(' && chars[i + 1] === '*') {
        chars[i] = ' '
        chars[i + 1] = ' '
        i += 2
        s = 'paren'
      } else if (chars[i] === '/' && chars[i + 1] === '*') {
        chars[i] = ' '
        chars[i + 1] = ' '
        i += 2
        s = 'slash'
      } else {
        i++
      }
    }
  }

  return { stripped: chars.join(''), state: s }
}

/** Where one inline debug value goes: after `expr` on a 1-based line, columns [startCol, endCol). */
export type DebugInlinePosition = { expr: string; line: number; startCol: number; endCol: number }

/**
 * Inline debug value positions on the visible lines of an ST/IL body: the first match of each
 * expression per line, longest expressions first, without overlaps, outside comments.
 *
 * @param getLine - Text of a 1-based line
 * @param lineCount - Number of lines in the body
 * @param ranges - Visible 1-based inclusive line ranges
 * @param exprs - Candidate expressions (debug keys without their POU prefix)
 */
export function findDebugInlinePositions(
  getLine: (lineNumber: number) => string,
  lineCount: number,
  ranges: Array<[number, number]>,
  exprs: Iterable<string>,
): DebugInlinePosition[] {
  const lastLine = Math.min(lineCount, Math.max(0, ...ranges.map(([, to]) => to)))
  const visible = new Uint8Array(lastLine + 1)
  for (const [from, to] of ranges)
    for (let line = Math.max(1, from); line <= Math.min(lastLine, to); line++) visible[line] = 1

  const lines: Array<{ lineNumber: number; stripped: string }> = []
  let state: BlockCommentState = false
  for (let lineNumber = 1; lineNumber <= lastLine; lineNumber++) {
    const result = stripLineComments(getLine(lineNumber), state)
    state = result.state
    if (visible[lineNumber]) lines.push({ lineNumber, stripped: result.stripped })
  }
  if (lines.length === 0) return []

  const words = new Set<string>()
  for (const { stripped } of lines)
    for (const [word] of stripped.matchAll(/[A-Za-z_]\w*/g)) words.add(word.toUpperCase())
  const textUpper = lines.map(({ stripped }) => stripped.toUpperCase()).join('\n')

  const candidates: string[] = []
  for (const expr of exprs) {
    const lead = /^[A-Za-z_]\w*/.exec(expr)?.[0]
    if (lead && words.has(lead.toUpperCase()) && textUpper.includes(expr.toUpperCase())) candidates.push(expr)
  }
  candidates.sort((a, b) => b.length - a.length)
  const patterns = candidates.map((expr) => ({
    expr,
    pattern: new RegExp(`\\b${expr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.\\[])`, 'gi'),
  }))

  const positions: DebugInlinePosition[] = []
  for (const { lineNumber, stripped } of lines) {
    const claimed: Array<[number, number]> = []
    for (const { expr, pattern } of patterns) {
      pattern.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = pattern.exec(stripped)) !== null) {
        const startCol = match.index + 1
        const endCol = startCol + match[0].length
        if (claimed.some(([s, e]) => startCol < e && endCol > s)) continue
        claimed.push([startCol, endCol])
        positions.push({ expr, line: lineNumber, startCol, endCol })
        break
      }
    }
  }
  return positions
}
