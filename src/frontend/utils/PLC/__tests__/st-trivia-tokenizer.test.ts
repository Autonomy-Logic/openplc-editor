import { blankTrivia } from '../variable-declarations'
import { type StTriviaState, tokenizeStTriviaLine } from '../st-trivia-tokenizer'

const INITIAL: StTriviaState = { commentDepth: 0, openQuote: null }

/** Scopes of a whole source, one entry per character, by running the tokenizer line by line. */
function scopesOf(source: string): string[] {
  const scopes: string[] = []
  let state = INITIAL

  for (const line of source.split('\n')) {
    const { tokens, endState } = tokenizeStTriviaLine(line, state)
    for (let index = 0; index < line.length; index++) {
      const token = [...tokens].reverse().find((candidate) => candidate.startIndex <= index)
      scopes.push(token?.scope ?? 'source')
    }
    scopes.push('\n')
    state = endState
  }

  return scopes
}

/**
 * The oracle: `blankTrivia` blanks exactly what the compiler ignores, so a character it blanked
 * must be inside a comment or a string, and one it left alone must not be.
 */
function blankedByOracle(source: string): boolean[] {
  const blanked = blankTrivia(source)
  return [...source].map((char, index) => char !== ' ' && blanked[index] === ' ')
}

function disagreements(source: string): string[] {
  const scopes = scopesOf(source)
  const blanked = blankedByOracle(source)
  const problems: string[] = []

  for (let index = 0; index < source.length; index++) {
    if (source[index] === '\n' || source[index] === ' ') continue
    const trivia = scopes[index] === 'comment' || scopes[index] === 'string'
    // The oracle keeps a string's own quotes, so a quote is trivia for it only inside a comment.
    const isQuote = source[index] === "'" || source[index] === '"'
    if (isQuote && scopes[index] === 'string') continue
    if (trivia !== blanked[index]) {
      problems.push(`index ${index} (${JSON.stringify(source[index])}): scope ${scopes[index]}`)
    }
  }

  return problems
}

const AS3_BODY = [
  '(* ref *)',
  'Q1 := FALSE;',
  ...Array.from({ length: 101 }, () => '(*'),
  ...Array.from({ length: 100 }, () => '*)'),
  'Q1 := TRUE;',
].join('\n')

const AS4_LINES = ["s := 'a$'(*';", "s := 'a''(*';", 'ws := "a$"(*";']

describe('tokenizeStTriviaLine agrees with the compiler oracle', () => {
  it.each([
    ['a nested comment that is still open', '(* a (* b *) x := 1;'],
    ['a line comment', 'x := 1; // (* not a comment opener\ny := 2;'],
    ['a string holding a line comment', "s := 'http://x';\ny := 2;"],
    ['a comment spanning lines', '(* one\ntwo *)\nx := 1;'],
    ['a string spanning no line', "s := 'a';\nx := 1;"],
    ['a comment opener inside a string', "s := '(*';\nx := 1;"],
  ])('%s', (_label, source) => {
    expect(disagreements(source)).toEqual([])
  })

  it.each(AS4_LINES)('AS4: %s leaves the next line as code', (line) => {
    const source = `(* ref *)\nQ1 := FALSE;\n${line}\nQ1 := TRUE;`

    expect(disagreements(source)).toEqual([])
    expect(scopesOf(source).join('').includes('\n')).toBe(true)
    const lastLineStart = source.lastIndexOf('Q1 := TRUE;')
    expect(scopesOf(source)[lastLineStart]).toBe('source')
  })

  it('AS3: a comment nested past a hundred levels keeps the rest commented', () => {
    const scopes = scopesOf(AS3_BODY)
    const lastLineStart = AS3_BODY.lastIndexOf('Q1 := TRUE;')

    expect(scopes[lastLineStart]).toBe('comment')
    expect(scopes[AS3_BODY.indexOf('Q1 := FALSE;')]).toBe('source')
  })
})

describe('tokenizeStTriviaLine state', () => {
  it('leaves one comment open after a nested opener closes once', () => {
    const { endState } = tokenizeStTriviaLine('(* a (* b *)', INITIAL)

    expect(endState).toEqual({ commentDepth: 1, openQuote: null })
  })

  it('closes the comment when every level closes', () => {
    const { endState } = tokenizeStTriviaLine('(* a (* b *) *)', INITIAL)

    expect(endState).toEqual({ commentDepth: 0, openQuote: null })
  })

  it('counts a nesting far past the tokenizer stack limit', () => {
    const { endState } = tokenizeStTriviaLine('(*'.repeat(10_000), INITIAL)

    expect(endState.commentDepth).toBe(10_000)
  })

  it('carries an unterminated string to the next line', () => {
    const { endState } = tokenizeStTriviaLine("s := 'a", INITIAL)

    expect(endState).toEqual({ commentDepth: 0, openQuote: "'" })
  })

  it('closes a string carried from the previous line', () => {
    const { endState, tokens } = tokenizeStTriviaLine("b'; x := 1;", { commentDepth: 0, openQuote: "'" })

    expect(endState).toEqual({ commentDepth: 0, openQuote: null })
    expect(tokens[0]).toEqual({ startIndex: 0, scope: 'string' })
  })

  it('does not end a carried string on an escaped quote', () => {
    const { endState } = tokenizeStTriviaLine("b$'; still a string", { commentDepth: 0, openQuote: "'" })

    expect(endState).toEqual({ commentDepth: 0, openQuote: "'" })
  })
})

describe('tokenizeStTriviaLine token shape', () => {
  it('starts at zero, is ordered and never repeats a scope', () => {
    const { tokens } = tokenizeStTriviaLine("x := 1; (* c *) s := 'a'; // tail", INITIAL)

    expect(tokens[0].startIndex).toBe(0)
    for (let index = 1; index < tokens.length; index++) {
      expect(tokens[index].startIndex).toBeGreaterThan(tokens[index - 1].startIndex)
      expect(tokens[index].scope).not.toBe(tokens[index - 1].scope)
    }
  })

  it('gives an empty line one source token', () => {
    expect(tokenizeStTriviaLine('', INITIAL).tokens).toEqual([{ startIndex: 0, scope: 'source' }])
  })
})
