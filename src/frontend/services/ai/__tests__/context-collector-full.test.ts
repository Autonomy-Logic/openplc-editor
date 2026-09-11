import { describe, expect, it } from '@jest/globals'

import { collectFullProjectContext, isGraphicalLanguage } from '../context-collector'

// -- helpers ------------------------------------------------------------------

type TestPou = {
  name: string
  pouType: string
  interface?: { variables: Array<{ name: string; class?: string; type: { value: string; definition?: string } }> }
  body: { language: string; value: unknown }
}

function makeState(overrides: {
  pous?: TestPou[]
  dataTypes?: unknown[]
  globalVariables?: Array<{ name: string; type: { value: string } }>
  tasks?: Array<{ name: string; triggering: string }>
}) {
  return {
    project: {
      data: {
        pous: overrides.pous ?? [],
        dataTypes: overrides.dataTypes ?? [],
        configurations: {
          resource: {
            globalVariables: overrides.globalVariables ?? [],
            tasks: overrides.tasks ?? [],
          },
        },
      },
    },
  } as unknown as ReturnType<typeof import('../../../store').openPLCStoreBase.getState>
}

/** A body long enough that the old 35 %-of-budget cap would have cut it. */
function longBody(marker: string, chars = 4000): string {
  const line = `  (* ${marker} *) counter := counter + 1;\n`
  return line.repeat(Math.ceil(chars / line.length))
}

// -- tests --------------------------------------------------------------------

describe('isGraphicalLanguage', () => {
  it.each(['ld', 'fbd', 'sfc'])('treats %s as graphical', (lang) => {
    expect(isGraphicalLanguage(lang)).toBe(true)
  })

  it.each(['st', 'il', 'python', 'cpp'])('treats %s as textual', (lang) => {
    expect(isGraphicalLanguage(lang)).toBe(false)
  })
})

