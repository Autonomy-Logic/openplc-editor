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
    const types = serializeGlobalVariableListsToTypes([gvl([variable('Output1', 'BOOL', { location: '%QX0.0' })])])

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

// The error strings below are STruC++'s own. This parser used to have a regex of its
// own and a hand-written message for each shape; the compiler now decides what a GVL
// is, so it decides what is wrong with one too — and unlike the old messages, its
// report carries the line.
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
    expect(parsed.globalVariableList?.variables.map((v) => [v.name, v.type.value, v.location, v.initialValue])).toEqual(
      [
        ['Output1', 'BOOL', '%QX0.0', ''],
        ['Speed', 'INT', '', '7'],
      ],
    )
  })

  it('rejects a duplicate declaration instead of silently keeping one', () => {
    const result = parseGlobalVariableListFromText('VAR_GLOBAL\n  A : BOOL;\n  A : INT;\nEND_VAR', 'GVL')

    expect(result.globalVariableList).toBeUndefined()
    expect(result.error).toMatch(/declared more than once/)
  })

  it('reports an unparsable line rather than dropping the rest of the block', () => {
    const result = parseGlobalVariableListFromText('VAR_GLOBAL\n  A : BOOL\nEND_VAR', 'GVL')

    expect(result.globalVariableList).toBeUndefined()
    expect(result.error).toMatch(/Expected `Semicolon`/)
  })

  it('requires the VAR_GLOBAL wrapper', () => {
    expect(parseGlobalVariableListFromText('A : BOOL;', 'GVL').error).toMatch(/while parsing a statement/)
  })

  it('requires END_VAR to close the block', () => {
    expect(parseGlobalVariableListFromText('VAR_GLOBAL\n  A : BOOL;', 'GVL').error).toMatch(/Expected `END_VAR`/)
  })

  it('reports an empty declaration', () => {
    expect(parseGlobalVariableListFromText('   \n\n', 'GVL').error).toMatch(/empty declaration/)
  })

  it('reports a missing colon distinctly from a missing semicolon', () => {
    expect(parseGlobalVariableListFromText('VAR_GLOBAL\n  A BOOL;\nEND_VAR', 'GVL').error).toMatch(/Expected `Colon`/)
  })

  it('rejects a member named after an IEC keyword', () => {
    expect(parseGlobalVariableListFromText('VAR_GLOBAL\n  IF : BOOL;\nEND_VAR', 'GVL').error).toMatch(
      /Expected `END_VAR`, found `IF`/,
    )
  })

  it('rejects a type it cannot resolve', () => {
    expect(parseGlobalVariableListFromText('VAR_GLOBAL\n  A : NOT_A_TYPE_?;\nEND_VAR', 'GVL').error).toMatch(
      /unexpected character/,
    )
  })

  it('reads a user data type as one', () => {
    const parsed = parseGlobalVariableListFromText('VAR_GLOBAL\n  Motor : MotorState;\nEND_VAR', 'GVL')

    expect(parsed.globalVariableList?.variables[0].type).toEqual({ definition: 'user-data-type', value: 'MotorState' })
  })

  it('reads an array member', () => {
    const parsed = parseGlobalVariableListFromText('VAR_GLOBAL\n  Buf : ARRAY [0..9] OF INT;\nEND_VAR', 'GVL')

    expect(parsed.error).toBeUndefined()
    expect(parsed.globalVariableList?.variables[0].type.definition).toBe('array')
  })

  it('reads the trailing comment as the member documentation', () => {
    const parsed = parseGlobalVariableListFromText('VAR_GLOBAL\n  A : BOOL; (* the lamp *)\nEND_VAR', 'GVL')

    expect(parsed.globalVariableList?.variables[0].documentation).toBe('the lamp')
  })
})

/**
 * Everything below is about reading what CODESYS writes rather than only what this
 * editor writes. A GVL exists so a declaration can move across unchanged; a parser that
 * only accepts its own output makes that false the first time someone pastes one in.
 */
