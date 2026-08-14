import type { PLCGlobalVariableList } from '../../../../middleware/shared/ports/types'
import {
  globalVariableListExternals,
  globalVariableListTypeName,
  serializeGlobalVariableListInstances,
  serializeGlobalVariableListToText,
  serializeGlobalVariableListsToTypes,
} from '../global-variable-list-serializer'
import { parseGlobalVariableListFromText } from '../global-variable-list-text-parser'

/**
 * Global Variable Lists.
 *
 * A GVL is shown to the user as CODESYS shows it — a `VAR_GLOBAL … END_VAR` block — and
 * compiled as a STRUCT plus one global instance. The rules with teeth are about what
 * does NOT reach the compiler, because each one fails silently rather than loudly.
 */
const gvl = (variables: PLCGlobalVariableList['variables']): PLCGlobalVariableList => ({
  name: 'GVL',
  variables,
})

const variable = (
  name: string,
  value: string,
  extra: { location?: string; initialValue?: string } = {},
): PLCGlobalVariableList['variables'][number] => ({
  name,
  class: 'global',
  type: { definition: 'base-type', value },
  location: extra.location ?? '',
  initialValue: extra.initialValue ?? '',
  documentation: '',
})

describe('global variable list — compiled form', () => {
  it('declares a struct named apart from the instance', () => {
    // Types and variables share one namespace, so `TYPE GVL` beside `GVL : GVL` is
    // rejected outright ("Symbol 'GVL' already defined in scope 'global'"). Only the
    // instance name is ever visible to the user.
    expect(globalVariableListTypeName('GVL')).toBe('GVL_TYPE')

    expect(serializeGlobalVariableListsToTypes([gvl([variable('Output1', 'BOOL')])])).toBe(
      'TYPE\nGVL_TYPE : STRUCT\n  Output1 : BOOL;\nEND_STRUCT;\nEND_TYPE\n',
    )
  })

  it('leaves member addresses OUT of the compiled struct', () => {
    // `AT %QX0.0` on a struct member compiles and is then silently discarded — no
    // located mapping is produced — so emitting it would imply an I/O binding that does
    // not exist. The address stays on the model for the trip back to CODESYS.
    const types = serializeGlobalVariableListsToTypes([
      gvl([variable('Output1', 'BOOL', { location: '%QX0.0' })]),
    ])

    expect(types).not.toContain('%QX0.0')
    expect(types).not.toContain(' AT ')
  })

  it('keeps initial values, which the compiler does honour', () => {
    expect(serializeGlobalVariableListsToTypes([gvl([variable('Speed', 'INT', { initialValue: '7' })])])).toContain(
      'Speed : INT := 7;',
    )
  })

  it('declares one instance per list', () => {
    expect(serializeGlobalVariableListInstances([gvl([variable('A', 'BOOL')])])).toBe(
      'VAR_GLOBAL\n  GVL : GVL_TYPE;\nEND_VAR\n',
    )
  })

  it('emits nothing at all for an empty list', () => {
    // An empty STRUCT is not a legal type, so there is nothing to instantiate either.
    expect(serializeGlobalVariableListsToTypes([gvl([])])).toBe('')
    expect(serializeGlobalVariableListInstances([gvl([])])).toBe('')
  })
})

describe('global variable list — POU externals', () => {
  const lists = [gvl([variable('Output1', 'BOOL')])]

  it('declares the lists a body actually references', () => {
    // Without a matching VAR_EXTERNAL, a configuration global is invisible to the POU:
    // `GVL.Output1` fails with "Undeclared variable 'GVL'".
    expect(globalVariableListExternals(lists, 'GVL.Output1 := TRUE;')).toBe(
      'VAR_EXTERNAL\n  GVL : GVL_TYPE;\nEND_VAR\n',
    )
  })

  it('leaves an unrelated POU alone', () => {
    expect(globalVariableListExternals(lists, 'x := y + 1;')).toBe('')
  })

  it('does not match a name that merely starts the same', () => {
    expect(globalVariableListExternals(lists, 'GVL_OTHER.Thing := 1;')).toBe('')
  })

  it('matches regardless of case, as IEC identifiers are case-insensitive', () => {
    expect(globalVariableListExternals(lists, 'gvl.output1 := TRUE;')).toContain('GVL : GVL_TYPE;')
  })
})

describe('global variable list — text form', () => {
  it('writes the address BEFORE the colon, as IEC and the CODESYS importer do', () => {
    // A round-trip test alone cannot catch this: a serializer and parser that agree with
    // each other on the wrong order both pass, and the mismatch only surfaces against a
    // `.gvl` file the CODESYS converter wrote. Pin the exact text.
    expect(serializeGlobalVariableListToText(gvl([variable('Output1', 'BOOL', { location: '%QX0.0' })]))).toBe(
      'VAR_GLOBAL\n  Output1 AT %QX0.0 : BOOL;\nEND_VAR\n',
    )
  })

  it('reads the declaration form the CODESYS importer writes', () => {
    const parsed = parseGlobalVariableListFromText('VAR_GLOBAL\n\tOutput1 AT %QX0.0: BOOL;\nEND_VAR', 'GVL')

    expect(parsed.error).toBeUndefined()
    expect(parsed.globalVariableList?.variables[0]).toMatchObject({ name: 'Output1', location: '%QX0.0' })
  })

  it('round-trips through its own text, addresses included', () => {
    // This text is the list's persistence, so it must carry everything the model holds —
    // including the address the compiler cannot yet act on.
    const original = gvl([
      variable('Output1', 'BOOL', { location: '%QX0.0' }),
      variable('Speed', 'INT', { initialValue: '7' }),
    ])

    const parsed = parseGlobalVariableListFromText(serializeGlobalVariableListToText(original), 'GVL')

    expect(parsed.error).toBeUndefined()
    expect(parsed.globalVariableList?.variables.map((v) => [v.name, v.type.value, v.location, v.initialValue])).toEqual([
      ['Output1', 'BOOL', '%QX0.0', ''],
      ['Speed', 'INT', '', '7'],
    ])
  })

  it('rejects a duplicate declaration instead of silently keeping one', () => {
    const result = parseGlobalVariableListFromText('VAR_GLOBAL\n  A : BOOL;\n  A : INT;\nEND_VAR', 'GVL')

    expect(result.globalVariableList).toBeUndefined()
    expect(result.error).toMatch(/declared more than once/)
  })

  it('reports an unparsable line rather than dropping the rest of the block', () => {
    const result = parseGlobalVariableListFromText('VAR_GLOBAL\n  A : BOOL\nEND_VAR', 'GVL')

    expect(result.globalVariableList).toBeUndefined()
    expect(result.error).toMatch(/missing semicolon/)
  })

  it('requires the VAR_GLOBAL wrapper', () => {
    expect(parseGlobalVariableListFromText('A : BOOL;', 'GVL').error).toMatch(/must start with VAR_GLOBAL/)
  })
})
