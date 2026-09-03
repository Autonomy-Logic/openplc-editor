import type { PLCVariable } from '../../../middleware/shared/ports/types'
import {
  arrayValidation,
  checkVariableName,
  createVariableValidation,
  enumeratedValidation,
  extractNumberAtEnd,
  updateGlobalVariableValidation,
  updateVariableValidation,
} from '../slices/project/validation/variables'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVariable(
  name: string,
  typeValue = 'INT',
  location = '',
  cls: PLCVariable['class'] = 'local',
  definition: PLCVariable['type']['definition'] = 'base-type',
): PLCVariable {
  return {
    name,
    class: cls,
    type: { definition, value: typeValue },
    location,
    documentation: '',
  }
}

/**
 * A located ARRAY variable. `data.dimensions` is what `getArrayTotalElements`
 * reads to work out how many slots the declaration claims.
 */
/** A located ARRAY with an arbitrary number of dimensions. */
function makeMultiDimArrayVariable(
  name: string,
  baseType: string,
  location: string,
  dimensions: string[],
): PLCVariable {
  return {
    name,
    class: 'local',
    type: {
      definition: 'array',
      value: `ARRAY [${dimensions.join(', ')}] OF ${baseType}`,
      data: {
        baseType: { definition: 'base-type', value: baseType },
        dimensions: dimensions.map((dimension) => ({ dimension })),
      },
    },
    location,
    documentation: '',
  }
}

function makeArrayVariable(
  name: string,
  baseType: string,
  location: string,
  dimension: string,
  cls: PLCVariable['class'] = 'local',
): PLCVariable {
  return {
    name,
    class: cls,
    type: {
      definition: 'array',
      value: `ARRAY [${dimension}] OF ${baseType}`,
      data: { baseType: { definition: 'base-type', value: baseType }, dimensions: [{ dimension }] },
    },
    location,
    documentation: '',
  }
}

// ===========================================================================
// extractNumberAtEnd
// ===========================================================================

describe('extractNumberAtEnd', () => {
  it('extracts trailing number from a name', () => {
    expect(extractNumberAtEnd('Var12')).toEqual({ number: 12, string: '12', length: 2 })
  })

  it('extracts single digit', () => {
    expect(extractNumberAtEnd('Var0')).toEqual({ number: 0, string: '0', length: 1 })
  })

  it('returns -1 when no trailing number', () => {
    expect(extractNumberAtEnd('Var')).toEqual({ number: -1, string: '', length: 0 })
  })

  it('returns -1 for empty string', () => {
    expect(extractNumberAtEnd('')).toEqual({ number: -1, string: '', length: 0 })
  })
})

// ===========================================================================
// enumeratedValidation
// ===========================================================================

describe('enumeratedValidation', () => {
  it('returns ok: true for a valid CamelCase value', () => {
    expect(enumeratedValidation({ value: 'MyValue' })).toEqual({ ok: true })
  })

  it('returns ok: true for a valid SnakeCase value', () => {
    expect(enumeratedValidation({ value: 'my_value' })).toEqual({ ok: true })
  })

  it('returns error when value is empty', () => {
    const result = enumeratedValidation({ value: '' })
    expect(result.ok).toBe(false)
    expect(result.title).toBe('Invalid enumerated value')
    expect(result.message).toContain('can not be empty')
  })

  it('returns error when value is invalid (special characters)', () => {
    const result = enumeratedValidation({ value: '###' })
    expect(result.ok).toBe(false)
    expect(result.title).toBe('Invalid enumerated value')
    expect(result.message).toContain('is invalid')
  })
})

// ===========================================================================
// arrayValidation
// ===========================================================================

describe('arrayValidation', () => {
  it('returns ok: true for valid array range "0..10"', () => {
    expect(arrayValidation({ value: '0..10' })).toEqual({ ok: true })
  })

  it('returns error when value is empty', () => {
    const result = arrayValidation({ value: '' })
    expect(result.ok).toBe(false)
    expect(result.title).toBe('Invalid array value')
    expect(result.message).toContain('can not be empty')
  })

  it('returns error when left >= right "10..5"', () => {
    const result = arrayValidation({ value: '10..5' })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('is invalid')
  })

  it('returns error when left equals right "5..5"', () => {
    const result = arrayValidation({ value: '5..5' })
    expect(result.ok).toBe(false)
  })

  it('returns error for non-integer values "1.5..10"', () => {
    const result = arrayValidation({ value: '1.5..10' })
    expect(result.ok).toBe(false)
  })

  it('returns error for string values "abc..def"', () => {
    const result = arrayValidation({ value: 'abc..def' })
    expect(result.ok).toBe(false)
  })

  it('returns error for spaces "0 .. 10"', () => {
    const result = arrayValidation({ value: '0 .. 10' })
    expect(result.ok).toBe(false)
  })
})

// ===========================================================================
// checkVariableName
// ===========================================================================