describe('global variable list — CODESYS declaration forms', () => {
  it('accepts a qualified header and keeps the qualifier', () => {
    const parsed = parseGlobalVariableListFromText('VAR_GLOBAL CONSTANT\n  MaxCount : INT := 10;\nEND_VAR', 'GVL')

    expect(parsed.error).toBeUndefined()
    expect(parsed.globalVariableList?.qualifier).toBe('CONSTANT')
  })

  it.each(['RETAIN', 'NON_RETAIN', 'PERSISTENT', 'RETAIN PERSISTENT'])('accepts VAR_GLOBAL %s', (qualifier) => {
    const parsed = parseGlobalVariableListFromText(`VAR_GLOBAL ${qualifier}\n  A : BOOL;\nEND_VAR`, 'GVL')

    expect(parsed.error).toBeUndefined()
    expect(parsed.globalVariableList?.qualifier).toBe(qualifier)
  })

  it('round-trips the qualifier back onto the header', () => {
    // The qualifier is never compiled — a struct cannot express CONSTANT — so this text
    // is the only place it survives. Dropping it would rewrite the user's declaration.
    const parsed = parseGlobalVariableListFromText('VAR_GLOBAL CONSTANT\n  MaxCount : INT := 10;\nEND_VAR', 'GVL')

    // Narrowed rather than asserted, so a parser regression fails here with its own
    // message instead of a null dereference inside the serializer.
    expect(parsed.globalVariableList).toBeDefined()
    if (!parsed.globalVariableList) return
    expect(serializeGlobalVariableListToText(parsed.globalVariableList)).toBe(
      'VAR_GLOBAL CONSTANT\n  MaxCount : INT := 10;\nEND_VAR\n',
    )
  })

  it('expands a name list into one member each', () => {
    const parsed = parseGlobalVariableListFromText('VAR_GLOBAL\n  A, B : INT;\nEND_VAR', 'GVL')

    expect(parsed.error).toBeUndefined()
    expect(parsed.globalVariableList?.variables.map((v) => [v.name, v.type.value])).toEqual([
      ['A', 'INT'],
      ['B', 'INT'],
    ])
  })

  it('refuses one AT address shared by a name list', () => {
    // An address binds ONE name; accepting this would claim the same address for both.
    expect(parseGlobalVariableListFromText('VAR_GLOBAL\n  A, B AT %QX0.0 : INT;\nEND_VAR', 'GVL').error).toMatch(
      /cannot carry a single AT address/,
    )
  })

  it('skips comment-only lines, in both comment styles', () => {
    const parsed = parseGlobalVariableListFromText(
      'VAR_GLOBAL\n  (* the outputs *)\n  // and a note\n  A : BOOL;\nEND_VAR',
      'GVL',
    )

    expect(parsed.error).toBeUndefined()
    expect(parsed.globalVariableList?.variables.map((v) => v.name)).toEqual(['A'])
  })

  it('skips a comment spanning several lines', () => {
    const parsed = parseGlobalVariableListFromText(
      'VAR_GLOBAL\n  (* explaining\n     at length *)\n  A : BOOL;\nEND_VAR',
      'GVL',
    )

    expect(parsed.error).toBeUndefined()
    expect(parsed.globalVariableList?.variables.map((v) => v.name)).toEqual(['A'])
  })

  it('reads a trailing // comment on a declaration', () => {
    const parsed = parseGlobalVariableListFromText('VAR_GLOBAL\n  A : BOOL; // the lamp\nEND_VAR', 'GVL')

    expect(parsed.error).toBeUndefined()
    expect(parsed.globalVariableList?.variables.map((v) => v.name)).toEqual(['A'])
  })

  it('reads a trailing // comment on the header', () => {
    const parsed = parseGlobalVariableListFromText('VAR_GLOBAL CONSTANT // shared limits\n  A : BOOL;\nEND_VAR', 'GVL')

    expect(parsed.error).toBeUndefined()
    expect(parsed.globalVariableList?.qualifier).toBe('CONSTANT')
  })

  it('leaves a // inside a string initial value alone', () => {
    // Cutting at the first `//` would corrupt the very declaration the strip exists
    // to preserve.
    const parsed = parseGlobalVariableListFromText(
      "VAR_GLOBAL\n  Url : STRING := 'http://example.com';\nEND_VAR",
      'GVL',
    )

    expect(parsed.error).toBeUndefined()
    expect(parsed.globalVariableList?.variables[0].initialValue).toBe("'http://example.com'")
  })

  it('drops an attribute pragma', () => {
    // `{attribute 'qualified_only'}` is what makes CODESYS require the `GVL.` prefix.
    // STruC++ cannot lex a `{`, and compiling to a struct makes qualification mandatory
    // anyway, so the rule it asks for is already in force.
    const parsed = parseGlobalVariableListFromText(
      "{attribute 'qualified_only'}\nVAR_GLOBAL\n  A : BOOL;\nEND_VAR",
      'GVL',
    )

    expect(parsed.error).toBeUndefined()
    expect(parsed.globalVariableList?.variables.map((v) => v.name)).toEqual(['A'])
  })

  it('merges several VAR_GLOBAL blocks in one list', () => {
    const parsed = parseGlobalVariableListFromText(
      'VAR_GLOBAL\n  A : BOOL;\nEND_VAR\nVAR_GLOBAL\n  B : INT;\nEND_VAR',
      'GVL',
    )

    expect(parsed.error).toBeUndefined()
    expect(parsed.globalVariableList?.variables.map((v) => v.name)).toEqual(['A', 'B'])
  })

  it('refuses to merge blocks that disagree about the qualifier', () => {
    // Merging has to settle on one, and picking silently is how a CONSTANT stops
    // being constant.
    const parsed = parseGlobalVariableListFromText(
      'VAR_GLOBAL\n  A : BOOL;\nEND_VAR\nVAR_GLOBAL CONSTANT\n  B : INT;\nEND_VAR',
      'GVL',
    )

    expect(parsed.globalVariableList).toBeUndefined()
    expect(parsed.error).toMatch(/conflicting VAR_GLOBAL qualifiers/)
  })

  it('catches a block reopened before it closed', () => {
    expect(
      parseGlobalVariableListFromText('VAR_GLOBAL\n  A : BOOL;\nVAR_GLOBAL\n  B : INT;\nEND_VAR', 'GVL').error,
    ).toMatch(/Expected `END_VAR`, found `VAR_GLOBAL`/)
  })

  it('catches a stray END_VAR', () => {
    expect(parseGlobalVariableListFromText('VAR_GLOBAL\n  A : BOOL;\nEND_VAR\nEND_VAR', 'GVL').error).toMatch(
      /Expected `END_PROGRAM`, found `END_VAR`/,
    )
  })

  it('reports a declaration sitting outside any block', () => {
    expect(parseGlobalVariableListFromText('VAR_GLOBAL\n  A : BOOL;\nEND_VAR\n  B : INT;', 'GVL').error).toMatch(
      /while parsing a statement/,
    )
  })
})

