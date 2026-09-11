/**
 * The adapters translate a model's loosely-typed tool input into the exact
 * shapes the store slices accept. They are where a wrong answer is silent: an
 * unknown type name that comes back as a base type still compiles into a
 * declaration, it just declares the wrong thing.
 *
 * `adaptUpdatePouBody` reads the project, so the real store is seeded rather
 * than mocked — the same reason the executor suite does, and what lets this
 * file run under jest and vitest unchanged.
 */

import { beforeEach, describe, expect, it } from '@jest/globals'

import type { PLCPou } from '../../../../../middleware/shared/ports/types'
import { openPLCStoreBase } from '../../../../store'
import {
  adaptCreatePou,
  adaptCreateVariable,
  adaptUpdatePouBody,
  BASE_TYPES,
  buildDatatypeFromCreateInput,
  resolveVariableType,
} from '../tool-input-adapters'

function makePou(name: string, language: PLCPou['body']['language'], value: unknown = ''): PLCPou {
  return { name, pouType: 'program', interface: { variables: [] }, body: { language, value }, documentation: '' }
}

function seedPous(pous: PLCPou[]): void {
  const current = openPLCStoreBase.getState().project
  openPLCStoreBase.getState().projectActions.setProject({ ...current, data: { ...current.data, pous } })
}

beforeEach(() => {
  seedPous([])
})

describe('resolveVariableType', () => {
  it.each(['BOOL', 'bool', 'DInt', 'LWORD', 'TOD'])('recognises %s as an IEC base type, folding case', (input) => {
    expect(resolveVariableType(input)).toEqual({ definition: 'base-type', value: input.toLowerCase() })
  })

  it('keeps a user data type name spelled exactly as declared', () => {
    // A struct is looked up by name at compile time, so lower-casing it the way
    // base types are folded would point the declaration at nothing.
    expect(resolveVariableType('MotorState')).toEqual({ definition: 'user-data-type', value: 'MotorState' })
  })

  it('treats a function block instance type as a user data type', () => {
    expect(resolveVariableType('TON')).toEqual({ definition: 'user-data-type', value: 'TON' })
  })

  it('exposes the base-type set in lower case, which is what the lookup folds to', () => {
    expect(BASE_TYPES.has('bool')).toBe(true)
    expect(BASE_TYPES.has('BOOL')).toBe(false)
  })
})

describe('adaptCreatePou', () => {
  it('splits the create properties from the body, which is applied after creation', () => {
    // The slice's create takes no body; passing one through would be dropped
    // silently and the POU would arrive empty.
    expect(adaptCreatePou({ name: 'Conveyor', type: 'program', language: 'st', body: 'x := 1;' })).toEqual({
      createProps: { name: 'Conveyor', type: 'program', language: 'st' },
      body: 'x := 1;',
    })
  })

  it('leaves the body undefined when none was supplied', () => {
    expect(adaptCreatePou({ name: 'Conveyor', type: 'function', language: 'il' }).body).toBeUndefined()
  })
})

describe('adaptUpdatePouBody', () => {
  it('carries the POU’s own language forward so an update cannot retype it', () => {
    // The tool input has no language field. Defaulting to ST here would turn a
    // Python POU into an ST one on the first AI edit.
    seedPous([makePou('Script', 'python', 'print(1)')])

    expect(adaptUpdatePouBody({ pouName: 'Script', code: 'print(2)' })).toEqual({
      name: 'Script',
      content: { language: 'python', value: 'print(2)' },
    })
  })

  it('answers null for a POU that does not exist so the caller can refuse', () => {
    expect(adaptUpdatePouBody({ pouName: 'Ghost', code: 'x := 1;' })).toBeNull()
  })
})