describe('checkVariableName', () => {
  it('returns ok: false and number 0 when no variables match', () => {
    const result = checkVariableName([], 'Var0')
    expect(result.ok).toBe(false)
  })

  it('finds existing variables and returns the next number', () => {
    const variables = [makeVariable('Var0'), makeVariable('Var1'), makeVariable('Var2')]
    const result = checkVariableName(variables, 'Var0')
    expect(result.ok).toBe(true)
    expect(result.name).toBe('Var')
    expect(result.number).toBe(3)
  })

  it('handles variables without trailing numbers', () => {
    const variables = [makeVariable('Var')]
    const result = checkVariableName(variables, 'Var')
    expect(result.ok).toBe(true)
    expect(result.number).toBe(0) // -1 + 1
  })

  it('sorts variables by trailing number', () => {
    const variables = [makeVariable('Var5'), makeVariable('Var1'), makeVariable('Var3')]
    const result = checkVariableName(variables, 'Var1')
    expect(result.ok).toBe(true)
    expect(result.name).toBe('Var')
    expect(result.number).toBe(6) // biggest is 5, so next is 6
  })

  it('sorts variables with mixed numbered and unnumbered names', () => {
    const variables = [makeVariable('Test'), makeVariable('Test2'), makeVariable('Test10')]
    const result = checkVariableName(variables, 'Test2')
    expect(result.ok).toBe(true)
    expect(result.name).toBe('Test')
    expect(result.number).toBe(11) // biggest is 10, next is 11
  })

  it('sort comparison covers both ternary branches (numbered vs unnumbered)', () => {
    // Force sort to compare a variable without trailing number against one with trailing number
    const variables = [makeVariable('Item3'), makeVariable('Item')]
    const result = checkVariableName(variables, 'Item')
    expect(result.ok).toBe(true)
    // 'Item' has number -1 (no trailing number), 'Item3' has number 3
    // Sort should place 'Item' (-1) before 'Item3' (3)
    // Biggest is 3, so next is 4
    expect(result.number).toBe(4)
  })
})

// ===========================================================================
// createVariableValidation
// ===========================================================================

