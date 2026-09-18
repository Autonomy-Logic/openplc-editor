import { afterEach, describe, expect, it } from '@jest/globals'

import { getCppMemberCompletions, projectTypeNamePredicate } from '../cpp-scope'
import type { SystemLibrary, SystemLibraryPou } from '../../../middleware/shared/ports/library-types'
import type { PLCDataType, PLCPou } from '../../../middleware/shared/ports/types'
import type { LibraryState } from '../../store/slices/library'
import { registerScopedQueryApi, type ScopedCompletionItem } from '../st-lsp/scoped-query'

/** strucpp emits Variable(6) for instance members, Field(5) for STRUCT members. */
const VARIABLE = 6
const FIELD = 5
const KEYWORD = 14

function withScopedQuery(items: Record<string, ScopedCompletionItem[]>) {
  const asked: string[] = []
  registerScopedQueryApi({
    completeInScope: (_pou, prefix) => {
      asked.push(prefix)
      return Promise.resolve(items[prefix] ?? [])
    },
  })
  return asked
}

const isUserDefinedType = (name: string) => ['MOTOR', 'GEAR', 'MODE'].includes(name.toUpperCase())

afterEach(() => registerScopedQueryApi(null))

describe('getCppMemberCompletions', () => {
  it('spells each member the way the C++ body must write it', async () => {
    withScopedQuery({
      'm.': [
        { label: 'speed', insertText: 'speed', type: 'INT', kind: FIELD },
        { label: 'Gear', insertText: 'Gear', type: 'Gear', kind: FIELD },
        { label: 'mode', insertText: 'mode', type: 'Mode', kind: FIELD },
      ],
    })

    const members = await getCppMemberCompletions('Probe', 'm.', isUserDefinedType)

    expect(members.map((m) => m.label)).toEqual(['SPEED', 'GEAR_', 'MODE_'])
    // The IEC name is kept: it is what every other surface calls the member.
    expect(members.map((m) => m.iecName)).toEqual(['speed', 'Gear', 'mode'])
    expect(members.map((m) => m.type)).toEqual(['INT', 'Gear', 'Mode'])
  })

  it('accepts function-block instance members as well as struct fields', async () => {
    withScopedQuery({
      'ctl.': [
        { label: 'T_Max', insertText: 'T_Max', type: 'TIME', kind: VARIABLE },
        { label: 'Moisture', insertText: 'Moisture', type: 'BOOL', kind: VARIABLE },
      ],
    })

    const members = await getCppMemberCompletions('Probe', 'ctl.', isUserDefinedType)
    expect(members.map((m) => m.label)).toEqual(['T_MAX', 'MOISTURE'])
  })

  it('drops everything that is not a value', async () => {
    // A bare position returns the language's keywords; after a `.` those are
    // never valid, and offering them would bury the members.
    withScopedQuery({
      'm.': [
        { label: 'speed', insertText: 'speed', type: 'INT', kind: FIELD },
        { label: 'if', insertText: 'if', kind: KEYWORD },
        { label: 'while', insertText: 'while', kind: KEYWORD },
      ],
    })

    const members = await getCppMemberCompletions('Probe', 'm.', isUserDefinedType)
    expect(members.map((m) => m.label)).toEqual(['SPEED'])
  })

  it('asks for a single-level anchor directly, with no extra round trip', async () => {
    const asked = withScopedQuery({ 'm.': [{ label: 'speed', insertText: 'speed', type: 'INT', kind: FIELD }] })

    const members = await getCppMemberCompletions('Probe', 'm.', isUserDefinedType)

    expect(asked).toEqual(['m.'])
    expect(members.map((m) => m.label)).toEqual(['SPEED'])
  })

  it('translates a mangled segment back to its IEC name before asking again', async () => {
    // The regression that nearly shipped: having accepted `GEAR_` from this
    // module, the user types `.` — and `m.GEAR_.` is meaningless to strucpp,
    // whose member is `Gear`. Each segment has to be resolved back.
    const asked = withScopedQuery({
      'm.': [{ label: 'Gear', insertText: 'Gear', type: 'Gear', kind: FIELD }],
      'm.Gear.': [{ label: 'ratio', insertText: 'ratio', type: 'INT', kind: FIELD }],
    })

    const members = await getCppMemberCompletions('Probe', 'm.GEAR_.', isUserDefinedType)

    expect(asked).toEqual(['m.', 'm.Gear.'])
    expect(members.map((m) => m.label)).toEqual(['RATIO'])
  })

  it('resolves a plain upper-cased segment too', async () => {
    const asked = withScopedQuery({
      'm.': [{ label: 'axle', insertText: 'axle', type: 'Gear', kind: FIELD }],
      'm.axle.': [{ label: 'ratio', insertText: 'ratio', type: 'INT', kind: FIELD }],
    })

    const members = await getCppMemberCompletions('Probe', 'm.AXLE.', isUserDefinedType)

    expect(asked).toEqual(['m.', 'm.axle.'])
    expect(members.map((m) => m.label)).toEqual(['RATIO'])
  })

  it('goes three levels deep, one round trip per level', async () => {
    const asked = withScopedQuery({
      'a.': [{ label: 'Gear', insertText: 'Gear', type: 'Gear', kind: FIELD }],
      'a.Gear.': [{ label: 'inner', insertText: 'inner', type: 'Motor', kind: FIELD }],
      'a.Gear.inner.': [{ label: 'speed', insertText: 'speed', type: 'INT', kind: FIELD }],
    })

    const members = await getCppMemberCompletions('Probe', 'a.GEAR_.INNER.', isUserDefinedType)

    expect(asked).toEqual(['a.', 'a.Gear.', 'a.Gear.inner.'])
    expect(members.map((m) => m.label)).toEqual(['SPEED'])
  })

  it('carries an array subscript through to the LSP', async () => {
    // `items[0]` is one segment but two things: `items` has a C++ spelling to
    // match, `[0]` selects an element and is strucpp's business. Comparing the
    // whole segment against the spelling never matched, so nested completion
    // through an array-valued member returned nothing.
    const asked = withScopedQuery({
      'm.': [{ label: 'items', insertText: 'items', type: 'Gear', kind: FIELD }],
      'm.items[0].': [{ label: 'ratio', insertText: 'ratio', type: 'INT', kind: FIELD }],
    })

    const members = await getCppMemberCompletions('Probe', 'm.ITEMS[0].', isUserDefinedType)

    expect(asked).toEqual(['m.', 'm.items[0].'])
    expect(members.map((m) => m.label)).toEqual(['RATIO'])
  })

  it('carries a multi-dimensional subscript through unchanged', async () => {
    const asked = withScopedQuery({
      'g.': [{ label: 'grid', insertText: 'grid', type: 'Gear', kind: FIELD }],
      'g.grid[1,2].': [{ label: 'ratio', insertText: 'ratio', type: 'INT', kind: FIELD }],
    })

    await getCppMemberCompletions('Probe', 'g.GRID[1,2].', isUserDefinedType)

    expect(asked).toEqual(['g.', 'g.grid[1,2].'])
  })

  it('leaves a subscript on the root segment alone', async () => {
    const asked = withScopedQuery({ 'bank[1].': [{ label: 'speed', insertText: 'speed', type: 'INT', kind: FIELD }] })
    const members = await getCppMemberCompletions('Probe', 'bank[1].', isUserDefinedType)
    expect(asked).toEqual(['bank[1].'])
    expect(members.map((m) => m.label)).toEqual(['SPEED'])
  })

  it('gives up quietly when a segment does not resolve', async () => {
    // A typo, or a chain through a scalar. Returning [] lets the provider fall
    // back to its flat list instead of asserting "this has no members".
    withScopedQuery({ 'm.': [{ label: 'speed', insertText: 'speed', type: 'INT', kind: FIELD }] })
    expect(await getCppMemberCompletions('Probe', 'm.NOPE.', isUserDefinedType)).toEqual([])
  })

  it('leaves the root segment alone — it is a variable, never mangled', async () => {
    // The root reaches the block through a `#define` carrying the casing the
    // user authored, so it must not be upper-cased on the way to the LSP.
    const asked = withScopedQuery({ 'myMotor.': [{ label: 'speed', insertText: 'speed', type: 'INT', kind: FIELD }] })
    await getCppMemberCompletions('Probe', 'myMotor.', isUserDefinedType)
    expect(asked).toEqual(['myMotor.'])
  })

  it('returns nothing for an empty anchor rather than listing the whole scope', async () => {
    const asked = withScopedQuery({})
    expect(await getCppMemberCompletions('Probe', '', isUserDefinedType)).toEqual([])
    expect(asked).toEqual([])
  })

  it('returns nothing when the LSP is unavailable, so the caller can fall back', async () => {
    registerScopedQueryApi(null)
    expect(await getCppMemberCompletions('Probe', 'm.', isUserDefinedType)).toEqual([])
  })

  it('omits the type when strucpp supplied none', async () => {
    withScopedQuery({ 'm.': [{ label: 'speed', insertText: 'speed', kind: FIELD }] })
    const [member] = await getCppMemberCompletions('Probe', 'm.', isUserDefinedType)
    expect(member).toEqual({ label: 'SPEED', iecName: 'speed' })
  })
})

