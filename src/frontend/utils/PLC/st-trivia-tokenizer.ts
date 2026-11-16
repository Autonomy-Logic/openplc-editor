/**
 * Splits a line of Structured Text into comment, string and source spans, with the compiler's own
 * rules: block comments nest at any depth, a line comment runs to the end of the line, and a string
 * literal ends only at an unescaped quote, where IEC escapes with a dollar sign or a doubled quote.
 */

export interface StTriviaState {
  commentDepth: number
  openQuote: "'" | '"' | null
}

export type StTriviaScope = 'comment' | 'string' | 'source'

export interface StTriviaToken {
  startIndex: number
  scope: StTriviaScope
}

export interface StTriviaLine {
  tokens: StTriviaToken[]
  endState: StTriviaState
}

export const initialStTriviaState = (): StTriviaState => ({ commentDepth: 0, openQuote: null })

export function tokenizeStTriviaLine(line: string, state: StTriviaState): StTriviaLine {
  const tokens: StTriviaToken[] = []
  let commentDepth = state.commentDepth
  let openQuote = state.openQuote
  let index = 0

  const open = (startIndex: number, scope: StTriviaScope) => {
    const last = tokens[tokens.length - 1]
    if (last && last.scope === scope) return
    if (last && last.startIndex === startIndex) {
      const previous = tokens[tokens.length - 2]
      if (previous && previous.scope === scope) {
        tokens.pop()
        return
      }
      last.scope = scope
      return
    }
    tokens.push({ startIndex, scope })
  }

  while (index < line.length) {
    if (commentDepth > 0) {
      open(index, 'comment')
      if (line.startsWith('(*', index)) {
        commentDepth += 1
        index += 2
        continue
      }
      if (line.startsWith('*)', index)) {
        commentDepth -= 1
        index += 2
        if (commentDepth === 0) open(index, 'source')
        continue
      }
      index += 1
      continue
    }

    if (openQuote !== null) {
      open(index, 'string')
      const char = line[index]
      if (char === '$') {
        index += 2
        continue
      }
      if (char === openQuote) {
        if (line[index + 1] === openQuote) {
          index += 2
          continue
        }
        openQuote = null
        index += 1
        open(index, 'source')
        continue
      }
      index += 1
      continue
    }

    if (line.startsWith('(*', index)) {
      open(index, 'comment')
      commentDepth = 1
      index += 2
      continue
    }

    if (line.startsWith('//', index)) {
      open(index, 'comment')
      index = line.length
      continue
    }

    const char = line[index]
    if (char === "'" || char === '"') {
      open(index, 'string')
      openQuote = char
      index += 1
      continue
    }

    open(index, 'source')
    index += 1
  }

  while (line.length > 0 && tokens.length > 0 && tokens[tokens.length - 1].startIndex >= line.length) tokens.pop()
  if (tokens.length === 0) tokens.push({ startIndex: 0, scope: 'source' })
  if (tokens[0].startIndex !== 0) tokens.unshift({ startIndex: 0, scope: 'source' })

  return { tokens, endState: { commentDepth, openQuote } }
}