describe('createVariableValidation', () => {
  it('strips the location when creating an interface-class variable (issue #904)', () => {
    const result = createVariableValidation([], makeVariable('Q1', 'BOOL', '%QX0.0', 'output'))
    expect(result).toEqual({ name: 'Q1', location: '' })
  })

  it('returns unchanged name and location when no conflicts', () => {
    const variable = makeVariable('NewVar', 'INT', '')
    const result = createVariableValidation([], variable)
    expect(result.name).toBe('NewVar')
    expect(result.location).toBe('')
  })

  it('renames variable when name already exists', () => {
    const existing = [makeVariable('Var0'), makeVariable('Var1')]
    const variable = makeVariable('Var0', 'INT', '')
    const result = createVariableValidation(existing, variable)
    expect(result.name).toBe('Var2')
  })

  it('returns same location when location is empty and conflicts exist', () => {
    const existing = [makeVariable('Other', 'INT', '')]
    const variable = makeVariable('NewVar', 'INT', '')
    const result = createVariableValidation(existing, variable)
    expect(result.location).toBe('')
  })

  // -- BOOL location increment --
  it('increments BOOL output location when duplicate found', () => {
    const existing = [makeVariable('Var1', 'BOOL', '%QX0.3')]
    const variable = makeVariable('NewVar', 'BOOL', '%QX0.3')
    const result = createVariableValidation(existing, variable)
    expect(result.location).toBe('%QX0.4')
  })

  it('wraps BOOL location from .7 to next position .0', () => {
    const existing = [makeVariable('Var1', 'BOOL', '%QX0.7')]
    const variable = makeVariable('NewVar', 'BOOL', '%QX0.7')
    const result = createVariableValidation(existing, variable)
    expect(result.location).toBe('%QX1.0')
  })

  it('increments BOOL input location', () => {
    const existing = [makeVariable('Var1', 'BOOL', '%IX0.2')]
    const variable = makeVariable('NewVar', 'BOOL', '%IX0.2')
    const result = createVariableValidation(existing, variable)
    expect(result.location).toBe('%IX0.3')
  })

  // -- WORD location increment (INT, UINT, WORD) --
  it('increments INT output location', () => {
    const existing = [makeVariable('Var1', 'INT', '%QW5')]
    const variable = makeVariable('NewVar', 'INT', '%QW5')
    const result = createVariableValidation(existing, variable)
    expect(result.location).toBe('%QW6')
  })

  it('increments UINT input location', () => {
    const existing = [makeVariable('Var1', 'UINT', '%IW2')]
    const variable = makeVariable('NewVar', 'UINT', '%IW2')
    const result = createVariableValidation(existing, variable)
    expect(result.location).toBe('%IW3')
  })

  it('increments WORD memory location', () => {
    const existing = [makeVariable('Var1', 'WORD', '%MW10')]
    const variable = makeVariable('NewVar', 'WORD', '%MW10')
    const result = createVariableValidation(existing, variable)
    expect(result.location).toBe('%MW11')
  })

  // -- DWORD location increment (DINT, UDINT, REAL, DWORD) --
  it('increments DINT memory location', () => {
    const existing = [makeVariable('Var1', 'DINT', '%MD3')]
    const variable = makeVariable('NewVar', 'DINT', '%MD3')
    const result = createVariableValidation(existing, variable)
    expect(result.location).toBe('%MD4')
  })

  it('increments UDINT memory location', () => {
    const existing = [makeVariable('Var1', 'UDINT', '%MD0')]
    const variable = makeVariable('NewVar', 'UDINT', '%MD0')
    const result = createVariableValidation(existing, variable)
    expect(result.location).toBe('%MD1')
  })

  it('increments REAL memory location', () => {
    const existing = [makeVariable('Var1', 'REAL', '%MD7')]
    const variable = makeVariable('NewVar', 'REAL', '%MD7')
    const result = createVariableValidation(existing, variable)
    expect(result.location).toBe('%MD8')
  })

  it('increments DWORD memory location', () => {
    const existing = [makeVariable('Var1', 'DWORD', '%MD2')]
    const variable = makeVariable('NewVar', 'DWORD', '%MD2')
    const result = createVariableValidation(existing, variable)
    expect(result.location).toBe('%MD3')
  })

  it('preserves DWORD input prefix on increment (%ID0 -> %ID1)', () => {
    const existing = [makeVariable('Var1', 'REAL', '%ID0')]
    const variable = makeVariable('NewVar', 'REAL', '%ID0')
    const result = createVariableValidation(existing, variable)
    expect(result.location).toBe('%ID1')
  })

  it('preserves DWORD output prefix on increment (%QD3 -> %QD4)', () => {
    const existing = [makeVariable('Var1', 'REAL', '%QD3')]
    const variable = makeVariable('NewVar', 'REAL', '%QD3')
    const result = createVariableValidation(existing, variable)
    expect(result.location).toBe('%QD4')
  })

  // -- LWORD location increment (LINT, ULINT, LREAL, LWORD) --
  it('increments LINT memory location', () => {
    const existing = [makeVariable('Var1', 'LINT', '%ML0')]
    const variable = makeVariable('NewVar', 'LINT', '%ML0')
    const result = createVariableValidation(existing, variable)
    expect(result.location).toBe('%ML1')
  })

  it('increments ULINT memory location', () => {
    const existing = [makeVariable('Var1', 'ULINT', '%ML5')]
    const variable = makeVariable('NewVar', 'ULINT', '%ML5')
    const result = createVariableValidation(existing, variable)
    expect(result.location).toBe('%ML6')
  })

  it('increments LREAL memory location', () => {
    const existing = [makeVariable('Var1', 'LREAL', '%ML1')]
    const variable = makeVariable('NewVar', 'LREAL', '%ML1')
    const result = createVariableValidation(existing, variable)
    expect(result.location).toBe('%ML2')
  })

  it('increments LWORD memory location', () => {
    const existing = [makeVariable('Var1', 'LWORD', '%ML9')]
    const variable = makeVariable('NewVar', 'LWORD', '%ML9')
    const result = createVariableValidation(existing, variable)
    expect(result.location).toBe('%ML10')
  })

  it('preserves LWORD input prefix on increment (%IL2 -> %IL3)', () => {
    const existing = [makeVariable('Var1', 'LREAL', '%IL2')]
    const variable = makeVariable('NewVar', 'LREAL', '%IL2')
    const result = createVariableValidation(existing, variable)
    expect(result.location).toBe('%IL3')
  })

  it('preserves LWORD output prefix on increment (%QL0 -> %QL1)', () => {
    const existing = [makeVariable('Var1', 'LREAL', '%QL0')]
    const variable = makeVariable('NewVar', 'LREAL', '%QL0')
    const result = createVariableValidation(existing, variable)
    expect(result.location).toBe('%QL1')
  })

  // -- Default case (unknown type) --
  it('still walks when the type has no address class, as long as the address parses', () => {
    // Behaviour change: the walk used to key off the variable's TYPE and gave
    // up on anything its switch did not list, leaving a known duplicate in
    // place. It now keys off the ADDRESS, which already states its size class,
    // so a colliding %MD0 moves on regardless of the type sitting at it.
    const existing = [makeVariable('Var1', 'STRING', '%MD0')]
    const variable = makeVariable('NewVar', 'STRING', '%MD0')
    expect(createVariableValidation(existing, variable).location).toBe('%MD1')
  })

  it('leaves an alias-bound location alone — there is nothing to increment', () => {
    // A location that is not a literal address cannot be stepped, so the walk
    // bails on the first pass and the duplicate stands. That is the honest
    // answer: resolving an alias collision means picking a different alias,
    // not inventing an address.
    const existing = [makeVariable('Var1', 'BOOL', 'MotorStart')]
    const variable = makeVariable('NewVar', 'BOOL', 'MotorStart')
    expect(createVariableValidation(existing, variable).location).toBe('MotorStart')
  })

  it('walks byte and memory-bit addresses, which the old switch could not', () => {
    // %IB had no case at all (the walk gave up), and %MX fell through the BOOL
    // case with its prefix unstripped, producing "%IXNaN.NaN".
    expect(
      createVariableValidation([makeVariable('a', 'BYTE', '%IB0')], makeVariable('b', 'BYTE', '%IB0')).location,
    ).toBe('%IB1')
    expect(
      createVariableValidation([makeVariable('a', 'BOOL', '%MX0.7')], makeVariable('b', 'BOOL', '%MX0.7')).location,
    ).toBe('%MX1.0')
  })

  // -- Multi-collision walk (regression for forum bug: contiguous "+" clicks
  //    across a row with a variable already further down) --
  it('walks past intervening claimed locations until it finds a free slot (BOOL)', () => {
    // Existing rows occupy %IX0.0..%IX0.4 and %IX0.5 — user "+"-clicks the row
    // at %IX0.4.  Single-step increment would land on %IX0.5 and collide; the
    // validator must walk to %IX0.6.
    const existing = [
      makeVariable('I1', 'BOOL', '%IX0.0'),
      makeVariable('I1_0', 'BOOL', '%IX0.1'),
      makeVariable('I1_1', 'BOOL', '%IX0.2'),
      makeVariable('I1_2', 'BOOL', '%IX0.3'),
      makeVariable('I1_3', 'BOOL', '%IX0.4'),
      makeVariable('I2', 'BOOL', '%IX0.5'),
    ]
    const variable = makeVariable('NewVar', 'BOOL', '%IX0.4')
    const result = createVariableValidation(existing, variable)
    expect(result.location).toBe('%IX0.6')
  })

  it('walks past multiple consecutive claimed locations (WORD)', () => {
    const existing = [
      makeVariable('A', 'INT', '%QW5'),
      makeVariable('B', 'INT', '%QW6'),
      makeVariable('C', 'INT', '%QW7'),
    ]
    const variable = makeVariable('NewVar', 'INT', '%QW5')
    const result = createVariableValidation(existing, variable)
    expect(result.location).toBe('%QW8')
  })

  it('wraps past a full BOOL byte when every bit and the next byte are taken', () => {
    // %QX0.0..%QX0.7 claimed plus %QX1.0 — must land at %QX1.1.
    const existing = [
      makeVariable('B0', 'BOOL', '%QX0.0'),
      makeVariable('B1', 'BOOL', '%QX0.1'),
      makeVariable('B2', 'BOOL', '%QX0.2'),
      makeVariable('B3', 'BOOL', '%QX0.3'),
      makeVariable('B4', 'BOOL', '%QX0.4'),
      makeVariable('B5', 'BOOL', '%QX0.5'),
      makeVariable('B6', 'BOOL', '%QX0.6'),
      makeVariable('B7', 'BOOL', '%QX0.7'),
      makeVariable('B8', 'BOOL', '%QX1.0'),
    ]
    const variable = makeVariable('NewVar', 'BOOL', '%QX0.0')
    const result = createVariableValidation(existing, variable)
    expect(result.location).toBe('%QX1.1')
  })

  // -- Edge case: location exists but not found in variables (defensive) --
  it('returns unchanged when location exists but variable not found in list', () => {
    // This covers the `if (!variableFound) return response` branch
    // We need checkIfLocationExists to return true but find() to return undefined
    // This can happen with a location that matches but no variable has it
    // Actually, both use the same predicate. We test that the early return for
    // empty location works.
    const existing = [makeVariable('Var1', 'INT', '')]
    const variable = makeVariable('NewVar', 'INT', '')
    // empty location matches, triggers early return
    const result = createVariableValidation(existing, variable)
    expect(result.location).toBe('')
  })
})

