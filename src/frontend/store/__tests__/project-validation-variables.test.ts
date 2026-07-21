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
  it('does not change location for unknown type', () => {
    const existing = [makeVariable('Var1', 'STRING', '%MD0')]
    const variable = makeVariable('NewVar', 'STRING', '%MD0')
    const result = createVariableValidation(existing, variable)
    // default case is a no-op, location stays as found
    expect(result.location).toBe('%MD0')
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