describe('collectFullProjectContext', () => {
  it('returns an empty string for an empty project', () => {
    expect(collectFullProjectContext(makeState({}), null)).toBe('')
  })

  // The regression this whole change exists for: a 12-POU library whose
  // bodies were each cut to ~700 chars mid-statement.
  it('never truncates POU bodies, however many POUs there are', () => {
    const pous: TestPou[] = Array.from({ length: 12 }, (_, i) => ({
      name: `FB${i}`,
      pouType: 'function-block',
      interface: { variables: [{ name: 'counter', class: 'local', type: { value: 'INT' } }] },
      body: { language: 'st', value: longBody(`FB${i}`) },
    }))

    const result = collectFullProjectContext(makeState({ pous }), null)

    // Every body present in full, and no truncation marker anywhere.
    for (const pou of pous) {
      // `getTextualBody` trims; the point is that nothing in the middle is lost.
      expect(result).toContain((pou.body.value as string).trim())
    }
    expect(result).not.toContain('(* ... *)')
    expect(result).not.toContain('# ...')
  })

  it('includes every POU in the project, not a subset', () => {
    const pous: TestPou[] = Array.from({ length: 30 }, (_, i) => ({
      name: `P${i}`,
      pouType: 'function',
      body: { language: 'st', value: longBody(`P${i}`, 2000) },
    }))

    const result = collectFullProjectContext(makeState({ pous }), null)
    for (const pou of pous) {
      expect(result).toContain(`FUNCTION ${pou.name} [st]`)
    }
  })

  it('puts the active POU first and labels it', () => {
    const state = makeState({
      pous: [
        { name: 'Other', pouType: 'function', body: { language: 'st', value: 'a := 1;' } },
        { name: 'Main', pouType: 'program', body: { language: 'st', value: 'b := 2;' } },
      ],
    })

    const result = collectFullProjectContext(state, 'Main')
    expect(result.indexOf('Active POU: Main')).toBeLessThan(result.indexOf('FUNCTION Other'))
    // The active POU is not repeated in the "every other POU" pass.
    expect(result.match(/Main/g)?.length).toBe(1)
  })

  it('ignores an active POU name that does not exist', () => {
    const state = makeState({ pous: [{ name: 'A', pouType: 'program', body: { language: 'st', value: 'x := 1;' } }] })
    const result = collectFullProjectContext(state, 'Ghost')
    expect(result).not.toContain('Active POU')
    expect(result).toContain('PROGRAM A [st]')
  })

  it('renders variables for the active POU and for the others', () => {
    const state = makeState({
      pous: [
        {
          name: 'Main',
          pouType: 'program',
          interface: { variables: [{ name: 'trigger', class: 'input', type: { value: 'BOOL' } }] },
          body: { language: 'st', value: 'x := 1;' },
        },
        {
          name: 'Helper',
          pouType: 'function-block',
          interface: { variables: [{ name: 'result', class: 'output', type: { value: 'INT' } }] },
          body: { language: 'st', value: 'y := 2;' },
        },
      ],
    })

    const result = collectFullProjectContext(state, 'Main')
    expect(result).toContain('trigger : BOOL;')
    expect(result).toContain('result : INT;')
  })

  describe('graphical POUs', () => {
    const graphicalState = () =>
      makeState({
        pous: [
          { name: 'Rungs', pouType: 'program', body: { language: 'ld', value: { rungs: [{ x: 1, y: 2 }] } } },
          { name: 'Blocks', pouType: 'function-block', body: { language: 'fbd', value: { nodes: [] } } },
        ],
      })

    it('substitutes the transpiled ST equivalent when supplied', () => {
      const graphicalSt = new Map([
        ['Rungs', 'PROGRAM Rungs\n  motor := start AND NOT stop;\nEND_PROGRAM'],
        ['Blocks', 'FUNCTION_BLOCK Blocks\n  out := in1 + in2;\nEND_FUNCTION_BLOCK'],
      ])

      const result = collectFullProjectContext(graphicalState(), null, { graphicalSt })
      expect(result).toContain('motor := start AND NOT stop;')
      expect(result).toContain('out := in1 + in2;')
      expect(result).toContain('LD diagram — transpiled ST equivalent')
      expect(result).toContain('FBD diagram — transpiled ST equivalent')
      // The raw flow graph must never reach the model.
      expect(result).not.toContain('rungs')
    })

    it('points at read_pou_body when no ST is available', () => {
      const result = collectFullProjectContext(graphicalState(), null)
      expect(result).toContain('ST equivalent unavailable; call read_pou_body("Rungs")')
      expect(result).toContain('ST equivalent unavailable; call read_pou_body("Blocks")')
    })

    it('points at read_pou_body when the map holds only whitespace', () => {
      const graphicalSt = new Map([['Rungs', '   \n  ']])
      const result = collectFullProjectContext(graphicalState(), null, { graphicalSt })
      expect(result).toContain('ST equivalent unavailable; call read_pou_body("Rungs")')
    })

    it('applies the same substitution to the active POU', () => {
      const graphicalSt = new Map([['Rungs', 'PROGRAM Rungs\n  a := b;\nEND_PROGRAM']])
      const result = collectFullProjectContext(graphicalState(), 'Rungs', { graphicalSt })
      expect(result).toContain('Active POU: Rungs')
      expect(result).toContain('a := b;')
    })
  })

  it('includes globals, data types and tasks', () => {
    const state = makeState({
      pous: [{ name: 'Main', pouType: 'program', body: { language: 'st', value: 'x := 1;' } }],
      globalVariables: [{ name: 'GV', type: { value: 'BOOL' } }],
      dataTypes: [{ name: 'Mode', derivation: 'enumerated', values: [{ description: 'AUTO' }] }],
      tasks: [{ name: 'Fast', triggering: 'Cyclic' }],
    })

    const result = collectFullProjectContext(state, 'Main')
    expect(result).toContain('GV : BOOL;')
    expect(result).toContain('Mode')
    expect(result).toContain('Tasks: Fast (Cyclic)')
  })

  it('omits empty sections rather than emitting bare headers', () => {
    const state = makeState({
      pous: [{ name: 'Main', pouType: 'program', body: { language: 'st', value: 'x := 1;' } }],
    })
    const result = collectFullProjectContext(state, 'Main')
    expect(result).not.toContain('Global Variables')
    expect(result).not.toContain('User Data Types')
    expect(result).not.toContain('Tasks:')
  })

  it('formats in the requested language dialect', () => {
    const state = makeState({
      pous: [
        {
          name: 'PyBlock',
          pouType: 'function-block',
          interface: { variables: [{ name: 'v', class: 'input', type: { value: 'INT' } }] },
          body: { language: 'python', value: 'v = 1' },
        },
      ],
    })

    const result = collectFullProjectContext(state, null, { language: 'python' })
    expect(result).toContain('#')
    expect(result).toContain('v = 1')
  })

  it('handles a POU whose body is empty', () => {
    const state = makeState({
      pous: [{ name: 'Empty', pouType: 'program', body: { language: 'st', value: '   ' } }],
    })
    const result = collectFullProjectContext(state, null)
    expect(result).toContain('PROGRAM Empty [st]')
  })
})