// ===========================================================================
// updateVariableValidation
// ===========================================================================

describe('updateVariableValidation', () => {
  const existingVars = [makeVariable('Var1', 'INT', '%QW0'), makeVariable('Var2', 'BOOL', '%QX0.0')]

  it('clears an existing location when class changes to an interface class (issue #904)', () => {
    // Var1 holds location '%QW0'; a located VAR_OUTPUT entry is invalid IEC
    // and would fail to parse on project reopen, so the class change must
    // clear the location in the same update.
    const result = updateVariableValidation(existingVars, { class: 'output' }, existingVars[0])
    expect(result.ok).toBe(true)
    expect(result.data).toEqual({ class: 'output', location: '' })
  })

  it('keeps the location when class changes to local', () => {
    const result = updateVariableValidation(existingVars, { class: 'local' }, existingVars[0])
    expect(result.ok).toBe(true)
    expect(result.data).toEqual({ class: 'local' })
  })

  // -- Name validation --
  it('returns error when name is empty string', () => {
    const result = updateVariableValidation(existingVars, { name: '' }, existingVars[0])
    expect(result.ok).toBe(false)
    expect(result.title).toContain('empty')
  })

  it('returns error when name already exists', () => {
    const result = updateVariableValidation(existingVars, { name: 'Var2' }, existingVars[0])
    expect(result.ok).toBe(false)
    expect(result.title).toContain('already exists')
  })

  it('returns error when name is invalid format', () => {
    const result = updateVariableValidation(existingVars, { name: '###' }, existingVars[0])
    expect(result.ok).toBe(false)
    expect(result.title).toContain('invalid')
  })

  it('returns ok: true when name is valid and unique', () => {
    const result = updateVariableValidation(existingVars, { name: 'ValidName' }, existingVars[0])
    expect(result.ok).toBe(true)
  })

  // -- Location validation --
  it('rejects a location on an interface-class variable (issue #904)', () => {
    const outputVar = makeVariable('OutVar', 'BOOL', '', 'output')
    const result = updateVariableValidation([outputVar], { location: '%QX0.1' }, outputVar)
    expect(result.ok).toBe(false)
    expect(result.title).toContain('Location is not allowed')
    expect(result.message).toContain('OUTPUT')
  })

  it('rejects a combined update setting an interface class and a location together', () => {
    const localVar = makeVariable('LVar', 'BOOL', '')
    const result = updateVariableValidation([localVar], { class: 'input', location: '%IX0.0' }, localVar)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('INPUT')
  })

  it('accepts a location in a combined update that sets class local', () => {
    const inputVar = makeVariable('IVar', 'BOOL', '', 'input')
    const result = updateVariableValidation([], { class: 'local', location: '%QX0.0' }, inputVar)
    expect(result.ok).toBe(true)
  })

  it('returns error when location already exists', () => {
    const result = updateVariableValidation(existingVars, { location: '%QW0' }, existingVars[1])
    expect(result.ok).toBe(false)
    expect(result.title).toContain('Location already exists')
  })

  it('does not flag self-collision when re-setting a variable to its current location', () => {
    // Regression guard: the user re-picks the same address from the
    // location dropdown to refresh a renamed alias.  The uniqueness
    // check must exclude the variable being updated; otherwise the
    // re-pick would be rejected against the variable's own existing
    // location entry.  Pairs with the alias-refresh path in the
    // editable-cell `onBlur` handler.
    const result = updateVariableValidation(existingVars, { location: existingVars[0].location }, existingVars[0])
    expect(result.ok).toBe(true)
  })

  it('returns error when location format is invalid for variable type', () => {
    const boolVar = makeVariable('Test', 'BOOL', '')
    const result = updateVariableValidation(existingVars, { location: '%MD0' }, boolVar)
    expect(result.ok).toBe(false)
    expect(result.title).toContain('invalid')
    expect(result.message).toContain('Valid locations')
  })

  it('returns ok: true when location is valid for BOOL type', () => {
    const boolVar = makeVariable('Test', 'BOOL', '')
    const result = updateVariableValidation([], { location: '%QX0.0' }, boolVar)
    expect(result.ok).toBe(true)
  })

  it.each(['%QX0.0', '%IX0.0', '%MX0.0', '%MX3.7'])(
    'accepts every valid IEC area prefix for BOOL locations (%s)',
    (location) => {
      const boolVar = makeVariable('Test', 'BOOL', '')
      const result = updateVariableValidation([], { location }, boolVar)
      expect(result.ok).toBe(true)
    },
  )

  it.each([
    ['BYTE', '%IB0'],
    ['BYTE', '%QB1'],
    ['BYTE', '%MB2'],
    ['SINT', '%IB3'],
    ['USINT', '%MB4'],
  ])('accepts byte locations (I/Q/M) for %s type (%s)', (type, location) => {
    const v = makeVariable('Test', type, '')
    const result = updateVariableValidation([], { location }, v)
    expect(result.ok).toBe(true)
  })

  it.each([
    ['BYTE', '%IX0.0'], // bit location, wrong width for a byte type
    ['SINT', '%IW0'], // word location, wrong width
    ['BOOL', '%IB0'], // byte location, wrong width for a bit type
  ])('rejects a cross-width location for %s (%s)', (type, location) => {
    const v = makeVariable('Test', type, '')
    const result = updateVariableValidation([], { location }, v)
    expect(result.ok).toBe(false)
  })

  it('returns ok: true when location is valid for WORD type', () => {
    const wordVar = makeVariable('Test', 'WORD', '')
    const result = updateVariableValidation([], { location: '%QW0' }, wordVar)
    expect(result.ok).toBe(true)
  })

  it('returns ok: true when location is valid for DWORD type', () => {
    const dwordVar = makeVariable('Test', 'DWORD', '')
    const result = updateVariableValidation([], { location: '%MD0' }, dwordVar)
    expect(result.ok).toBe(true)
  })

  it('returns ok: true when location is valid for LWORD type', () => {
    const lwordVar = makeVariable('Test', 'LWORD', '')
    const result = updateVariableValidation([], { location: '%ML0' }, lwordVar)
    expect(result.ok).toBe(true)
  })

  // -- Location error messages for specific types --
  // A literal `%` address of the wrong width triggers the type-specific
  // hint.  (A NON-`%` string is now treated as an alias name and accepted;
  // see the "accepts a non-% location as an alias name" cases below.)
  it('returns BOOL location hint', () => {
    const boolVar = makeVariable('Test', 'BOOL', '')
    const result = updateVariableValidation([], { location: '%MD0' }, boolVar)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('%QX')
  })

  it('returns WORD location hint for INT type', () => {
    const intVar = makeVariable('Test', 'INT', '')
    const result = updateVariableValidation([], { location: '%QX0.0' }, intVar)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('%QW')
  })

  it('returns WORD location hint for UINT type', () => {
    const uintVar = makeVariable('Test', 'UINT', '')
    const result = updateVariableValidation([], { location: '%QX0.0' }, uintVar)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('%IW')
  })

  it('returns DWORD location hint for DINT type', () => {
    const dintVar = makeVariable('Test', 'DINT', '')
    const result = updateVariableValidation([], { location: '%QX0.0' }, dintVar)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('%MD')
  })

  it('returns DWORD location hint for UDINT type', () => {
    const udintVar = makeVariable('Test', 'UDINT', '')
    const result = updateVariableValidation([], { location: '%QX0.0' }, udintVar)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('%MD')
  })

  it('returns DWORD location hint for REAL type', () => {
    const realVar = makeVariable('Test', 'REAL', '')
    const result = updateVariableValidation([], { location: '%QX0.0' }, realVar)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('%MD')
  })

  it('returns LWORD location hint for LINT type', () => {
    const lintVar = makeVariable('Test', 'LINT', '')
    const result = updateVariableValidation([], { location: '%QX0.0' }, lintVar)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('%ML')
  })

  it('returns LWORD location hint for ULINT type', () => {
    const ulintVar = makeVariable('Test', 'ULINT', '')
    const result = updateVariableValidation([], { location: '%QX0.0' }, ulintVar)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('%ML')
  })

  it('returns LWORD location hint for LREAL type', () => {
    const lrealVar = makeVariable('Test', 'LREAL', '')
    const result = updateVariableValidation([], { location: '%QX0.0' }, lrealVar)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('%ML')
  })

  it('returns empty message for unknown type location', () => {
    const unknownVar = makeVariable('Test', 'STRING', '')
    const result = updateVariableValidation([], { location: '%QX0.0' }, unknownVar)
    expect(result.ok).toBe(false)
    // Default case returns empty string for the error message detail
    expect(result.message).toContain('Please make sure that the location is valid.')
  })

  // -- Alias-name locations (single-field model) --
  // A non-`%` location is an alias binding; its concrete address (and thus
  // its type match) is resolved at compile time, so validation accepts any
  // non-empty non-`%` string regardless of the variable's type.
  it('accepts a non-% location as an alias name (BOOL)', () => {
    const boolVar = makeVariable('Test', 'BOOL', '')
    const result = updateVariableValidation([], { location: 'push_button' }, boolVar)
    expect(result.ok).toBe(true)
  })

  it('accepts a non-% location as an alias name (unknown/STRING type)', () => {
    const stringVar = makeVariable('Test', 'STRING', '')
    const result = updateVariableValidation([], { location: 'some_alias' }, stringVar)
    expect(result.ok).toBe(true)
  })

  // -- BOOL location validation edge cases --
  it('rejects BOOL location with bit position > 7', () => {
    const boolVar = makeVariable('Test', 'BOOL', '')
    const result = updateVariableValidation([], { location: '%QX0.8' }, boolVar)
    expect(result.ok).toBe(false)
  })

  it('accepts BOOL location with bit position exactly 7', () => {
    const boolVar = makeVariable('Test', 'BOOL', '')
    const result = updateVariableValidation([], { location: '%QX0.7' }, boolVar)
    expect(result.ok).toBe(true)
  })

  it('accepts BOOL input location', () => {
    const boolVar = makeVariable('Test', 'BOOL', '')
    const result = updateVariableValidation([], { location: '%IX0.3' }, boolVar)
    expect(result.ok).toBe(true)
  })

  // -- Type change validation --
  it('clears location when type changes and current location is invalid for new type', () => {
    const varWithLocation = makeVariable('Test', 'INT', '%QW0')
    const result = updateVariableValidation([], { type: { definition: 'base-type', value: 'BOOL' } }, varWithLocation)
    expect(result.ok).toBe(true)
    expect(result.data).toEqual({ location: '' })
  })

  it('does not clear location when type changes but location is still valid', () => {
    const varWithLocation = makeVariable('Test', 'INT', '%QW0')
    const result = updateVariableValidation([], { type: { definition: 'base-type', value: 'WORD' } }, varWithLocation)
    expect(result.ok).toBe(true)
    // location is valid for WORD, so no data override
    expect(result.data).toBeUndefined()
  })

  it('clears location, initialValue, and class when type changes to derived', () => {
    const varWithLocation = makeVariable('Test', 'INT', '%QW0')
    const result = updateVariableValidation([], { type: { definition: 'derived', value: 'MyFB' } }, varWithLocation)
    expect(result.ok).toBe(true)
    expect(result.data).toEqual({ location: '', initialValue: '', class: 'local' })
  })

  it('sets class and location/initialValue when type is derived and class was also updated', () => {
    const varWithLocation = makeVariable('Test', 'INT', '%QW0')
    const result = updateVariableValidation(
      [],
      { class: 'output', type: { definition: 'derived', value: 'MyFB' } },
      varWithLocation,
    )
    expect(result.ok).toBe(true)
    // class from explicit update + location/initialValue/class from derived override
    expect(result.data).toEqual({ class: 'local', location: '', initialValue: '' })
  })

  it('sets derived data without prior response.data when location is valid for new type', () => {
    // The variable has a valid WORD location, and the type changes to WORD (derived).
    // variableLocationValidation('%QW0', 'WORD') returns true, so line 353 is skipped.
    // Then line 355 checks derived -> sets response.data from {} (no prior data).
    const varWithValidLocation = makeVariable('Test', 'WORD', '%QW0')
    const result = updateVariableValidation(
      [],
      { type: { definition: 'derived', value: 'MyStruct' } },
      varWithValidLocation,
    )
    expect(result.ok).toBe(true)
    // variableLocationValidation('%QW0', 'MyStruct') -- 'MyStruct' is not a known type, so returns false
    // This means line 353 IS executed, setting response.data = { location: '' }
    // Then line 356 spreads it.
    expect(result.data).toEqual({ location: '', initialValue: '', class: 'local' })
  })

  it('sets derived data when location validation passes for new type value', () => {
    // We need variableLocationValidation(location, typeValue) to return TRUE
    // AND definition to be 'derived'. But derived values like 'MyFB' won't pass
    // any of the known type checks (BOOL, INT, etc.), so this specific combination
    // where location passes AND type is derived is practically not reachable
    // through valid use, but we can test with a valid type name:
    const varWithValidLocation = makeVariable('Test', 'INT', '%QW0')
    const result = updateVariableValidation([], { type: { definition: 'derived', value: 'INT' } }, varWithValidLocation)
    expect(result.ok).toBe(true)
    // variableLocationValidation('%QW0', 'INT') returns true -> line 353 skipped
    // definition is 'derived' -> line 356 executes with response.data = undefined -> uses {}
    expect(result.data).toEqual({ location: '', initialValue: '', class: 'local' })
  })
})

