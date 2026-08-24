/**
 * The REPL and the subcommands are two front ends over one session protocol, so
 * a verb that works in one has to work in the other. It did not: `debug read x`
 * was fine as a subcommand and `read x` was rejected as unknown inside
 * `debug exec` / the REPL, which spelled the same three operations `vars`,
 * `get` and `set` (the `strucpp` vocabulary this REPL deliberately mirrors).
 *
 * Both spellings are kept — one for the muscle memory of each surface — and
 * these tests hold them to the SAME protocol request, which is the only thing
 * that must not fork.
 */

import { parseReplLine } from '../commands/debug'

const requestFor = (line: string) => {
  const parsed = parseReplLine(line, 1)
  if (parsed === null || parsed === 'quit' || parsed === 'help' || 'error' in parsed) {
    throw new Error(`expected a request for "${line}", got ${JSON.stringify(parsed)}`)
  }
  return parsed.request
}

describe('parseReplLine — one operation, either spelling', () => {
  it.each([
    ['vars', 'list-vars'],
    ['get main:blink', 'read main:blink'],
    ['set main:blink true', 'write main:blink true'],
  ])('%s and %s produce the same request', (terse, canonical) => {
    expect(requestFor(terse)).toEqual(requestFor(canonical))
  })

  it('names the verb the caller actually typed when the arguments are wrong', () => {
    expect(parseReplLine('read', 1)).toEqual({ error: 'read needs at least one variable name' })
    expect(parseReplLine('get', 1)).toEqual({ error: 'get needs at least one variable name' })
    expect(parseReplLine('write main:blink', 1)).toEqual({ error: 'write needs a variable name and a value' })
    expect(parseReplLine('set main:blink', 1)).toEqual({ error: 'set needs a variable name and a value' })
  })

  it('still rejects a verb that is neither', () => {
    expect(parseReplLine('compile', 1)).toEqual({ error: 'Unknown command "compile" — type help' })
  })

  it('is case-insensitive on both spellings, as it always was on the terse one', () => {
    expect(requestFor('READ main:blink')).toEqual(requestFor('get main:blink'))
    expect(requestFor('List-Vars')).toEqual(requestFor('vars'))
  })
})
