import type { PLCVariable } from '../../../middleware/shared/ports/types'
import { getVariableBasedOnRowIdOrVariableId } from '../slices/project/utils'

function makeVariable(name: string): PLCVariable {
  return {
    name,
    class: 'local',
    type: { definition: 'base-type', value: 'INT' },
    location: '',
    documentation: '',
  }
}

describe('getVariableBasedOnRowIdOrVariableId', () => {
  const variables = [makeVariable('alpha'), makeVariable('beta'), makeVariable('gamma')]

  // ---------------------------------------------------------------------------
  // Lookup by variableId (name)
  // ---------------------------------------------------------------------------
  it('returns variable by variableId when found', () => {
    const result = getVariableBasedOnRowIdOrVariableId(variables, undefined, 'beta')
    expect(result).toEqual({ variable: variables[1], index: 1 })
  })

  it('returns undefined when variableId is not found', () => {
    const result = getVariableBasedOnRowIdOrVariableId(variables, undefined, 'nonexistent')
    expect(result).toBeUndefined()
  })

  it('variableId takes precedence over rowId', () => {
    const result = getVariableBasedOnRowIdOrVariableId(variables, 0, 'gamma')
    expect(result).toEqual({ variable: variables[2], index: 2 })
  })

  // ---------------------------------------------------------------------------
  // Lookup by rowId
  // ---------------------------------------------------------------------------
  it('returns variable by rowId when valid', () => {
    const result = getVariableBasedOnRowIdOrVariableId(variables, 0)
    expect(result).toEqual({ variable: variables[0], index: 0 })
  })

  it('returns variable at last valid rowId', () => {
    const result = getVariableBasedOnRowIdOrVariableId(variables, 2)
    expect(result).toEqual({ variable: variables[2], index: 2 })
  })

  it('returns undefined when rowId is negative', () => {
    const result = getVariableBasedOnRowIdOrVariableId(variables, -1)
    expect(result).toBeUndefined()
  })

  it('returns undefined when rowId is out of bounds', () => {
    const result = getVariableBasedOnRowIdOrVariableId(variables, 5)
    expect(result).toBeUndefined()
  })

  it('returns undefined when rowId equals array length', () => {
    const result = getVariableBasedOnRowIdOrVariableId(variables, 3)
    expect(result).toBeUndefined()
  })

  // ---------------------------------------------------------------------------
  // Neither provided
  // ---------------------------------------------------------------------------
  it('returns undefined when neither variableId nor rowId is provided', () => {
    const result = getVariableBasedOnRowIdOrVariableId(variables)
    expect(result).toBeUndefined()
  })

  it('returns undefined when variables array is empty and rowId is 0', () => {
    const result = getVariableBasedOnRowIdOrVariableId([], 0)
    expect(result).toBeUndefined()
  })

  it('returns undefined when variables array is empty and variableId is given', () => {
    const result = getVariableBasedOnRowIdOrVariableId([], undefined, 'alpha')
    expect(result).toBeUndefined()
  })
})
