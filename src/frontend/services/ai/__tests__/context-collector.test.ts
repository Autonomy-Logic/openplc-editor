import { describe, expect, it } from '@jest/globals'

import { collectProjectContext } from '../context-collector'

// -- helpers ------------------------------------------------------------------

function makeState(overrides: {
  pous?: Array<{
    name: string
    pouType: string
    interface?: { variables: Array<{ name: string; class?: string; type: { value: string; definition?: string } }> }
    body: { language: string; value: unknown }
  }>
  dataTypes?: unknown[]
  globalVariables?: Array<{ name: string; type: { value: string } }>
}) {
  return {
    project: {
      data: {
        pous: overrides.pous ?? [],
        dataTypes: overrides.dataTypes ?? [],
        configurations: {
          resource: {
            globalVariables: overrides.globalVariables ?? [],
          },
        },
      },
    },
  } as unknown as ReturnType<typeof import('../../../store').openPLCStoreBase.getState>
}

// -- tests --------------------------------------------------------------------

describe('collectProjectContext', () => {
  it('returns empty string when POU not found', () => {
    const state = makeState({ pous: [] })
    expect(collectProjectContext(state, 'Missing', 1000)).toBe('')
  })

  it('formats all variable classes correctly', () => {
    const state = makeState({
      pous: [
        {
          name: 'Main',
          pouType: 'program',
          interface: {
            variables: [
              { name: 'a', class: 'input', type: { value: 'INT' } },
              { name: 'b', class: 'output', type: { value: 'BOOL' } },
              { name: 'c', class: 'inOut', type: { value: 'REAL' } },
              { name: 'd', class: 'external', type: { value: 'DINT' } },
              { name: 'e', class: 'temp', type: { value: 'STRING' } },
              { name: 'f', class: 'local', type: { value: 'TIME' } },
              { name: 'g', type: { value: 'WORD' } }, // no class -> defaults to local/VAR
            ],
          },
          body: { language: 'st', value: 'x := 1;' },
        },
      ],
    })

    const result = collectProjectContext(state, 'Main', 5000)
    expect(result).toContain('VAR_INPUT')
    expect(result).toContain('VAR_OUTPUT')
    expect(result).toContain('VAR_IN_OUT')
    expect(result).toContain('VAR_EXTERNAL')
    expect(result).toContain('VAR_TEMP')
    expect(result).toContain('END_VAR')
    expect(result).toContain('a : INT;')
    expect(result).toContain('g : WORD;')
  })

  it('includes global variables', () => {
    const state = makeState({
      pous: [{ name: 'P', pouType: 'program', interface: { variables: [] }, body: { language: 'st', value: '' } }],
      globalVariables: [{ name: 'GV1', type: { value: 'BOOL' } }],
    })

    const result = collectProjectContext(state, 'P', 5000)
    expect(result).toContain('VAR_GLOBAL')
    expect(result).toContain('GV1 : BOOL;')
  })

  it('includes referenced function blocks with textual body', () => {
    const state = makeState({
      pous: [
        {
          name: 'Main',
          pouType: 'program',
          interface: {
            variables: [{ name: 'fb1', class: 'local', type: { value: 'MyFB', definition: 'user-data-type' } }],
          },
          body: { language: 'st', value: '' },
        },
        {
          name: 'MyFB',
          pouType: 'function-block',
          interface: { variables: [{ name: 'x', class: 'input', type: { value: 'INT' } }] },
          body: { language: 'st', value: 'x := x + 1;' },
        },
      ],
    })

    const result = collectProjectContext(state, 'Main', 5000)
    expect(result).toContain('FUNCTION_BLOCK MyFB')
    expect(result).toContain('x := x + 1;')
  })

  it('includes user data types (enum, struct, array)', () => {
    const state = makeState({
      pous: [{ name: 'P', pouType: 'program', interface: { variables: [] }, body: { language: 'st', value: '' } }],
      dataTypes: [
        { derivation: 'enumerated', name: 'Color', values: [{ description: 'RED' }, { description: 'GREEN' }] },
        {
          derivation: 'structure',
          name: 'Point',
          variable: [
            { name: 'x', type: { value: 'REAL' } },
            { name: 'y', type: { value: 'REAL' } },
          ],
        },
        {
          derivation: 'array',
          name: 'Arr10',
          dimensions: [{ dimension: '0..9' }],
          baseType: { value: 'INT' },
        },
      ],
    })

    const result = collectProjectContext(state, 'P', 5000)
    expect(result).toContain('TYPE Color : (RED, GREEN); END_TYPE')
    expect(result).toContain('TYPE Point : STRUCT')
    expect(result).toContain('TYPE Arr10 : ARRAY [0..9] OF INT; END_TYPE')
  })

  it('includes sibling POUs with body snippet truncation', () => {
    const longBody = 'A'.repeat(400)
    const state = makeState({
      pous: [
        { name: 'Main', pouType: 'program', interface: { variables: [] }, body: { language: 'st', value: '' } },
        {
          name: 'Helper',
          pouType: 'function',
          interface: { variables: [{ name: 'r', class: 'output', type: { value: 'INT' } }] },
          body: { language: 'st', value: longBody },
        },
      ],
    })

    const result = collectProjectContext(state, 'Main', 5000)
    expect(result).toContain('FUNCTION Helper')
    expect(result).toContain('(* ... *)')
  })

  it('respects token budget and stops adding sections', () => {
    // Tiny budget = 2 tokens = 8 chars
    const state = makeState({
      pous: [
        {
          name: 'P',
          pouType: 'program',
          interface: { variables: [{ name: 'v', class: 'local', type: { value: 'INT' } }] },
          body: { language: 'st', value: '' },
        },
      ],
      globalVariables: [{ name: 'Big', type: { value: 'BOOL' } }],
    })

    const result = collectProjectContext(state, 'P', 2)
    // Budget is 8 chars - only the first section (or nothing) should fit
    expect(result.length).toBeLessThanOrEqual(8)
  })

  it('handles getTextualBody for all text languages and ignores non-text', () => {
    const languages = ['st', 'il', 'python', 'cpp'] as const
    for (const lang of languages) {
      const state = makeState({
        pous: [
          { name: 'Main', pouType: 'program', interface: { variables: [] }, body: { language: 'st', value: '' } },
          {
            name: `Sib_${lang}`,
            pouType: 'function',
            interface: { variables: [] },
            body: { language: lang, value: 'code here' },
          },
        ],
      })
      expect(collectProjectContext(state, 'Main', 5000)).toContain('code here')
    }

    // Non-text language (ld) should not include body
    const state = makeState({
      pous: [
        { name: 'Main', pouType: 'program', interface: { variables: [] }, body: { language: 'st', value: '' } },
        {
          name: 'Sib',
          pouType: 'function',
          interface: { variables: [] },
          body: { language: 'ld', value: { nodes: [] } },
        },
      ],
    })
    const result = collectProjectContext(state, 'Main', 5000)
    expect(result).not.toContain('nodes')
  })

  it('handles pou with null interface', () => {
    const state = makeState({
      pous: [{ name: 'P', pouType: 'program', body: { language: 'st', value: '' } }],
    })
    // Should not throw; pouVariables defaults via ?? []
    expect(collectProjectContext(state, 'P', 1000)).toBe('')
  })

  it('handles unknown data type derivation gracefully', () => {
    const state = makeState({
      pous: [{ name: 'P', pouType: 'program', interface: { variables: [] }, body: { language: 'st', value: '' } }],
      dataTypes: [{ derivation: 'subrange', name: 'Sub' }],
    })
    // The unknown derivation returns '' which is filtered by Boolean
    const result = collectProjectContext(state, 'P', 5000)
    expect(result).not.toContain('Sub')
  })

  it('handles getTextualBody with empty string value', () => {
    const state = makeState({
      pous: [
        { name: 'Main', pouType: 'program', interface: { variables: [] }, body: { language: 'st', value: '' } },
        { name: 'Sib', pouType: 'function', interface: { variables: [] }, body: { language: 'st', value: '   ' } },
      ],
    })
    const result = collectProjectContext(state, 'Main', 5000)
    // Whitespace-only body is trimmed to '' which is falsy, so no body section
    expect(result).not.toContain('   ')
  })

  it('handles referenced FB without textual body', () => {
    const state = makeState({
      pous: [
        {
          name: 'Main',
          pouType: 'program',
          interface: {
            variables: [{ name: 'fb1', class: 'local', type: { value: 'GraphFB', definition: 'user-data-type' } }],
          },
          body: { language: 'st', value: '' },
        },
        {
          name: 'GraphFB',
          pouType: 'function-block',
          interface: { variables: [] },
          body: { language: 'ld', value: { nodes: [] } },
        },
      ],
    })
    const result = collectProjectContext(state, 'Main', 5000)
    expect(result).toContain('FUNCTION_BLOCK GraphFB')
  })

  it('stops adding sibling POUs when budget is exceeded', () => {
    const pous: Array<{
      name: string
      pouType: string
      interface: { variables: Array<{ name: string; class?: string; type: { value: string } }> }
      body: { language: string; value: string }
    }> = [{ name: 'Main', pouType: 'program', interface: { variables: [] }, body: { language: 'st', value: '' } }]
    // Add many siblings to exceed budget
    for (let i = 0; i < 10; i++) {
      pous.push({
        name: `Sib${i}`,
        pouType: 'function',
        interface: { variables: [{ name: 'v', class: 'local', type: { value: 'INT' } }] },
        body: { language: 'st', value: 'A'.repeat(200) },
      })
    }
    const state = makeState({ pous })
    // Very small budget - should stop partway through siblings
    const result = collectProjectContext(state, 'Main', 50)
    // At least one sibling should be missing
    expect(result).not.toContain('Sib9')
  })

  it('handles body value that is not a string for textual languages', () => {
    const state = makeState({
      pous: [
        { name: 'Main', pouType: 'program', interface: { variables: [] }, body: { language: 'st', value: '' } },
        { name: 'Sib', pouType: 'function', interface: { variables: [] }, body: { language: 'st', value: 42 } },
      ],
    })
    const result = collectProjectContext(state, 'Main', 5000)
    // Non-string value for st language -> getTextualBody returns null
    expect(result).toContain('FUNCTION Sib')
  })

  it('handles referenced FB with null interface (fb.interface?.variables ?? [])', () => {
    const state = makeState({
      pous: [
        {
          name: 'Main',
          pouType: 'program',
          interface: {
            variables: [{ name: 'fb1', class: 'local', type: { value: 'NoIfFB', definition: 'user-data-type' } }],
          },
          body: { language: 'st', value: '' },
        },
        {
          name: 'NoIfFB',
          pouType: 'function-block',
          body: { language: 'st', value: 'code' },
        },
      ],
    })
    const result = collectProjectContext(state, 'Main', 5000)
    expect(result).toContain('FUNCTION_BLOCK NoIfFB')
  })

  it('stops adding referenced FBs when budget is exceeded', () => {
    const pous: Array<{
      name: string
      pouType: string
      interface?: { variables: Array<{ name: string; class?: string; type: { value: string; definition?: string } }> }
      body: { language: string; value: unknown }
    }> = [
      {
        name: 'Main',
        pouType: 'program',
        interface: {
          variables: [
            { name: 'fb1', class: 'local', type: { value: 'FB1', definition: 'user-data-type' } },
            { name: 'fb2', class: 'local', type: { value: 'FB2', definition: 'user-data-type' } },
          ],
        },
        body: { language: 'st', value: '' },
      },
      {
        name: 'FB1',
        pouType: 'function-block',
        interface: { variables: [{ name: 'x', class: 'input', type: { value: 'INT' } }] },
        body: { language: 'st', value: 'A'.repeat(500) },
      },
      {
        name: 'FB2',
        pouType: 'function-block',
        interface: { variables: [{ name: 'y', class: 'output', type: { value: 'REAL' } }] },
        body: { language: 'st', value: 'B'.repeat(500) },
      },
    ]
    const state = makeState({ pous })
    // Small budget that fits Main variables + globals + maybe FB1 but not FB2's full section
    const result = collectProjectContext(state, 'Main', 60)
    // The referenced FB2 section header should be excluded due to budget
    expect(result).not.toContain('FUNCTION_BLOCK FB2')
  })

  it('handles sibling POU with null interface (sib.interface?.variables ?? [])', () => {
    const state = makeState({
      pous: [
        { name: 'Main', pouType: 'program', interface: { variables: [] }, body: { language: 'st', value: '' } },
        { name: 'NoIf', pouType: 'function', body: { language: 'st', value: 'code' } },
      ],
    })
    const result = collectProjectContext(state, 'Main', 5000)
    expect(result).toContain('FUNCTION NoIf')
  })

  it('handles unknown variable class falling through sectionMap', () => {
    const state = makeState({
      pous: [
        {
          name: 'Main',
          pouType: 'program',
          interface: {
            variables: [{ name: 'v', class: 'unknownClass', type: { value: 'INT' } }],
          },
          body: { language: 'st', value: '' },
        },
      ],
    })
    const result = collectProjectContext(state, 'Main', 5000)
    // Unknown class falls through to ?? 'VAR'
    expect(result).toContain('VAR\n  v : INT;\nEND_VAR')
  })

  it('includes sibling with short body (no truncation marker)', () => {
    const state = makeState({
      pous: [
        { name: 'Main', pouType: 'program', interface: { variables: [] }, body: { language: 'st', value: '' } },
        {
          name: 'Short',
          pouType: 'function',
          interface: { variables: [] },
          body: { language: 'st', value: 'x := 1;' },
        },
      ],
    })
    const result = collectProjectContext(state, 'Main', 5000)
    expect(result).toContain('x := 1;')
    expect(result).not.toContain('(* ... *)')
  })
})

