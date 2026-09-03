import { describe, expect, it } from '@jest/globals'

import type { PLCVariable } from '../../../../../../middleware/shared/ports/types'
import { updateVariableValidation } from '../variables'

/**
 * Renaming a variable to a name that still matches its own.
 *
 * The uniqueness check ran against the whole table, the row being renamed
 * included, so a variable was compared against itself and any rename that
 * still collided with its old name was refused as a duplicate. The visible
 * case is a case-only rename — `ABCD` -> `ABCd` — which forced the user to
 * detour through a third name to get there (DOPE-606).
 *
 * A variable can never be a duplicate of itself, so it does not belong in
 * its own comparison. Case sensitivity of the compare is deliberately not
 * touched here; that is handled by the name-collision gate work.
 */
const variable = (name: string, overrides: Partial<PLCVariable> = {}): PLCVariable => ({
  name,
  class: 'local',
  type: { definition: 'base-type', value: 'BOOL' },
  location: '',
  documentation: '',
  ...overrides,
})

describe('updateVariableValidation — renaming a variable', () => {
  it('allows a case-only rename', () => {
    const abcd = variable('ABCD')
    const variables = [abcd, variable('Other')]

    const result = updateVariableValidation(variables, { name: 'ABCd' }, abcd)

    expect(result.ok).toBe(true)
  })

  it('allows re-setting a variable to exactly its current name', () => {
    const motor = variable('Motor')

    const result = updateVariableValidation([motor], { name: 'Motor' }, motor)

    expect(result.ok).toBe(true)
  })

  it('still refuses a rename onto a different existing variable', () => {
    const first = variable('Motor')
    const variables = [first, variable('Pump')]

    const result = updateVariableValidation(variables, { name: 'Pump' }, first)

    expect(result.ok).toBe(false)
    expect(result.title).toBe('Variable already exists')
  })

  it('still refuses a rename that differs only in case from a different variable', () => {
    // The self-exclusion must not weaken collision detection against others:
    // IEC identifiers are case insensitive, so `pump` and `Pump` are one name.
    const first = variable('Motor')
    const variables = [first, variable('Pump')]

    const result = updateVariableValidation(variables, { name: 'pump' }, first)

    expect(result.ok).toBe(false)
    expect(result.title).toBe('Variable already exists')
  })

  it('still refuses an empty name', () => {
    const motor = variable('Motor')

    const result = updateVariableValidation([motor], { name: '' }, motor)

    expect(result.ok).toBe(false)
  })

  it('excludes by identity, not by name, so duplicate rows do not mask each other', () => {
    // Two rows can transiently share a name (a project loaded from disk that
    // predates the collision gate). Renaming one must still see the other.
    const first = variable('Dup')
    const second = variable('Dup')

    const result = updateVariableValidation([first, second], { name: 'Dup' }, first)

    expect(result.ok).toBe(false)
  })
})