/**
 * A `{` is a pragma only where a pragma can be written. The blanking pass runs over
 * the caller's own string and every span the parser reports addresses it, so blanking
 * one brace too many does not fail loudly — it hands back a member whose text has a
 * hole in it, and a GVL is written back from the model, so the hole reaches the disk.
 */
describe('global variable list — what counts as a pragma', () => {
  it('leaves a brace inside a string initial value alone', () => {
    const parsed = parseGlobalVariableListFromText("VAR_GLOBAL\n  Fmt : STRING := '{0}';\nEND_VAR", 'GVL')

    expect(parsed.error).toBeUndefined()
    expect(parsed.globalVariableList?.variables[0].initialValue).toBe("'{0}'")
  })

  it('leaves a brace inside a comment alone', () => {
    const parsed = parseGlobalVariableListFromText('VAR_GLOBAL\n  A : BOOL; (* see {x} *)\nEND_VAR', 'GVL')

    expect(parsed.error).toBeUndefined()
    expect(parsed.globalVariableList?.variables[0].documentation).toBe('see {x}')
  })

  it('leaves a brace inside a line comment alone', () => {
    const parsed = parseGlobalVariableListFromText('VAR_GLOBAL\n  A : BOOL; // see {x}\nEND_VAR', 'GVL')

    expect(parsed.error).toBeUndefined()
    expect(parsed.globalVariableList?.variables[0].documentation).toBe('see {x}')
  })

  it('drops a pragma sitting between declarations', () => {
    const parsed = parseGlobalVariableListFromText(
      "VAR_GLOBAL\n  A : BOOL;\n  {attribute 'hidden'}\n  B : INT;\nEND_VAR",
      'GVL',
    )

    expect(parsed.error).toBeUndefined()
    expect(parsed.globalVariableList?.variables.map((v) => v.name)).toEqual(['A', 'B'])
  })

  it('drops a pragma holding a brace of its own', () => {
    const parsed = parseGlobalVariableListFromText("{attribute 'a' := '{b}'}\nVAR_GLOBAL\n  A : BOOL;\nEND_VAR", 'GVL')

    expect(parsed.error).toBeUndefined()
    expect(parsed.globalVariableList?.variables.map((v) => v.name)).toEqual(['A'])
  })

  it('keeps the qualifier when a pragma precedes the header', () => {
    // The qualifier is read out of the header span, which the blanking pass must not
    // have shifted.
    const parsed = parseGlobalVariableListFromText(
      "{attribute 'qualified_only'}\nVAR_GLOBAL CONSTANT\n  A : BOOL;\nEND_VAR",
      'GVL',
    )

    expect(parsed.error).toBeUndefined()
    expect(parsed.globalVariableList?.qualifier).toBe('CONSTANT')
  })

  it('does not read a qualifier out of the header comment', () => {
    const parsed = parseGlobalVariableListFromText('VAR_GLOBAL // RETAIN one day\n  A : BOOL;\nEND_VAR', 'GVL')

    expect(parsed.error).toBeUndefined()
    expect(parsed.globalVariableList?.qualifier).toBeUndefined()
  })

  it('reads a declaration list sharing a line', () => {
    const parsed = parseGlobalVariableListFromText('VAR_GLOBAL\n  A : BOOL; B : INT;\nEND_VAR', 'GVL')

    expect(parsed.error).toBeUndefined()
    expect(parsed.globalVariableList?.variables.map((v) => v.name)).toEqual(['A', 'B'])
  })

  it('reads a whole list written on one line', () => {
    const parsed = parseGlobalVariableListFromText('VAR_GLOBAL A : BOOL; B : INT; END_VAR', 'GVL')

    expect(parsed.error).toBeUndefined()
    expect(parsed.globalVariableList?.variables.map((v) => v.name)).toEqual(['A', 'B'])
  })
})
