// Replaces comment regions with spaces so column positions are preserved.
// Tracks block comment state across lines: (*..*), /*..*/, and // line comments.
type BlockCommentState = false | 'paren' | 'slash'

function stripLineComments(line: string, state: BlockCommentState): { stripped: string; state: BlockCommentState } {
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

export { type BlockCommentState, stripLineComments }