// -- non-IEC dialects ---------------------------------------------------------

/**
 * A Python or C++ POU gets the whole project described in its own comment
 * syntax. Emitting IEC syntax there would put `VAR_INPUT` blocks and
 * `TYPE … END_TYPE` declarations into a Python prompt, which the model reads as
 * code and continues in the wrong language.
 */
describe('collectProjectContext in Python and C++', () => {
  const variables = [
    { name: 'a', class: 'input', type: { value: 'INT' } },
    { name: 'b', class: 'output', type: { value: 'BOOL' } },
    { name: 'c', class: 'inOut', type: { value: 'REAL' } },
    { name: 'd', class: 'external', type: { value: 'DINT' } },
    { name: 'e', class: 'temp', type: { value: 'STRING' } },
    { name: 'f', class: 'local', type: { value: 'TIME' } },
    { name: 'g', type: { value: 'WORD' } },
  ]

  const dataTypes = [
    { name: 'Mode', derivation: 'enumerated', values: [{ description: 'IDLE' }, { description: 'RUN' }] },
    { name: 'Motor', derivation: 'structure', variable: [{ name: 'speed', type: { value: 'INT' } }] },
    {
      name: 'Grid',
      derivation: 'array',
      baseType: { value: 'REAL' },
      dimensions: [{ dimension: '0..9' }],
    },
    { name: 'Odd', derivation: 'unknown-derivation' },
  ]

  function projectState() {
    return makeState({
      pous: [
        { name: 'Main', pouType: 'program', interface: { variables }, body: { language: 'python', value: 'x = 1' } },
        {
          name: 'Helper',
          pouType: 'function',
          interface: { variables: [] },
          body: { language: 'python', value: 'y = 2' },
        },
      ],
      dataTypes,
      globalVariables: [{ name: 'flag', type: { value: 'BOOL' } }],
    })
  }

  it('groups Python variables by section as type-hinted comments', () => {
    const result = collectProjectContext(projectState(), 'Main', 5000, 'python')

    expect(result).toContain('# Current POU: Main [program]')
    expect(result).toContain('# Inputs:\n#   a: INT')
    expect(result).toContain('# Outputs:\n#   b: BOOL')
    expect(result).toContain('# In/Out:\n#   c: REAL')
    expect(result).toContain('# External:\n#   d: DINT')
    expect(result).toContain('# Temp:\n#   e: STRING')
    // A declared local and one with no class share the Local section.
    expect(result).toContain('# Local:\n#   f: TIME\n#   g: WORD')
    expect(result).not.toContain('VAR_INPUT')
  })

  it('renders Python globals and every data type derivation as comments', () => {
    const result = collectProjectContext(projectState(), 'Main', 5000, 'python')

    expect(result).toContain('# flag: BOOL')
    expect(result).toContain('# Enum Mode: IDLE, RUN')
    expect(result).toContain('# Struct Motor: { speed: INT }')
    expect(result).toContain('# Array Grid: REAL[0..9]')
    // A derivation this build does not know is dropped, not rendered blank.
    expect(result).not.toContain('Odd')
  })

  it('groups C++ variables by section as comments', () => {
    const result = collectProjectContext(projectState(), 'Main', 5000, 'cpp')

    expect(result).toContain('// Current POU: Main [program]')
    expect(result).toContain('// Inputs:\n//   a: INT')
    expect(result).toContain('// Local:\n//   f: TIME\n//   g: WORD')
    expect(result).not.toContain('VAR_INPUT')
  })

  it('renders C++ globals and every data type derivation as comments', () => {
    const result = collectProjectContext(projectState(), 'Main', 5000, 'cpp')

    expect(result).toContain('// flag: BOOL')
    expect(result).toContain('// Enum Mode: IDLE, RUN')
    expect(result).toContain('// Struct Motor: { speed: INT }')
    expect(result).toContain('// Array Grid: REAL[0..9]')
    expect(result).not.toContain('Odd')
  })

  it.each([
    ['python', '# ...'],
    ['cpp', '// ...'],
  ] as const)('truncates a long sibling body with a %s comment marker', (language, marker) => {
    // The marker has to be a comment in the target language; an IEC `(* ... *)`
    // in a Python prompt is a syntax error the model may copy.
    const state = makeState({
      pous: [
        { name: 'Main', pouType: 'program', interface: { variables: [] }, body: { language, value: '' } },
        {
          name: 'Long',
          pouType: 'function',
          interface: { variables: [] },
          body: { language, value: 'z = 1\n'.repeat(100) },
        },
      ],
    })

    expect(collectProjectContext(state, 'Main', 5000, language)).toContain(marker)
  })
})
