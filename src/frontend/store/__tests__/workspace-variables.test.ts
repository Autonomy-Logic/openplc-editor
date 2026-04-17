import type { PLCGlobalVariable, PLCVariable } from '../../../middleware/shared/ports/types'
import {
  arrayValidation,
  createGlobalVariableValidation,
  createVariableValidation,
  updateGlobalVariableValidation,
  updateVariableValidation,
} from '../slices/workspace/utils/variables'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVariable(name: string): PLCVariable {
  return {
    name,
    class: 'local',
    type: { definition: 'base-type', value: 'INT' },
    location: '',
    documentation: '',
  }
}

function makeGlobalVariable(name: string): PLCGlobalVariable {
  return {
    name,
    class: 'global',
    type: { definition: 'base-type', value: 'INT' },
    location: '',
    documentation: '',
  }
}

// ===========================================================================
// arrayValidation
// ===========================================================================

describe('arrayValidation', () => {
  it('returns ok: true for valid range "0..10"', () => {
    expect(arrayValidation({ value: '0..10' })).toEqual({ ok: true })
  })

  it('returns error for empty value', () => {
    const result = arrayValidation({ value: '' })
    expect(result.ok).toBe(false)
    expect(result.title).toBe('Invalid array value')
    expect(result.message).toContain('can not be empty')
  })

  it('returns error when left >= right', () => {
    const result = arrayValidation({ value: '10..5' })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('is invalid')
  })

  it('returns error when left equals right', () => {
    const result = arrayValidation({ value: '5..5' })
    expect(result.ok).toBe(false)
  })

  it('returns error for non-integer values', () => {
    const result = arrayValidation({ value: '1.5..10' })
    expect(result.ok).toBe(false)
  })

  it('returns error for non-numeric values', () => {
    const result = arrayValidation({ value: 'abc..def' })
    expect(result.ok).toBe(false)
  })

  it('returns error for spaces around dots', () => {
    const result = arrayValidation({ value: '0 .. 10' })
    expect(result.ok).toBe(false)
  })

  it('accepts single-digit range "0..1"', () => {
    expect(arrayValidation({ value: '0..1' })).toEqual({ ok: true })
  })
})

// ===========================================================================
// createVariableValidation
// ===========================================================================

describe('createVariableValidation', () => {
  it('returns unchanged name when no conflict', () => {
    const result = createVariableValidation([], 'NewVar')
    expect(result).toBe('NewVar')
  })

  it('appends _1 when variable exists with no suffix', () => {
    const variables = [makeVariable('Var')]
    const result = createVariableValidation(variables, 'Var')
    expect(result).toBe('Var_1')
  })

  it('increments suffix when numbered variable exists', () => {
    const variables = [makeVariable('Var'), makeVariable('Var_1')]
    const result = createVariableValidation(variables, 'Var')
    expect(result).toBe('Var_2')
  })

  it('fills gap when there are non-consecutive suffixes', () => {
    const variables = [makeVariable('Var'), makeVariable('Var_1'), makeVariable('Var_5')]
    const result = createVariableValidation(variables, 'Var')
    // gap-filling: finds break between _1 and _5, so number resets to 1+1=2
    expect(result).toBe('Var_2')
  })

  it('handles name input that already has a suffix', () => {
    const variables = [makeVariable('Var_1'), makeVariable('Var_2')]
    const result = createVariableValidation(variables, 'Var_1')
    expect(result).toBe('Var_3')
  })

  it('fills gaps in numbering when there is a gap', () => {
    // Variables: Var_1, Var_3 (gap at 2)
    // The algorithm finds where consecutive numbering breaks
    const variables = [makeVariable('Var_1'), makeVariable('Var_3')]
    const result = createVariableValidation(variables, 'Var_1')
    expect(result).toBe('Var_2')
  })

  it('handles only one variable with suffix', () => {
    const variables = [makeVariable('Var_3')]
    const result = createVariableValidation(variables, 'Var_3')
    expect(result).toBe('Var_4')
  })

  it('handles both sorted match with no _num suffix (matchA and matchB both null)', () => {
    // Two variables that match but have no _\d+ suffix, so sort returns 0
    const variables = [makeVariable('VarA'), makeVariable('VarAB')]
    const result = createVariableValidation(variables, 'VarA')
    // biggestVariable match on 'VarAB' has no _\d+, so number = 0
    expect(result).toBe('VarA_1')
  })
})