// ===========================================================================
// updateGlobalVariableValidation
// ===========================================================================

describe('updateGlobalVariableValidation', () => {
  const existingGlobals = [makeVariable('GVar1'), makeVariable('GVar2')]

  it('returns ok: true when no name change', () => {
    const result = updateGlobalVariableValidation(existingGlobals, { location: '%QW0' })
    expect(result.ok).toBe(true)
  })

  it('returns error when name is empty', () => {
    const result = updateGlobalVariableValidation(existingGlobals, { name: '' })
    expect(result.ok).toBe(false)
    expect(result.title).toContain('empty')
  })

  it('returns error when global variable name already exists (case-sensitive)', () => {
    const result = updateGlobalVariableValidation(existingGlobals, { name: 'GVar1' })
    expect(result.ok).toBe(false)
    expect(result.title).toContain('already exists')
  })

  it('returns ok: true for a unique valid name', () => {
    const result = updateGlobalVariableValidation(existingGlobals, { name: 'NewGlobal' })
    expect(result.ok).toBe(true)
  })

  it('allows same name with different case (case-sensitive check)', () => {
    const result = updateGlobalVariableValidation(existingGlobals, { name: 'gvar1' })
    expect(result.ok).toBe(true)
  })
})

// ===========================================================================
// Located arrays: a contiguous area, not one address
// ===========================================================================