describe('adaptCreateVariable', () => {
  it('builds a local variable scoped to the named POU', () => {
    expect(
      adaptCreateVariable({ pouName: 'Conveyor', name: 'motor', type: 'BOOL', class: 'output', initialValue: 'FALSE' }),
    ).toEqual({
      scope: 'local',
      associatedPou: 'Conveyor',
      data: {
        name: 'motor',
        class: 'output',
        type: { definition: 'base-type', value: 'bool' },
        location: '',
        initialValue: 'FALSE',
        documentation: '',
        debug: false,
      },
    })
  })

  it('defaults an unspecified class to local', () => {
    expect(adaptCreateVariable({ pouName: 'Conveyor', name: 'counter', type: 'INT' }).data.class).toBe('local')
  })

  it.each([undefined, null])('scopes the variable globally when pouName is %p', (pouName) => {
    const adapted = adaptCreateVariable({ pouName, name: 'flag', type: 'BOOL' })

    expect(adapted.scope).toBe('global')
    expect(adapted.associatedPou).toBeUndefined()
    // A global is always class `global` regardless of what the model asked for —
    // any other class would be rejected by the resource variable table.
    expect(adapted.data.class).toBe('global')
  })

  it('overrides an explicit class on a global rather than honouring it', () => {
    expect(adaptCreateVariable({ name: 'flag', type: 'BOOL', class: 'input' }).data.class).toBe('global')
  })

  it('stores a missing initial value as null, which is what "no initial value" means on disk', () => {
    expect(adaptCreateVariable({ pouName: 'Conveyor', name: 'x', type: 'INT' }).data.initialValue).toBeNull()
  })
})

describe('buildDatatypeFromCreateInput', () => {
  it('builds a structure with every field type resolved', () => {
    expect(
      buildDatatypeFromCreateInput({
        name: 'MotorState',
        derivation: 'structure',
        fields: [
          { name: 'speed', type: 'INT' },
          { name: 'mode', type: 'Mode' },
        ],
      }),
    ).toEqual({
      name: 'MotorState',
      derivation: 'structure',
      variable: [
        { name: 'speed', type: { definition: 'base-type', value: 'int' } },
        { name: 'mode', type: { definition: 'user-data-type', value: 'Mode' } },
      ],
    })
  })

  it('builds an enumeration and carries its initial value', () => {
    expect(
      buildDatatypeFromCreateInput({
        name: 'Mode',
        derivation: 'enumerated',
        values: ['IDLE', 'RUNNING'],
        initialValue: 'IDLE',
      }),
    ).toEqual({
      name: 'Mode',
      derivation: 'enumerated',
      values: [{ description: 'IDLE' }, { description: 'RUNNING' }],
      initialValue: 'IDLE',
    })
  })

  it('omits initialValue entirely when none was given, rather than writing undefined', () => {
    // The key's presence is what the serializer checks; an explicit
    // `initialValue: undefined` would be written out as an empty assignment.
    expect(
      buildDatatypeFromCreateInput({ name: 'Mode', derivation: 'enumerated', values: ['IDLE'] }),
    ).not.toHaveProperty('initialValue')
  })

  it('builds an array with its base type resolved and every dimension kept', () => {
    expect(
      buildDatatypeFromCreateInput({
        name: 'Grid',
        derivation: 'array',
        baseType: 'REAL',
        dimensions: ['0..9', '1..4'],
        initialValue: '0',
      }),
    ).toEqual({
      name: 'Grid',
      derivation: 'array',
      baseType: { definition: 'base-type', value: 'real' },
      dimensions: [{ dimension: '0..9' }, { dimension: '1..4' }],
      initialValue: '0',
    })
  })

  it.each([
    ['a structure with no fields', { name: 'S', derivation: 'structure' as const }],
    ['a structure with an empty field list', { name: 'S', derivation: 'structure' as const, fields: [] }],
    ['an enumeration with no values', { name: 'E', derivation: 'enumerated' as const }],
    ['an enumeration with an empty value list', { name: 'E', derivation: 'enumerated' as const, values: [] }],
    ['an array with no base type', { name: 'A', derivation: 'array' as const, dimensions: ['0..9'] }],
    ['an array with no dimensions', { name: 'A', derivation: 'array' as const, baseType: 'INT' }],
    [
      'an array with an empty dimension list',
      { name: 'A', derivation: 'array' as const, baseType: 'INT', dimensions: [] },
    ],
  ])('answers null for %s so the caller reports why instead of storing a half type', (_label, input) => {
    expect(buildDatatypeFromCreateInput(input)).toBeNull()
  })
})
