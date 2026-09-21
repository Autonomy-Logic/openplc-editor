/**
 * The save-time backstop (DOPE-650).
 *
 * The store patches `variablesText` on every mutation that goes through its
 * actions, so in practice the text and the model already agree by the time a
 * save happens. This covers the case they do not: a mutation added later that
 * forgets to patch, or one that reaches the variables array by a route nobody
 * anticipated. The text is what gets written, so a disagreement is a change the
 * user made and the file never received.
 */
import type { PLCPou } from '../../../middleware/shared/ports/types'
import { sanitizePou } from '../save-project'

const pou = (variablesText: string, variables: PLCPou['interface'] extends undefined ? never : unknown[]): PLCPou =>
  ({
    name: 'Main',
    pouType: 'program',
    interface: { variables },
    body: { language: 'st', value: '' },
    variablesText,
  }) as PLCPou

const variable = (name: string, type = 'INT') => ({
  name,
  class: 'local' as const,
  type: { definition: 'base-type' as const, value: type },
  location: '',
  documentation: '',
  debug: false,
})

describe('sanitizePou reconciles the text against the model', () => {
  it('leaves the text untouched when the two already agree', () => {
    const text = 'VAR\n  (* mine *)\n  a : INT;\nEND_VAR'
    const result = sanitizePou(pou(text, [variable('a')]), undefined)
    expect(result.variablesText).toBe(text)
  })

  it('patches the text when the model moved without it', () => {
    // The model says DINT, the text still says INT. Saving the text verbatim
    // would drop the change the user made.
    const text = 'VAR\n  (* mine *)\n  a : INT;\nEND_VAR'
    const result = sanitizePou(pou(text, [variable('a', 'DINT')]), undefined)

    expect(result.variablesText).toContain('a : DINT;')
    // Patched, not regenerated: the comment only the text can carry survives.
    expect(result.variablesText).toContain('(* mine *)')
  })

  it('carries an added variable into the text', () => {
    const text = 'VAR\n  a : INT;\nEND_VAR'
    const result = sanitizePou(pou(text, [variable('a'), variable('b', 'BOOL')]), undefined)
    expect(result.variablesText).toContain('b : BOOL;')
  })

  it('preserves unparseable text verbatim, because it is the user unfinished work', () => {
    // The code view is where they will fix it; rewriting it here would destroy
    // the half-typed declaration they are looking at.
    const broken = 'VAR\n  a : ;\nEND_VAR'
    const result = sanitizePou(pou(broken, [variable('a')]), undefined)
    expect(result.variablesText).toBe(broken)
  })

  it('leaves a POU with no text alone', () => {
    const bare = { name: 'M', pouType: 'program', interface: { variables: [] }, body: { language: 'st', value: '' } }
    expect(sanitizePou(bare as PLCPou, undefined).variablesText).toBeUndefined()
  })
})