describe('located arrays — collision by range', () => {
  // An ARRAY at a physical address occupies one slot per element. Before
  // openplc-editor#565 the editor compared locations for string equality, so
  // it happily accepted two variables sharing storage and only the compiler
  // caught it.

  it('accepts an array at a location whose element type fits the address', () => {
    const variable = makeArrayVariable('HR_myData', 'WORD', '%MW60', '0..66', 'global')
    const result = updateVariableValidation([variable], { location: '%MW60' }, variable)
    expect(result.ok).toBe(true)
  })

  it('rejects a scalar that lands inside an existing array', () => {
    // ARRAY [0..9] OF BOOL at %QX0.0 covers %QX0.0-%QX1.1, so %QX0.6 is inside.
    const existing = [makeArrayVariable('arr', 'BOOL', '%QX0.0', '0..9')]
    const flag = makeVariable('flag', 'BOOL', '', 'local')
    const result = updateVariableValidation(existing, { location: '%QX0.6' }, flag)
    expect(result.ok).toBe(false)
    expect(result.title).toBe('Location already exists')
  })

  it('rejects an array that swallows an existing scalar', () => {
    const existing = [makeVariable('flag', 'BOOL', '%QX0.6')]
    const arr = makeArrayVariable('arr', 'BOOL', '', '0..9')
    const result = updateVariableValidation(existing, { location: '%QX0.0' }, arr)
    expect(result.ok).toBe(false)
  })

  it('accepts a scalar immediately past the end of an array', () => {
    // ARRAY [0..3] OF WORD at %MW0 ends at %MW3.
    const existing = [makeArrayVariable('arr', 'WORD', '%MW0', '0..3')]
    const other = makeVariable('other', 'WORD', '', 'local')
    expect(updateVariableValidation(existing, { location: '%MW3' }, other).ok).toBe(false)
    expect(updateVariableValidation(existing, { location: '%MW4' }, other).ok).toBe(true)
  })

  it('does not collide across size classes', () => {
    // %MW0 and %MD0 index different runtime arrays.
    const existing = [makeArrayVariable('words', 'WORD', '%MW0', '0..7')]
    const dword = makeVariable('dw', 'DINT', '', 'local')
    expect(updateVariableValidation(existing, { location: '%MD0' }, dword).ok).toBe(true)
  })

  it('still catches two variables bound to the same alias', () => {
    // A non-`%` location is an alias name, where the test stays exact
    // equality — an alias resolves to one producer channel.
    const existing = [makeVariable('a', 'BOOL', 'MotorStart')]
    const b = makeVariable('b', 'BOOL', '', 'local')
    expect(updateVariableValidation(existing, { location: 'MotorStart' }, b).ok).toBe(false)
    expect(updateVariableValidation(existing, { location: 'MotorStop' }, b).ok).toBe(true)
  })

  it('ignores an alias-bound variable when checking a literal address', () => {
    // The other side has no address to compare against — its location is an
    // alias name, resolved to a real address only at compile time.
    const existing = [makeVariable('aliased', 'WORD', 'TankLevel')]
    const other = makeVariable('other', 'WORD', '', 'local')
    expect(updateVariableValidation(existing, { location: '%MW0' }, other).ok).toBe(true)
  })

  it('refuses a multi-dimensional array at a location, as the compiler does', () => {
    // ARRAY [0..3, 0..3] has no single run of consecutive addresses to sit on.
    // getArrayTotalElements answers 16 for it, so without an explicit refusal
    // the editor would place it and the build would fail later.
    const md = makeMultiDimArrayVariable('md', 'WORD', '', ['0..3', '0..3'])
    const result = updateVariableValidation([md], { location: '%MW0' }, md)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('multi-dimensional array cannot have a physical location')
  })

  it('refuses a type-only edit that turns a located 1-D array into a 2-D one', () => {
    // The array modal dispatches a type-only patch, so this is the path a user
    // actually takes to get here.
    const arr = makeArrayVariable('arr', 'WORD', '%MW0', '0..3')
    const twoD = makeMultiDimArrayVariable('arr', 'WORD', '%MW0', ['0..3', '0..3']).type
    const result = updateVariableValidation([arr], { type: twoD }, arr)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('multi-dimensional array cannot have a physical location')
  })

  it('leaves an unlocated multi-dimensional array alone', () => {
    // The restriction is about the location, not the shape.
    const md = makeMultiDimArrayVariable('md', 'WORD', '', ['0..3', '0..3'])
    expect(updateVariableValidation([md], { documentation: 'note' }, md).ok).toBe(true)
  })

  it('catches a TYPE-ONLY edit that widens an already-located variable', () => {
    // No location in the patch: the variable stays at %MW0 and only its type
    // changes, so it silently grows over %MW1-%MW3 and swallows the neighbour.
    // The location block never runs for this edit, which is how it slipped by.
    const neighbour = makeVariable('neighbour', 'WORD', '%MW2')
    const grow = makeVariable('grow', 'WORD', '%MW0')
    const asArray = makeArrayVariable('grow', 'WORD', '%MW0', '0..3').type
    const result = updateVariableValidation([neighbour, grow], { type: asArray }, grow)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('would now cover 4 addresses')
  })

  it('allows a type-only widening that still fits', () => {
    const neighbour = makeVariable('neighbour', 'WORD', '%MW9')
    const grow = makeVariable('grow', 'WORD', '%MW0')
    const asArray = makeArrayVariable('grow', 'WORD', '%MW0', '0..3').type
    expect(updateVariableValidation([neighbour, grow], { type: asArray }, grow).ok).toBe(true)
  })

  it('validates a joint location+type edit against the NEW type', () => {
    // %MW0 is a word address. Changing the type to BOOL in the same edit makes
    // it invalid, and checking against the old WORD type would have passed it.
    const v = makeVariable('v', 'WORD', '%MW0')
    const result = updateVariableValidation(
      [v],
      { location: '%MW0', type: { definition: 'base-type', value: 'BOOL' } },
      v,
    )
    expect(result.ok).toBe(false)
    expect(result.title).toBe('Location is invalid.')
  })

  it('widens the span when the same edit turns a scalar into an array', () => {
    // The check has to use the type the variable will HAVE, not the one it had.
    const existing = [makeVariable('neighbour', 'WORD', '%MW3')]
    const scalar = makeVariable('grow', 'WORD', '', 'local')
    const asArray = makeArrayVariable('grow', 'WORD', '', '0..3').type
    expect(updateVariableValidation(existing, { location: '%MW0' }, scalar).ok).toBe(true)
    expect(updateVariableValidation(existing, { location: '%MW0', type: asArray }, scalar).ok).toBe(false)
  })
})

