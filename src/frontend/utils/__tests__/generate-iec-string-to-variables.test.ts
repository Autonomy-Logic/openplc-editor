import type { LibraryState } from '../../../middleware/shared/ports/library-types'
import type { PLCPou, PLCVariable } from '../../../middleware/shared/ports/types'
import { parseIecStringToVariables } from '../generate-iec-string-to-variables'

describe('parseIecStringToVariables', () => {
  // ---- basic parsing ----

  it('returns empty array for empty string', () => {
    expect(parseIecStringToVariables('')).toEqual([])
  })

  it('returns empty array for blank lines only', () => {
    expect(parseIecStringToVariables('\n\n\n')).toEqual([])
  })

  it('parses a single local variable', () => {
    const input = 'VAR\n  counter : INT;\nEND_VAR'
    const result = parseIecStringToVariables(input)

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('counter')
    expect(result[0].class).toBe('local')
    expect(result[0].type).toEqual({ definition: 'base-type', value: 'INT' })
    expect(result[0].location).toBe('')
    expect(result[0].initialValue).toBeNull()
    expect(result[0].documentation).toBe('')
    expect(result[0].debug).toBe(false)
  })

  it('parses all variable class blocks', () => {
    const blocks: Array<{ block: string; expectedClass: PLCVariable['class'] }> = [
      { block: 'VAR', expectedClass: 'local' },
      { block: 'VAR_INPUT', expectedClass: 'input' },
      { block: 'VAR_OUTPUT', expectedClass: 'output' },
      { block: 'VAR_IN_OUT', expectedClass: 'inOut' },
      { block: 'VAR_EXTERNAL', expectedClass: 'external' },
      { block: 'VAR_TEMP', expectedClass: 'temp' },
      { block: 'VAR_GLOBAL', expectedClass: 'global' },
    ]

    for (const { block, expectedClass } of blocks) {
      const input = `${block}\n  x : INT;\nEND_VAR`
      const result = parseIecStringToVariables(input)
      expect(result[0].class).toBe(expectedClass)
    }
  })

  it('ignores lines outside of a VAR block', () => {
    const input = 'x : INT;\nVAR\n  y : BOOL;\nEND_VAR\nz : REAL;'
    const result = parseIecStringToVariables(input)

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('y')
  })

  // ---- guessErrorReason branches (lines 27-31) ----

  it('throws with "missing semicolon" hint', () => {
    const input = 'VAR\n  counter : INT\nEND_VAR'
    expect(() => parseIecStringToVariables(input)).toThrow(/missing semicolon/)
  })

  it('throws with "missing colon" hint', () => {
    const input = 'VAR\n  counter INT;\nEND_VAR'
    expect(() => parseIecStringToVariables(input)).toThrow(/missing colon/)
  })

  it('throws with "invalid or unsupported characters" hint', () => {
    const input = 'VAR\n  counter : INT @;\nEND_VAR'
    expect(() => parseIecStringToVariables(input)).toThrow(/invalid or unsupported characters/)
  })

  it('throws with "unrecognized declaration format" for otherwise valid-looking line', () => {
    // Has both : and ; but does not match any regex
    const input = 'VAR\n  : ;\nEND_VAR'
    expect(() => parseIecStringToVariables(input)).toThrow(/unrecognized declaration format/)
  })

  // ---- hasLibraryPous guard (line 38) ----

  it('returns false from hasLibraryPous for non-object system library entries', () => {
    const libraries: LibraryState['libraries'] = {
      system: [null as unknown as LibraryState['libraries']['system'][0]],
      user: [],
    }
    const input = 'VAR\n  x : MyBlock;\nEND_VAR'
    const result = parseIecStringToVariables(input, [], [], libraries)
    // Should not crash and should classify as user-data-type since lib has no pous
    expect(result[0].type.definition).toBe('user-data-type')
  })

  it('returns false from hasLibraryPous when lib has no pous property', () => {
    const libraries: LibraryState['libraries'] = {
      system: [
        {
          name: 'lib',
          author: 'a',
          version: '1',
          stPath: '',
          cPath: '',
        } as unknown as LibraryState['libraries']['system'][0],
      ],
      user: [],
    }
    const input = 'VAR\n  x : MyBlock;\nEND_VAR'
    const result = parseIecStringToVariables(input, [], [], libraries)
    expect(result[0].type.definition).toBe('user-data-type')
  })

  it('returns false from hasLibraryPous when pous is not an array', () => {
    const libraries: LibraryState['libraries'] = {
      system: [{ pous: 'not-an-array' } as unknown as LibraryState['libraries']['system'][0]],
      user: [],
    }
    const input = 'VAR\n  x : MyBlock;\nEND_VAR'
    const result = parseIecStringToVariables(input, [], [], libraries)
    expect(result[0].type.definition).toBe('user-data-type')
  })

  // ---- parseArrayType (lines 50-73) ----

  it('parses ARRAY type with base type', () => {
    const input = 'VAR\n  arr : ARRAY[1..10] OF INT;\nEND_VAR'
    const result = parseIecStringToVariables(input)

    expect(result).toHaveLength(1)
    expect(result[0].type.definition).toBe('array')
    expect(result[0].type.value).toBe('ARRAY[1..10] OF INT')
    expect(result[0].type.data).toEqual({
      baseType: { definition: 'base-type', value: 'INT' },
      dimensions: [{ dimension: '1..10' }],
    })
  })

  it('parses ARRAY type with user-defined base type', () => {
    const input = 'VAR\n  arr : ARRAY[0..5] OF MyStruct;\nEND_VAR'
    const result = parseIecStringToVariables(input)

    expect(result[0].type.definition).toBe('array')
    expect(result[0].type.data).toEqual({
      baseType: { definition: 'user-data-type', value: 'MyStruct' },
      dimensions: [{ dimension: '0..5' }],
    })
  })

  it('parses ARRAY variable with location and initial value', () => {
    const input = 'VAR_GLOBAL\n  arr : ARRAY[0..2] OF BOOL AT %MW0 := TRUE;\nEND_VAR'
    const result = parseIecStringToVariables(input)

    expect(result[0].type.definition).toBe('array')
    expect(result[0].location).toBe('%MW0')
    expect(result[0].initialValue).toBe('TRUE')
  })

  it('parses ARRAY variable with documentation', () => {
    const input = 'VAR\n  arr : ARRAY[0..9] OF INT; (* buffer *)\nEND_VAR'
    const result = parseIecStringToVariables(input)

    expect(result[0].type.definition).toBe('array')
    expect(result[0].documentation).toBe('buffer')
  })

  // ---- alternate format (line 115) ----

  it('parses the alternate format: name AT location : type', () => {
    const input = 'VAR\n  sensor AT %IX0.0 : BOOL;\nEND_VAR'
    const result = parseIecStringToVariables(input)

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('sensor')
    expect(result[0].location).toBe('%IX0.0')
    expect(result[0].type).toEqual({ definition: 'base-type', value: 'BOOL' })
  })

  // ---- syntax error line (line 118) ----

  it('throws a syntax error with line number for unparseable variable', () => {
    const input = 'VAR\n  bad line here;\nEND_VAR'
    expect(() => parseIecStringToVariables(input)).toThrow(/Syntax error on line 2/)
  })

  // ---- location disallowed for certain classes (line 126) ----

  it('throws when location is used with input class', () => {
    const input = 'VAR_INPUT\n  sensor AT %IX0.0 : BOOL;\nEND_VAR'
    expect(() => parseIecStringToVariables(input)).toThrow(/Location.*not allowed.*INPUT/)
  })

  it('throws when location is used with output class', () => {
    const input = 'VAR_OUTPUT\n  actuator AT %QX0.0 : BOOL;\nEND_VAR'
    expect(() => parseIecStringToVariables(input)).toThrow(/Location.*not allowed.*OUTPUT/)
  })

  it('includes the offending line and a repair hint in the located-class error (issue #904)', () => {
    const input = 'VAR_OUTPUT\n  actuator AT %QX0.0 : BOOL;\nEND_VAR'
    expect(() => parseIecStringToVariables(input)).toThrow(
      'Syntax error on line 2: "actuator AT %QX0.0 : BOOL;". Location ("AT") is not allowed for variables of class "OUTPUT". Move "actuator" to a VAR block (class LOCAL) or remove the "AT %QX0.0" clause.',
    )
  })

  it('throws when location is used with inOut class', () => {
    const input = 'VAR_IN_OUT\n  x AT %MW0 : INT;\nEND_VAR'
    expect(() => parseIecStringToVariables(input)).toThrow(/Location.*not allowed.*INOUT/)
  })

  it('throws when location is used with external class', () => {
    const input = 'VAR_EXTERNAL\n  x AT %MW0 : INT;\nEND_VAR'
    expect(() => parseIecStringToVariables(input)).toThrow(/Location.*not allowed.*EXTERNAL/)
  })

  it('throws when location is used with temp class', () => {
    const input = 'VAR_TEMP\n  x AT %MW0 : INT;\nEND_VAR'
    expect(() => parseIecStringToVariables(input)).toThrow(/Location.*not allowed.*TEMP/)
  })

  // ---- initial value disallowed for external (line 132) ----

  it('throws when initial value is used with external class', () => {
    const input = 'VAR_EXTERNAL\n  x : INT := 10;\nEND_VAR'
    expect(() => parseIecStringToVariables(input)).toThrow(/Initial Value.*not allowed.*EXTERNAL/)
  })

  // ---- array type branch inside main loop (lines 142-151) ----

  it('sets correct fields for array variable in main loop', () => {
    const input = 'VAR\n  data : ARRAY[1..5] OF DINT := 0; (* my array *)\nEND_VAR'
    const result = parseIecStringToVariables(input)

    expect(result[0].name).toBe('data')
    expect(result[0].class).toBe('local')
    expect(result[0].type.definition).toBe('array')
    expect(result[0].initialValue).toBe('0')
    expect(result[0].documentation).toBe('my array')
    expect(result[0].debug).toBe(false)
  })

  // ---- user function block detection (lines 157) ----

  it('classifies a type as derived when it matches a user function block POU', () => {
    const pous: PLCPou[] = [
      {
        name: 'MyFB',
        pouType: 'function-block',
        body: { language: 'ST', value: '' },
      },
    ]
    const input = 'VAR\n  inst : MyFB;\nEND_VAR'
    const result = parseIecStringToVariables(input, pous)

    expect(result[0].type).toEqual({ definition: 'derived', value: 'MyFB' })
  })

  it('matches user function block names case-insensitively', () => {
    const pous: PLCPou[] = [
      {
        name: 'MyFB',
        pouType: 'function-block',
        body: { language: 'ST', value: '' },
      },
    ]
    const input = 'VAR\n  inst : myfb;\nEND_VAR'
    const result = parseIecStringToVariables(input, pous)

    expect(result[0].type).toEqual({ definition: 'derived', value: 'myfb' })
  })

  it('does not classify a program POU as a function block', () => {
    const pous: PLCPou[] = [
      {
        name: 'MyProg',
        pouType: 'program',
        body: { language: 'ST', value: '' },
      },
    ]
    const input = 'VAR\n  inst : MyProg;\nEND_VAR'
    const result = parseIecStringToVariables(input, pous)

    expect(result[0].type.definition).toBe('user-data-type')
  })

  // ---- system library function block detection (lines 161-163) ----

  it('classifies a type as derived when it matches a system library function block', () => {
    const libraries: LibraryState['libraries'] = {
      system: [
        {
          name: 'Standard',
          author: 'IEC',
          version: '1.0',
          stPath: '',
          cPath: '',
          pous: [{ name: 'TON', type: 'function-block', language: 'st', variables: [], body: '', documentation: '' }],
        },
      ],
      user: [],
    }
    const input = 'VAR\n  timer : TON;\nEND_VAR'
    const result = parseIecStringToVariables(input, [], [], libraries)

    expect(result[0].type).toEqual({ definition: 'derived', value: 'TON' })
  })

  it('matches system library function block names case-insensitively', () => {
    const libraries: LibraryState['libraries'] = {
      system: [
        {
          name: 'Standard',
          author: 'IEC',
          version: '1.0',
          stPath: '',
          cPath: '',
          pous: [{ name: 'TON', type: 'function-block', language: 'st', variables: [], body: '', documentation: '' }],
        },
      ],
      user: [],
    }
    const input = 'VAR\n  timer : ton;\nEND_VAR'
    const result = parseIecStringToVariables(input, [], [], libraries)

    expect(result[0].type).toEqual({ definition: 'derived', value: 'ton' })
  })

  it('does not classify a system library function as a function block', () => {
    const libraries: LibraryState['libraries'] = {
      system: [
        {
          name: 'Standard',
          author: 'IEC',
          version: '1.0',
          stPath: '',
          cPath: '',
          pous: [{ name: 'ABS', type: 'function', language: 'st', variables: [], body: '', documentation: '' }],
        },
      ],
      user: [],
    }
    const input = 'VAR\n  x : ABS;\nEND_VAR'
    const result = parseIecStringToVariables(input, [], [], libraries)

    // ABS is not a base type (uppercase check fails for 'ABS'), so it's user-data-type
    expect(result[0].type.definition).toBe('user-data-type')
  })

  // ---- user library function block detection (line 168) ----

  it('classifies a type as derived when it matches a user library function block', () => {
    const libraries: LibraryState['libraries'] = {
      system: [],
      user: [{ name: 'CustomFB', type: 'function-block' }],
    }
    const input = 'VAR\n  inst : CustomFB;\nEND_VAR'
    const result = parseIecStringToVariables(input, [], [], libraries)

    expect(result[0].type).toEqual({ definition: 'derived', value: 'CustomFB' })
  })

  it('matches user library function block names case-insensitively', () => {
    const libraries: LibraryState['libraries'] = {
      system: [],
      user: [{ name: 'CustomFB', type: 'function-block' }],
    }
    const input = 'VAR\n  inst : customfb;\nEND_VAR'
    const result = parseIecStringToVariables(input, [], [], libraries)

    expect(result[0].type).toEqual({ definition: 'derived', value: 'customfb' })
  })

  it('does not classify a user library program as a function block', () => {
    const libraries: LibraryState['libraries'] = {
      system: [],
      user: [{ name: 'MyProg', type: 'program' }],
    }
    const input = 'VAR\n  inst : MyProg;\nEND_VAR'
    const result = parseIecStringToVariables(input, [], [], libraries)

    expect(result[0].type.definition).toBe('user-data-type')
  })

  // ---- user-data-type fallback ----

  it('classifies an unknown type as user-data-type', () => {
    const input = 'VAR\n  inst : UnknownType;\nEND_VAR'
    const result = parseIecStringToVariables(input)

    expect(result[0].type).toEqual({ definition: 'user-data-type', value: 'UnknownType' })
  })

  // ---- location and initial value parsing ----

  it('parses location in primary format', () => {
    const input = 'VAR\n  x : INT AT %MW0;\nEND_VAR'
    const result = parseIecStringToVariables(input)

    expect(result[0].location).toBe('%MW0')
  })

  it('parses initial value', () => {
    const input = 'VAR\n  x : INT := 42;\nEND_VAR'
    const result = parseIecStringToVariables(input)

    expect(result[0].initialValue).toBe('42')
  })

  it('parses documentation comment', () => {
    const input = 'VAR\n  x : INT; (* this is x *)\nEND_VAR'
    const result = parseIecStringToVariables(input)

    expect(result[0].documentation).toBe('this is x')
  })

  it('handles Windows-style line endings', () => {
    const input = 'VAR\r\n  x : INT;\r\nEND_VAR'
    const result = parseIecStringToVariables(input)

    expect(result).toHaveLength(1)
  })

  // ---- no libraries provided ----

  it('works when libraries parameter is undefined', () => {
    const input = 'VAR\n  x : SomeType;\nEND_VAR'
    const result = parseIecStringToVariables(input, [], [])

    expect(result[0].type.definition).toBe('user-data-type')
  })

  // ---- case insensitive block headers ----

  it('recognizes case-insensitive VAR block headers', () => {
    const input = 'var_input\n  x : INT;\nend_var'
    const result = parseIecStringToVariables(input)

    expect(result[0].class).toBe('input')
  })
})
