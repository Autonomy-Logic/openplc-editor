/**
 * `keywords` publishes what `apply` enforces, so an author can check a name
 * before spending a compile on it.
 *
 * The rule it exists for: a name that collides is refused by `apply`, and one
 * that slips through a gap in the list compiles into a generated file that will
 * not parse — `TYPE MODE_T : (OFF, ON)` produced
 * `error: Expected Identifier, found ON`, which points at code nobody wrote.
 */

import { isLegalIdentifier } from '@root/frontend/utils/keywords'

import { runKeywords } from '../commands/keywords'
import { Reporter, type WriterStreams } from '../output'

const run = (flags: Record<string, unknown> = {}) => {
  const out: string[] = []
  const streams: WriterStreams = { out: (text) => out.push(text), err: () => {} }
  runKeywords({ positionals: [], flags } as never, new Reporter({ mode: 'json', streams }))
  return JSON.parse(out[0]) as { ok: boolean; keywords: string[]; rules?: string[] }
}

describe('the published reserved words', () => {
  it('is the list apply actually checks, not a copy', () => {
    // Every published word must be refused, or the list is advice rather than
    // the rule.
    const refused = run().keywords.filter((word) => !isLegalIdentifier(word)[0])
    expect(refused).toEqual(run().keywords)
  })

  it('includes ON, which the compiler reserves and this list once missed', () => {
    expect(run().keywords).toContain('ON')
  })

  it('names each word once', () => {
    const words = run().keywords
    expect(words).toEqual([...new Set(words)])
  })

  it('is sorted, so two runs diff cleanly', () => {
    const words = run().keywords
    expect(words).toEqual([...words].sort((a, b) => a.localeCompare(b)))
  })

  it('carries the shape rules too, since a legal name has to pass both', () => {
    expect(run().rules?.length).toBeGreaterThan(0)
  })

  it('answers names only when asked', () => {
    const result = run({ 'names-only': true })
    expect(result.keywords.length).toBeGreaterThan(0)
    expect(result.rules).toBeUndefined()
  })
})