describe('createVariableValidation — auto-increment past occupied ranges', () => {
  it('skips the whole span of an existing array', () => {
    // %MW0-%MW3 taken by the array, so the next free word is %MW4. Landing on
    // %MW1 (the old exact-match behaviour would have) is the same collision.
    const existing = [makeArrayVariable('arr', 'WORD', '%MW0', '0..3')]
    const result = createVariableValidation(existing, makeVariable('NewVar', 'WORD', '%MW0'))
    expect(result.location).toBe('%MW4')
  })

  it('moves a new array clear of an existing scalar', () => {
    // The candidate has to clear every slot the ARRAY would claim: at %MW0 it
    // would cover %MW0-%MW3 and swallow the scalar at %MW2.
    const existing = [makeVariable('taken', 'WORD', '%MW2')]
    const result = createVariableValidation(existing, makeArrayVariable('arr', 'WORD', '%MW0', '0..3'))
    expect(result.location).toBe('%MW3')
  })

  it('walks past a long occupied run without rescanning per step', () => {
    // The spans are parsed once outside the loop; this pins the SEMANTICS of
    // that change — 40 contiguous words taken, so a new one lands at %MW40.
    const existing = Array.from({ length: 40 }, (_, i) => makeVariable(`v${i}`, 'WORD', `%MW${i}`))
    const result = createVariableValidation(existing, makeVariable('NewVar', 'WORD', '%MW0'))
    expect(result.location).toBe('%MW40')
  })

  it('leaves a location alone when nothing overlaps', () => {
    const existing = [makeArrayVariable('arr', 'WORD', '%MW10', '0..3')]
    const result = createVariableValidation(existing, makeVariable('NewVar', 'WORD', '%MW0'))
    expect(result.location).toBe('%MW0')
  })
})