describe('projectTypeNamePredicate', () => {
  const pou = (name: string, pouType: PLCPou['pouType']): PLCPou => ({
    name,
    pouType,
    body: { language: 'st', value: '' },
  })
  const libraryPou = (name: string, type: SystemLibraryPou['type']): SystemLibraryPou => ({
    name,
    type,
    language: 'st',
    variables: [],
    body: '',
    documentation: '',
  })
  const systemLibrary = (name: string, pous: SystemLibraryPou[]): SystemLibrary => ({
    name,
    author: '',
    version: '1.0.0',
    stPath: '',
    cPath: '',
    pous,
  })

  const pous: PLCPou[] = [pou('Drive', 'function-block'), pou('main', 'program'), pou('Scale', 'function')]
  const dataTypes: PLCDataType[] = [
    { name: 'Motor', derivation: 'structure', variable: [] },
    { name: 'Mode', derivation: 'enumerated', values: [{ description: 'IDLE' }] },
  ]
  const libraries: LibraryState['libraries'] = {
    system: [systemLibrary('iec-standard-fb', [libraryPou('TON', 'function-block'), libraryPou('ADD', 'function')])],
    user: [],
  }

  it('recognises data types, the project’s own function blocks and library blocks', () => {
    const isUdt = projectTypeNamePredicate(pous, dataTypes, libraries)
    expect(isUdt('Motor')).toBe(true)
    expect(isUdt('Mode')).toBe(true)
    expect(isUdt('Drive')).toBe(true)
    expect(isUdt('TON')).toBe(true)
  })

  it('is case-insensitive, because IEC names are', () => {
    const isUdt = projectTypeNamePredicate(pous, dataTypes, libraries)
    expect(isUdt('mOtOr')).toBe(true)
    expect(isUdt('ton')).toBe(true)
  })

  it('excludes elementary types, programs and functions', () => {
    const isUdt = projectTypeNamePredicate(pous, dataTypes, libraries)
    expect(isUdt('INT')).toBe(false)
    expect(isUdt('BOOL')).toBe(false)
    // Only a function block can be a variable's type; a program or a function
    // never is, so neither can produce the member collision.
    expect(isUdt('main')).toBe(false)
    expect(isUdt('Scale')).toBe(false)
    expect(isUdt('ADD')).toBe(false)
  })
})