// ===========================================================================
// createGlobalVariableValidation
// ===========================================================================

describe('createGlobalVariableValidation', () => {
  it('returns unchanged name when no conflict', () => {
    const result = createGlobalVariableValidation([], 'GVar')
    expect(result).toBe('GVar')
  })

  it('appends _1 when global variable exists with no suffix', () => {
    const variables = [makeGlobalVariable('GVar')]
    const result = createGlobalVariableValidation(variables, 'GVar')
    expect(result).toBe('GVar_1')
  })

  it('increments suffix when numbered global variable exists', () => {
    const variables = [makeGlobalVariable('GVar'), makeGlobalVariable('GVar_1')]
    const result = createGlobalVariableValidation(variables, 'GVar')
    expect(result).toBe('GVar_2')
  })

  it('fills gap when there are non-consecutive suffixes', () => {
    const variables = [makeGlobalVariable('GVar'), makeGlobalVariable('GVar_1'), makeGlobalVariable('GVar_5')]
    const result = createGlobalVariableValidation(variables, 'GVar')
    // gap-filling: finds break between _1 and _5, so number resets to 1+1=2
    expect(result).toBe('GVar_2')
  })

  it('handles name input that already has a suffix', () => {
    const variables = [makeGlobalVariable('GVar_1'), makeGlobalVariable('GVar_2')]
    const result = createGlobalVariableValidation(variables, 'GVar_1')
    expect(result).toBe('GVar_3')
  })

  it('fills gaps in numbering when consecutive numbers are broken', () => {
    const variables = [makeGlobalVariable('GVar_1'), makeGlobalVariable('GVar_3')]
    const result = createGlobalVariableValidation(variables, 'GVar_1')
    expect(result).toBe('GVar_2')
  })

  it('handles only one global variable with suffix', () => {
    const variables = [makeGlobalVariable('GVar_3')]
    const result = createGlobalVariableValidation(variables, 'GVar_3')
    expect(result).toBe('GVar_4')
  })

  it('handles variables where sort comparisons have no _num matches', () => {
    const variables = [makeGlobalVariable('GVarA'), makeGlobalVariable('GVarAB')]
    const result = createGlobalVariableValidation(variables, 'GVarA')
    expect(result).toBe('GVarA_1')
  })
})

// ===========================================================================
// updateVariableValidation
// ===========================================================================

describe('updateVariableValidation', () => {
  const existing = [makeVariable('Var1'), makeVariable('Var2')]

  it('returns ok: true when no name is being updated', () => {
    const result = updateVariableValidation(existing, { location: '%QW0' })
    expect(result.ok).toBe(true)
  })

  it('returns error when name is empty', () => {
    const result = updateVariableValidation(existing, { name: '' })
    expect(result.ok).toBe(false)
    expect(result.title).toContain('empty')
  })

  it('returns error when name already exists', () => {
    const result = updateVariableValidation(existing, { name: 'Var2' })
    expect(result.ok).toBe(false)
    expect(result.title).toContain('already exists')
  })

  it('returns error when name is invalid format', () => {
    const result = updateVariableValidation(existing, { name: '###' })
    expect(result.ok).toBe(false)
    expect(result.title).toContain('invalid')
  })

  it('returns ok: true when name is valid and unique', () => {
    const result = updateVariableValidation(existing, { name: 'NewName' })
    expect(result.ok).toBe(true)
  })
})

// ===========================================================================
// updateGlobalVariableValidation
// ===========================================================================

describe('updateGlobalVariableValidation', () => {
  const existing = [makeGlobalVariable('GVar1'), makeGlobalVariable('GVar2')]

  it('returns ok: true when no name change', () => {
    const result = updateGlobalVariableValidation(existing, { location: '%QW0' })
    expect(result.ok).toBe(true)
  })

  it('returns error when name is empty', () => {
    const result = updateGlobalVariableValidation(existing, { name: '' })
    expect(result.ok).toBe(false)
    expect(result.title).toContain('empty')
  })

  it('returns error when global variable name already exists', () => {
    const result = updateGlobalVariableValidation(existing, { name: 'GVar1' })
    expect(result.ok).toBe(false)
    expect(result.title).toContain('already exists')
  })

  it('returns ok: true for a unique valid name', () => {
    const result = updateGlobalVariableValidation(existing, { name: 'NewGlobal' })
    expect(result.ok).toBe(true)
  })
})
