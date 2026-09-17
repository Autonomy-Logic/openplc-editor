/**
 * Data types, and the two ways a spec could produce one the editor cannot read.
 *
 * Both were found by driving a project through `apply` -> `check` and reading
 * the emitted TYPE block, which is the only place either showed up: the project
 * saved without complaint in each case.
 */

import { openPLCStoreBase } from '@root/frontend/store'

// The FBD body applier reaches the FBD component modules, which do not load
// under jest. Nothing here applies an FBD body.
jest.mock('../apply/fbd', () => ({ applyFbdBody: () => [] }))

import { applySpec } from '../apply/plan'
import type { ApplySpec } from '../apply/schema'

const dataTypesIn = () => openPLCStoreBase.getState().project.data.dataTypes

const apply = (dataTypes: unknown) =>
  applySpec({ specVersion: 1, dataTypes } as ApplySpec, { prune: false, projectPath: '/does/not/matter' })

describe('a structure member declared as an array', () => {
  // The store keeps an array's bounds in `type.data`; the spec states them as
  // `dimensions`. Passing the spec shape straight through left the member a
  // scalar of the element type — `Trend : INT` where `ARRAY [0..2] OF INT` was
  // asked for — and nothing reported it.
  it('keeps its bounds', async () => {
    const result = await apply([
      {
        derivation: 'structure',
        name: 'HasArray',
        variables: [{ name: 'Trend', type: { definition: 'array', value: 'INT', dimensions: ['0..2'] } }],
      },
    ])
    expect(result.errors).toEqual([])

    const stored = dataTypesIn().find((type) => type.name === 'HasArray')
    const member = (stored as unknown as { variable: Array<{ type: Record<string, unknown> }> }).variable[0]

    expect(member.type.value).toBe('ARRAY [0..2] OF INT')
    expect(member.type.data).toEqual({
      baseType: { definition: 'base-type', value: 'INT' },
      dimensions: [{ dimension: '0..2' }],
    })
  })
})

describe('a data type whose name is not a legal identifier', () => {
  // `createDatatype` accepts these. The `.dt` written for one then fails to
  // parse on the next load: the editor preserves the file and warns, but the
  // type is gone from the project and every reference to it fails to compile as
  // an undefined type.
  it('refuses a reserved structure field name', async () => {
    const result = await apply([
      {
        derivation: 'structure',
        name: 'BadField',
        variables: [{ name: 'Label', type: { definition: 'base-type', value: 'STRING' } }],
      },
    ])

    expect(result.errors.join(' ')).toContain('"Label" is a reserved word')
    expect(dataTypesIn().some((type) => type.name === 'BadField')).toBe(false)
  })

  it('refuses a reserved enumerated value', async () => {
    const result = await apply([{ derivation: 'enumerated', name: 'BadEnum', values: ['OK', 'WHILE'] }])

    expect(result.errors.join(' ')).toContain('"WHILE"')
    expect(dataTypesIn().some((type) => type.name === 'BadEnum')).toBe(false)
  })

  it('refuses a name with illegal characters', async () => {
    const result = await apply([
      {
        derivation: 'structure',
        name: 'Bad Name',
        variables: [{ name: 'Ok', type: { definition: 'base-type', value: 'INT' } }],
      },
    ])

    expect(result.errors.join(' ')).toContain('illegal characters')
  })

  it('accepts names that are legal', async () => {
    const result = await apply([
      {
        derivation: 'structure',
        name: 'GoodOne',
        variables: [{ name: 'Tag', type: { definition: 'base-type', value: 'STRING' } }],
      },
    ])

    expect(result.errors).toEqual([])
    expect(dataTypesIn().some((type) => type.name === 'GoodOne')).toBe(true)
  })
})
