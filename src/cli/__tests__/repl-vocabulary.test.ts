/**
 * The REPL and the subcommands are two front ends over one session protocol, so
 * a verb that works in one has to work in the other. It did not: `debug read x`
 * was fine as a subcommand and `read x` was rejected as unknown inside
 * `debug exec` / the REPL, which spelled the same operations `vars` and `get`
 * (the `strucpp` vocabulary this REPL deliberately mirrors).
 *
 * Both spellings are kept — one for the muscle memory of each surface — and
 * these tests hold them to the SAME protocol request, which is the only thing
 * that must not fork.
 *
 * `set` / `write` are deliberately NOT among them: the protocol has no
 * soft-write verb, because the wire has no way to express one (FC 0x42 carries
 * a force flag, so force=0 is an UNFORCE and discards the value). Both
 * spellings must now be rejected outright rather than quietly forcing or
 * unforcing something.
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
  ])('%s and %s produce the same request', (terse, canonical) => {
    expect(requestFor(terse)).toEqual(requestFor(canonical))
  })

  it('names the verb the caller actually typed when the arguments are wrong', () => {
    expect(parseReplLine('read', 1)).toEqual({ error: 'read needs at least one variable name' })
    expect(parseReplLine('get', 1)).toEqual({ error: 'get needs at least one variable name' })
  })

  it.each(['write main:blink true', 'set main:blink true'])(
    'rejects "%s" — there is no soft-write verb on the wire',
    (line) => {
      const verb = line.split(' ')[0]
      expect(parseReplLine(line, 1)).toEqual({ error: `Unknown command "${verb}" — type help` })
    },
  )

  it('still rejects a verb that is neither', () => {
    expect(parseReplLine('compile', 1)).toEqual({ error: 'Unknown command "compile" — type help' })
  })

  it('is case-insensitive on both spellings, as it always was on the terse one', () => {
    expect(requestFor('READ main:blink')).toEqual(requestFor('get main:blink'))
    expect(requestFor('List-Vars')).toEqual(requestFor('vars'))
  })
})
